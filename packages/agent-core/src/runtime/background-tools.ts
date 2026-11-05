import type { LlmMessage, ToolCallRequest } from "../ports.js";
import type { JsonObject } from "../ports.js";
import { createToolExecutionTextOutput } from "../ports.js";

import { renderError, buildToolContinuationStateFromHistory } from "./helpers.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./tool-output-append.js";
import { toolInputFromArgumentsJson } from "../hooks/integration.js";
import { runPostToolUseSideEffects } from "../hooks/tool-hooks.js";
import { commitToolExecutionOutput, type TurnMachineRuntime } from "./turn-machine.js";
import type {
  AgentRuntimeOptions,
  DeferredBackgroundToolExecutionSpec,
  PendingEarlyToolExecution,
  PendingBackgroundToolExecution,
  PendingManualBackgroundToolExecution,
  PendingToolCallBackgroundToolExecution,
  RuntimeCompletedManualToolCommandResult,
  RuntimeEvent,
  RuntimeTurnContext,
} from "./types.js";

export interface BackgroundToolsRuntime<Config, State, ToolRequest> {
  options: AgentRuntimeOptions<Config, State, ToolRequest>;
  historyStore: LlmMessage[];
  pendingBackgroundToolStatusStore: string | undefined;
  pendingBackgroundToolExecution: PendingBackgroundToolExecution<State, ToolRequest> | undefined;
  deferredBackgroundToolExecutions: DeferredBackgroundToolExecutionSpec<State, ToolRequest>[];
  completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  startToolAgentRoundAsync(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emptyAssistantRetries?: number,
  ): void;
  startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void>;
  queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void;
  processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): Promise<void>;
  readOutstandingToolTurnFlags?: () => {
    hasPendingApproval: boolean;
    hasPendingContinuation: boolean;
    hasPendingQuestions: boolean;
    deferredBgCount: number;
  };
  advanceTurnToolState?: (turn: RuntimeTurnContext<ToolRequest>, state: State) => void;
  resolveTurnToolState?: (turn: RuntimeTurnContext<ToolRequest>, fallback: State) => State;
}

function hasOutstandingToolTurnWork<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
): boolean {
  const flags = runtime.readOutstandingToolTurnFlags?.();
  if (!flags) {
    return false;
  }
  return (
    flags.hasPendingApproval ||
    flags.hasPendingContinuation ||
    flags.hasPendingQuestions ||
    flags.deferredBgCount > 0
  );
}

/** persistAssistantToolCalls only writes historyStore; the resumed LLM run must rebuild state from history, avoiding pending.state missing assistant tool_calls. */
function buildBackgroundToolContinuationState<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
): State {
  return buildToolContinuationStateFromHistory(
    runtime.options,
    runtime.historyStore,
    pendingUserInput,
  );
}

export function startBackgroundToolExecutionAsync<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  postHookToolInput?: JsonObject,
): void {
  const statusText = runtime.options.toolExecutor.backgroundStatusText?.(request);
  runtime.pendingBackgroundToolStatusStore = statusText;
  runtime.emitEvent({
    kind: "background-tool-status",
    phase: "started",
    toolName,
    request,
    ...(statusText !== undefined ? { statusText } : {}),
  });

  const pending: PendingToolCallBackgroundToolExecution<State, ToolRequest> = {
    kind: "tool-call",
    pendingUserInput,
    state,
    request,
    toolCallId,
    toolName,
    argumentsJson,
    startedAtUnixMs: Date.now(),
    ...(postHookToolInput ? { postHookToolInput } : {}),
    remainingCalls: [...remainingCalls],
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
    statusText,
    output: undefined,
    failed: undefined,
  };
  runtime.pendingBackgroundToolExecution = pending;

  const requestForExecution =
    runtime.options.toolExecutor.attachRequestMetadata?.(request, {
      toolCallId,
      toolName,
      onOutputChunk: (chunk) => {
        runtime.emitEvent({
          kind: "tool-execution-output-chunk",
          toolCallId,
          toolName,
          request,
          chunk,
        });
      },
    }) ?? request;

  void runtime.options.toolExecutor
    .execute(requestForExecution)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = output.execution?.failed === true;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = createToolExecutionTextOutput(`[tool error] ${renderError(error)}`);
        pending.failed = true;
      }
    });
}

export function scheduleBackgroundToolExecutionAsync<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  postHookToolInput?: JsonObject,
): void {
  if (runtime.pendingBackgroundToolExecution !== undefined) {
    runtime.deferredBackgroundToolExecutions.push({
      pendingUserInput,
      request,
      toolCallId,
      toolName,
      argumentsJson,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
      ...(postHookToolInput ? { postHookToolInput } : {}),
    });
    return;
  }

  startBackgroundToolExecutionAsync(
    runtime,
    pendingUserInput,
    state,
    request,
    toolCallId,
    toolName,
    argumentsJson,
    [],
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    earlyToolExecutions,
    postHookToolInput,
  );
}

