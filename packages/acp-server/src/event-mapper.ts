import {
  isBackgroundTaskTerminal,
  type JsonValue,
  type RuntimeEvent,
  type BackgroundTaskRecord,
} from "@spiritagent/agent-core";
import type * as schema from "@agentclientprotocol/sdk";
import {
  mapToolNameToKind,
  buildToolCallTitle,
  extractToolCallLocations,
} from "./tool-call-mapper.js";

/**
 * Per-session state for tracking streaming deltas.
 *
 * The `update-pending-assistant-thinking` event carries the full accumulated
 * thinking text (not a delta). We must compute the delta ourselves to avoid
 * the ACP client concatenating full-text chunks into garbled output.
 */
export interface EventMapperState {
  /** Length of thinking text already sent to the client */
  sentThinkingLength: number;
  tasks: Set<string>;
  outputs: Map<string, string>;
}

/**
 * Creates a fresh per-session mapper state.
 */
export function createEventMapperState(): EventMapperState {
  return { sentThinkingLength: 0, tasks: new Set(), outputs: new Map() };
}

/**
 * Maps a RuntimeEvent to an ACP session/update notification payload.
 * Returns undefined for events that should not be forwarded (e.g. approval-requested).
 *
 * @param state - Mutable per-session state used to compute streaming deltas.
 */
export function mapRuntimeEventToUpdate(
  event: RuntimeEvent<JsonValue>,
  sessionId: string,
  state: EventMapperState,
): schema.SessionNotification | undefined {
  switch (event.kind) {
    case "assistant-chunk":
      return {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: event.text,
          },
        },
      } as schema.SessionNotification;

    case "update-pending-assistant-thinking": {
      // event.text is the full accumulated thinking text, not a delta.
      // Extract only the new portion since last emission.
      const fullText = event.text;
      const delta = fullText.slice(state.sentThinkingLength);
      state.sentThinkingLength = fullText.length;
      if (delta.length === 0) return undefined;
      return {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: {
            type: "text",
            text: delta,
          },
        },
      } as schema.SessionNotification;
    }

    case "assistant-thinking-segment-finalized":
      // A thinking segment ended — reset the sent length tracker
      // so the next thinking segment starts fresh.
      state.sentThinkingLength = 0;
      return undefined;

    case "streaming-tool-preview": {
      const kind = mapToolNameToKind(event.toolName);
      const title = buildToolCallTitle(event.toolName, event.argumentsJson);
      const locations = extractToolCallLocations(event.argumentsJson);
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: event.toolCallId,
          title,
          kind,
          status: "pending",
          ...(locations.length > 0 ? { locations } : {}),
        },
      } as schema.SessionNotification;
    }

    case "tool-call-started":
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          status: "in_progress",
        },
      } as schema.SessionNotification;

    case "tool-execution-finished": {
      const ex = event.execution;
      state.outputs.delete(ex.toolCallId);
      const content = formatToolExecutionOutput(ex.output);
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: ex.toolCallId,
          status: ex.failed ? "failed" : "completed",
          ...(content !== undefined ? { content } : {}),
        },
      } as schema.SessionNotification;
    }

    case "context-usage-updated":
      // LlmTokenUsage doesn't include context window size.
      // Skip the update rather than sending misleading size == used.
      return undefined;

    case "replace-pending-assistant":
      // This event replaces the entire pending assistant text.
      // ACP's agent_message_chunk is append-only, so we cannot faithfully
      // represent a full-text replacement. Skip to avoid duplicate content.
      return undefined;

    case "tool-execution-output-chunk":
      return outputUpdate(sessionId, event.toolCallId, event.chunk, state);

    case "background-task-output":
      return outputUpdate(sessionId, event.task.id, event.chunk, state);

    case "background-task-changed":
      return event.task.background ? taskUpdate(sessionId, event.task, state) : undefined;

    case "background-task-notification": {
      const update = taskUpdate(sessionId, event.task, state, event.content);
      state.outputs.delete(event.task.id);
      return update;
    }

    case "background-task-error":
      return {
        sessionId,
        update: event.taskId
          ? {
              sessionUpdate: state.tasks.has(event.taskId) ? "tool_call_update" : "tool_call",
              toolCallId: event.taskId,
              title: "Task Error",
              status: "failed",
              content: [{ type: "content", content: { type: "text", text: event.error } }],
            }
          : {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: event.error },
            },
      };

    case "background-tool-status":
      // Call-ID-bearing start/finish events already cover this legacy status channel.
      return undefined;

    // Events handled elsewhere or ignored
    case "approval-requested":
    case "questions-requested":
    case "begin-assistant-response":
    case "assistant-response-completed":
    case "remove-pending-assistant":
    case "update-pending-assistant-compaction":
    case "approval-resolved":
    case "history-compacted":
      return undefined;
  }
}

function outputUpdate(
  sessionId: string,
  toolCallId: string,
  chunk: string,
  state: EventMapperState,
): schema.SessionNotification {
  const output = ((state.outputs.get(toolCallId) ?? "") + chunk).slice(-4000);
  state.outputs.set(toolCallId, output);
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      content: [{ type: "content", content: { type: "text", text: output } }],
    },
  };
}

function taskUpdate(
  sessionId: string,
  task: BackgroundTaskRecord,
  state: EventMapperState,
  notice?: string,
): schema.SessionNotification {
  const known = state.tasks.has(task.id);
  state.tasks.add(task.id);
  const status = isBackgroundTaskTerminal(task.status)
    ? task.status === "completed"
      ? "completed"
      : "failed"
    : "in_progress";
  const call: schema.ToolCall = {
    toolCallId: task.id,
    title: buildToolCallTitle(task.kind, task.argumentsJson),
    kind: mapToolNameToKind(task.kind),
    status,
    rawOutput: {
      task_id: task.id,
      tool_call_id: task.toolCallId,
      status: task.status,
      output_path: task.outputPath,
      elapsed_seconds: task.elapsedMs / 1000,
      ...(task.parentTaskId ? { parent_task_id: task.parentTaskId } : {}),
      ...(task.exitCode !== undefined ? { exit_code: task.exitCode } : {}),
      ...(task.error ? { error: task.error } : {}),
    },
    ...(notice
      ? {
          content: [{ type: "content" as const, content: { type: "text" as const, text: notice } }],
        }
      : {}),
  };
  return {
    sessionId,
    update: known
      ? { ...call, sessionUpdate: "tool_call_update" }
      : { ...call, sessionUpdate: "tool_call" },
  };
}

/**
 * Formats tool execution output into ACP ToolCallContent array.
 */
function formatToolExecutionOutput(
  output: string | import("@spiritagent/agent-core").ToolExecutionOutput,
): schema.ToolCallContent[] | undefined {
  if (typeof output === "string") {
    if (output.length === 0) return undefined;
    return [{ type: "content", content: { type: "text", text: truncateOutput(output) } }];
  }

  // ToolExecutionOutput with content parts
  if (typeof output === "object" && output !== null && "content" in output) {
    const execOutput = output as { content?: Array<{ type: string; text?: string }> };
    if (!execOutput.content || execOutput.content.length === 0) return undefined;

    return execOutput.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => ({
        type: "content" as const,
        content: { type: "text" as const, text: truncateOutput(part.text ?? "") },
      }));
  }

  return undefined;
}

/**
 * Truncates long tool output to prevent excessive ACP messages.
 */
function truncateOutput(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n… [truncated ${text.length - maxLen} chars]`;
}
