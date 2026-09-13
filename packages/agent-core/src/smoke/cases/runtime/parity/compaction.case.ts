import {
  AgentRuntime,
  CompactExecutor,
  CompactTransport,
  PollingCompactTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  rebuildScriptedStateAfterCompaction,
  truncateScriptedHistoryForCompaction,
  truncateScriptedStateForContextRetry,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type RuntimeTurnResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from "./harness.js";
import { truncateLlmHistoryForCompaction } from "../../../../llm-tool-agent.js";

export async function runCompactionCase(): Promise<RuntimeParityCaseResult> {
  const pollingCompactEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const compactRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: new CompactTransport(),
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateStateForContextRetry: truncateScriptedStateForContextRetry,
      truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
      rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
    },
    [
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-old-compact", name: "read_file", argumentsJson: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "call-old-compact",
        content: createLlmMessageContentFromText("old tool output\n" + "x".repeat(5000)),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("Old answer."),
      },
    ],
  );

  const compactResult = await compactRuntime.submitUserTurn("Continue working on runtime parity.");
  if (compactResult.kind !== "completed" || compactResult.assistantText !== "COMPACT_OK") {
    throw new Error("compact retry smoke did not complete the turn loop.");
  }

  const firstCompaction = compactResult.compactions.at(0);
  if (
    compactResult.compactions.length !== 1 ||
    !firstCompaction ||
    firstCompaction.droppedMessages <= 0
  ) {
    throw new Error("compact retry smoke did not record an effective compaction.");
  }

  const pollingCompactTransport = new PollingCompactTransport();
  const pollingCompactRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: pollingCompactTransport,
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateStateForContextRetry: truncateScriptedStateForContextRetry,
      truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
      rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
      maxAutoCompactRetries: 2,
      onEvent: (event) => pollingCompactEvents.push(event),
    },
    [
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-old-compact", name: "read_file", argumentsJson: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "call-old-compact",
        content: createLlmMessageContentFromText("old tool output\n" + "x".repeat(5000)),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("Old answer."),
      },
    ],
  );

  await pollingCompactRuntime.startUserTurn("Continue working on runtime parity.");
  await flushMicrotasks(4);
  await pollingCompactRuntime.poll();
  await flushMicrotasks(4);
  await pollingCompactRuntime.poll();
  if (!pollingCompactRuntime.isBusy()) {
    throw new Error("polling compact smoke should stay busy during auto compaction.");
  }
  const compactAux = pollingCompactRuntime.pendingAuxState();
  if (!compactAux || compactAux.kind !== "compacting") {
    throw new Error("polling compact smoke did not expose the compacting aux state.");
  }
  if (pollingCompactRuntime.takeCompletedTurnResult()) {
    throw new Error(
      "polling compact smoke should not produce a result before compaction finishes.",
    );
  }

  pollingCompactTransport.finishCompaction();
  let pollingCompactResult: RuntimeTurnResult<ScriptedState, ScriptedToolRequest> | undefined;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await pollingCompactRuntime.poll();
    pollingCompactResult = pollingCompactRuntime.takeCompletedTurnResult();
    if (pollingCompactResult) {
      break;
    }
  }
  if (
    !pollingCompactResult ||
    pollingCompactResult.kind !== "completed" ||
    pollingCompactResult.assistantText !== "COMPACT_OK"
  ) {
    throw new Error("polling compact smoke did not get the final result after auto compaction.");
  }
  if (
    !pollingCompactEvents.some(
      (event) =>
        event.kind === "update-pending-assistant-compaction" &&
        event.text.includes("compacted history"),
    )
  ) {
    throw new Error("polling compact smoke is missing the compaction update event.");
  }

  const transcriptDirPath = "/tmp/spirit-smoke/transcripts/smoke-compact-transcript";
  let persistedMessageCount = 0;
  const transcriptRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: new CompactTransport(),
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateStateForContextRetry: truncateScriptedStateForContextRetry,
      truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
      rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
      hookSessionContext: {
        sessionId: "smoke-compact-transcript",
        conversationPath: null,
        workspaceRoot: "/tmp",
        model: "test-model",
      },
      syncSessionTranscript: async ({ transcript }) => {
        persistedMessageCount = transcript.message_count;
        if (transcript.messages.length === 0) {
          throw new Error("transcript smoke did not write any messages.");
        }
        return transcriptDirPath;
      },
    },
    [
      {
        role: "user",
        content: createLlmMessageContentFromText("first user turn"),
      },
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-transcript", name: "read_file", argumentsJson: '{"path":"a.ts"}' }],
      },
      {
        role: "tool",
        toolCallId: "call-transcript",
        content: createLlmMessageContentFromText("tool output should be omitted from transcript"),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("assistant follow-up"),
      },
    ],
  );

  const transcriptRecord = await transcriptRuntime.compactHistory();
  if (transcriptRecord.transcriptDirPath !== transcriptDirPath) {
    throw new Error("transcript smoke did not record the transcript directory path.");
  }
  if (persistedMessageCount !== 3) {
    throw new Error(
      `transcript smoke has an unexpected persisted message count: ${persistedMessageCount}`,
    );
  }

  const toolOutputArchivePath =
    "/tmp/spirit-smoke/tool-output-archives/smoke-tool-archive/call-archive-tool.txt";
  let persistedToolOutput = "";
  const toolOutputArchiveRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: new CompactTransport(),
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
      rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
      hookSessionContext: {
        sessionId: "smoke-tool-archive",
        conversationPath: null,
        workspaceRoot: "/tmp",
        model: "test-model",
      },
      persistToolOutputArchive: async ({ content }) => {
        persistedToolOutput = content;
        return toolOutputArchivePath;
      },
    },
    [
      {
        role: "user",
        content: createLlmMessageContentFromText("inspect large tool output"),
      },
      {
        role: "tool",
        toolCallId: "call-archive-tool",
        content: createLlmMessageContentFromText("z".repeat(20_000)),
      },
    ],
  );

  const toolOutputArchiveRecord = await toolOutputArchiveRuntime.compactHistory();
  if (!persistedToolOutput || persistedToolOutput.length !== 20_000) {
    throw new Error("tool output archive smoke did not persist the full tool output.");
  }
  if (toolOutputArchiveRecord.beforeLength < 2) {
    throw new Error("tool output archive smoke has an abnormal length before/after compaction.");
  }

  return {
    compactResult,
    pollingCompactResult,
    transcriptCompactionResult: transcriptRecord,
    toolOutputArchiveCompactionResult: toolOutputArchiveRecord,
  };
}