function startNextDeferredBackgroundToolExecution<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
  resumedState: State,
): void {
  const next = runtime.deferredBackgroundToolExecutions.shift();
  if (!next) {
    return;
  }

  startBackgroundToolExecutionAsync(
    runtime,
    next.pendingUserInput,
    resumedState,
    next.request,
    next.toolCallId,
    next.toolName,
    next.argumentsJson,
    [],
    next.turn,
    next.resumeAsStreaming,
    next.streamingEmitBeginResponse,
    next.earlyToolExecutions,
    next.postHookToolInput,
  );
}

export function startManualBackgroundToolExecution<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
  request: ToolRequest,
  toolName: string,
): string | undefined {
  const statusText = runtime.options.toolExecutor.backgroundStatusText?.(request);
  runtime.pendingBackgroundToolStatusStore = statusText;
  runtime.emitEvent({
    kind: "background-tool-status",
    phase: "started",
    toolName,
    request,
    ...(statusText !== undefined ? { statusText } : {}),
  });

  const pending: PendingManualBackgroundToolExecution<ToolRequest> = {
    kind: "manual",
    request,
    toolName,
    statusText,
    output: undefined,
    failed: undefined,
  };
  runtime.pendingBackgroundToolExecution = pending;

  const requestForExecution =
    runtime.options.toolExecutor.attachRequestMetadata?.(request, {
      toolName,
      onOutputChunk: (chunk) => {
        runtime.emitEvent({
          kind: "tool-execution-output-chunk",
          toolCallId: `manual:${toolName}`,
          toolName,
          request,
          chunk,
        });
      },
    }) ?? request;

  void runtime.options.toolExecutor
    .execute(requestForExecution)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = output.execution?.failed === true;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = createToolExecutionTextOutput(`[tool error] ${renderError(error)}`);
        pending.failed = true;
      }
    });

  return statusText;
}

export async function pollPendingBackgroundToolExecution<Config, State, ToolRequest>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest>,
): Promise<void> {
  const pending = runtime.pendingBackgroundToolExecution;
  if (!pending || pending.output === undefined || pending.failed === undefined) {
    return;
  }

  // Keep the finished execution occupying the slot for the whole async commit below.
  // The slot is released only synchronously with starting the next deferred execution;
  // clearing it earlier would open a window where a concurrently-scheduled early execution
  // starts in the free slot and is then overwritten by the deferred start, losing its result.
  runtime.pendingBackgroundToolStatusStore = undefined;
  runtime.emitEvent({
    kind: "background-tool-status",
    phase: "finished",
    toolName: pending.toolName,
    request: pending.request,
    ...(pending.statusText !== undefined ? { statusText: pending.statusText } : {}),
    failed: pending.failed,
  });

  if (pending.kind === "manual") {
    runtime.pendingBackgroundToolExecution = undefined;
    runtime.completedManualToolCommandResultStore = {
      kind: "completed",
      request: pending.request,
      toolName: pending.toolName,
      output: pending.output.summaryText,
      failed: pending.failed,
      backgroundExecution: true,
    };
    return;
  }

  commitToolExecutionOutput(runtime, pending.turn, {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    output: pending.output,
    failed: pending.failed,
  });
  try {
    await runPostToolUseSideEffects(
      runtime as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      {
        id: pending.toolCallId,
        name: pending.toolName,
        argumentsJson: pending.argumentsJson,
      },
      pending.postHookToolInput ?? toolInputFromArgumentsJson(pending.argumentsJson),
      pending.output,
      Math.max(0, Date.now() - pending.startedAtUnixMs),
      pending.failed,
    );

    await prepareAndSyncRuntimeToolResultToHistory(
      runtime,
      pending.toolCallId,
      pending.output.summaryText,
    );
  } catch (error) {
    // On commit failure, release the slot so the finished execution is not re-committed on
    // the next poll; the result is lost either way, so surface the error unchanged.
    if (runtime.pendingBackgroundToolExecution === pending) {
      runtime.pendingBackgroundToolExecution = undefined;
    }
    throw error;
  }
  const continuationState = buildBackgroundToolContinuationState(runtime, pending.pendingUserInput);
  runtime.advanceTurnToolState?.(pending.turn, continuationState);
  // Release the slot and hand off to the next deferred execution atomically (no await in
  // between), so no concurrently-scheduled execution can slip into the free slot here.
  runtime.pendingBackgroundToolExecution = undefined;
  if (runtime.deferredBackgroundToolExecutions.length > 0) {
    startNextDeferredBackgroundToolExecution(runtime, continuationState);
    return;
  }
  if (pending.remainingCalls.length > 0) {
    runtime.queuePendingToolCallContinuation(
      continuationState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
      pending.resumeAsStreaming,
      pending.streamingEmitBeginResponse,
      pending.earlyToolExecutions,
    );
    return;
  }

  if (hasOutstandingToolTurnWork(runtime)) {
    return;
  }

  if (pending.resumeAsStreaming) {
    await runtime.startStreamingRound(
      continuationState,
      pending.pendingUserInput,
      pending.turn,
      pending.streamingEmitBeginResponse,
    );
    return;
  }

  runtime.startToolAgentRoundAsync(continuationState, pending.pendingUserInput, pending.turn);
}
