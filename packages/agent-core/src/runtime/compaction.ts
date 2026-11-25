import { setImmediate as waitForImmediate } from "node:timers/promises";

import { MANUAL_COMPACTION_SKIPPED_STATUS } from "../compaction-ui-status.js";
import type { CompactHistoryManualContext, LlmMessage } from "../ports.js";
import { resolveHookSessionContext } from "../hooks/integration.js";
import {
  prepareToolOutputTruncationForHistory,
  prepareToolOutputTruncationForToolAgentState,
} from "../tool-output-truncation.js";

import { cloneHistory, renderError } from "./helpers.js";
import type {
  AgentRuntimeOptions,
  PendingHistoryCompaction,
  PendingManualHistoryCompaction,
  PendingAutoHistoryCompaction,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeManualHistoryCompactionResult,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from "./types.js";

export interface CompactionRuntime<Config, State, ToolRequest> {
  options: AgentRuntimeOptions<Config, State, ToolRequest>;
  historyStore: LlmMessage[];
  compactionTextStore: string;
  pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  completedManualHistoryCompactionResultStore: RuntimeManualHistoryCompactionResult | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  completeTurn(result: RuntimeTurnResult<State, ToolRequest>): void;
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
  takeCompletedManualHistoryCompactionResult(): RuntimeManualHistoryCompactionResult | undefined;
  isBusy(): boolean;
  poll(): Promise<void>;
  syncSessionTranscriptFromHistory(history?: readonly LlmMessage[]): Promise<string | undefined>;
}

function buildCompactionRecord(
  result: {
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  },
  summary: string | undefined,
  transcriptDirPath: string | undefined,
): RuntimeCompactionRecord {
  return {
    droppedMessages: result.droppedMessages,
    beforeLength: result.beforeLength,
    afterLength: result.afterLength,
    ...(summary !== undefined ? { summary } : {}),
    ...(transcriptDirPath !== undefined ? { transcriptDirPath } : {}),
  };
}

function shouldPrepareToolOutputTruncation<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
): boolean {
  return (
    runtime.options.truncateHistoryForCompaction !== undefined ||
    runtime.options.persistToolOutputArchive !== undefined
  );
}

export async function prepareStateForContextRetryAsync<Config, State, ToolRequest>(
  options: AgentRuntimeOptions<Config, State, ToolRequest>,
  state: State,
): Promise<{ state: State; changed: boolean }> {
  if (!options.truncateStateForContextRetry && !options.persistToolOutputArchive) {
    return { state, changed: false };
  }

  const sessionId = resolveHookSessionContext(options).sessionId;
  const prepareOptions = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(options.persistToolOutputArchive !== undefined
      ? { persistArchive: options.persistToolOutputArchive }
      : {}),
  };
  return prepareToolOutputTruncationForToolAgentState(state as never, prepareOptions) as Promise<{
    state: State;
    changed: boolean;
  }>;
}

async function prepareHistoryForCompaction<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
  archiveSourceHistory: LlmMessage[],
): Promise<LlmMessage[]> {
  if (!shouldPrepareToolOutputTruncation(runtime)) {
    return cloneHistory(archiveSourceHistory);
  }

  const sessionId = resolveHookSessionContext(runtime.options).sessionId;
  const prepareOptions = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(runtime.options.persistToolOutputArchive !== undefined
      ? { persistArchive: runtime.options.persistToolOutputArchive }
      : {}),
  };
  const prepared = await prepareToolOutputTruncationForHistory(
    archiveSourceHistory,
    prepareOptions,
  );
  return cloneHistory(prepared.history);
}

export async function compactHistoryImmediate<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
): Promise<RuntimeCompactionRecord> {
  const archiveSourceHistory = cloneHistory(runtime.historyStore);
  const transcriptDirPath = await runtime.syncSessionTranscriptFromHistory(archiveSourceHistory);
  const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
  runtime.historyStore = cloneHistory(historyForCompaction);

  const compactionContext: CompactHistoryManualContext | undefined =
    transcriptDirPath !== undefined ? { transcriptDirPath } : undefined;

  const result = await runtime.options.llmTransport.compactHistoryManual(
    runtime.options.config,
    runtime.historyStore,
    undefined,
    compactionContext,
  );
  if (result.droppedMessages > 0) {
    runtime.options.nestedAgentsTracker?.resetForCompaction();
  }
  const summary = runtime.options.llmTransport.compactSummaryText(runtime.historyStore);
  return buildCompactionRecord(result, summary, transcriptDirPath);
}

export function startHistoryCompactionAsync<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
  retryState: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
  originalError: string,
  toolTruncationApplied: boolean,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
): void {
  runtime.compactionTextStore = "";
  const pending: PendingAutoHistoryCompaction<State, ToolRequest> = {
    kind: "auto-retry",
    pendingUserInput,
    retryState,
    turn,
    originalError,
    toolTruncationApplied,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    compactedHistory: undefined,
    result: undefined,
    failure: undefined,
  };
  runtime.pendingHistoryCompaction = pending;

  void (async () => {
    try {
      const archiveSourceHistory = cloneHistory(runtime.historyStore);
      const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
      runtime.historyStore = cloneHistory(historyForCompaction);
      launchHistoryCompaction(runtime, pending, historyForCompaction, archiveSourceHistory);
    } catch (error: unknown) {
      if (runtime.pendingHistoryCompaction !== pending) {
        return;
      }
      pending.failure = renderError(error);
    }
  })();
}

export function startManualHistoryCompactionAsync<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
): void {
  runtime.compactionTextStore = "";
  const pending: PendingManualHistoryCompaction = {
    kind: "manual",
    compactedHistory: undefined,
    result: undefined,
    failure: undefined,
  };
  runtime.pendingHistoryCompaction = pending;

  void (async () => {
    try {
      const archiveSourceHistory = cloneHistory(runtime.historyStore);
      const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
      runtime.historyStore = cloneHistory(historyForCompaction);
      launchHistoryCompaction(runtime, pending, historyForCompaction, archiveSourceHistory);
    } catch (error: unknown) {
      if (runtime.pendingHistoryCompaction !== pending) {
        return;
      }
      pending.failure = renderError(error);
    }
  })();
}

export function launchHistoryCompaction<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
  pending: PendingHistoryCompaction<State, ToolRequest>,
  history: LlmMessage[],
  archiveSourceHistory: LlmMessage[],
): void {
  runtime.pendingHistoryCompaction = pending;

  void (async () => {
    try {
      const transcriptDirPath =
        await runtime.syncSessionTranscriptFromHistory(archiveSourceHistory);
      const compactionContext: CompactHistoryManualContext | undefined =
        transcriptDirPath !== undefined ? { transcriptDirPath } : undefined;

      const result = await runtime.options.llmTransport.compactHistoryManual(
        runtime.options.config,
        history,
        (chunk) => {
          if (runtime.pendingHistoryCompaction !== pending || !chunk) {
            return;
          }

          runtime.compactionTextStore += chunk;
          runtime.emitEvent({
            kind: "update-pending-assistant-compaction",
            text: runtime.compactionTextStore,
          });
        },
        compactionContext,
      );

      if (runtime.pendingHistoryCompaction !== pending) {
        return;
      }

      const summary = runtime.options.llmTransport.compactSummaryText(history);
      pending.compactedHistory = cloneHistory(history);
      pending.result = buildCompactionRecord(result, summary, transcriptDirPath);
    } catch (error: unknown) {
      if (runtime.pendingHistoryCompaction === pending) {
        pending.failure = renderError(error);
      }
    }
  })();
}

export async function pollPendingHistoryCompaction<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
): Promise<void> {
  const pending = runtime.pendingHistoryCompaction;
  if (!pending || (pending.result === undefined && pending.failure === undefined)) {
    return;
  }

  runtime.pendingHistoryCompaction = undefined;
  if (pending.kind === "manual") {
    if (pending.failure !== undefined) {
      runtime.emitEvent({
        kind: "replace-pending-assistant",
        text: `Compaction failed: ${pending.failure}`,
      });
      runtime.emitEvent({ kind: "assistant-response-completed" });
      runtime.compactionTextStore = "";
      runtime.completedManualHistoryCompactionResultStore = {
        kind: "failed",
        error: `Compaction failed: ${pending.failure}`,
      };
      return;
    }

    const result = pending.result;
    const compactedHistory = pending.compactedHistory;
    if (!result || !compactedHistory) {
      runtime.emitEvent({
        kind: "replace-pending-assistant",
        text: "Compaction failed: no valid result produced",
      });
      runtime.emitEvent({ kind: "assistant-response-completed" });
      runtime.compactionTextStore = "";
      runtime.completedManualHistoryCompactionResultStore = {
        kind: "failed",
        error: "Compaction failed: no valid result was produced",
      };
      return;
    }

    runtime.historyStore = compactedHistory;
    if (result.droppedMessages > 0) {
      runtime.options.nestedAgentsTracker?.resetForCompaction();
    }
    if (!runtime.compactionTextStore.trim() && result.summary?.trim()) {
      runtime.compactionTextStore = result.summary;
      runtime.emitEvent({
        kind: "update-pending-assistant-compaction",
        text: runtime.compactionTextStore,
      });
    }

    runtime.emitEvent({
      kind: "replace-pending-assistant",
      text:
        result.droppedMessages === 0
          ? MANUAL_COMPACTION_SKIPPED_STATUS
          : `Compaction complete: context messages ${result.beforeLength} -> ${result.afterLength}, merged ${result.droppedMessages} history messages.`,
    });
    runtime.emitEvent({ kind: "assistant-response-completed" });
    runtime.compactionTextStore = "";
    runtime.completedManualHistoryCompactionResultStore = {
      kind: "completed",
      result,
    };
    return;
  }

  if (pending.failure !== undefined) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: "replace-pending-assistant",
        text: `Context compaction failed: ${pending.failure} | Original error: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: "assistant-response-completed" });
    } else {
      runtime.completeTurn({
        kind: "failed",
        error: `Context compaction failed: ${pending.failure} | Original error: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  const result = pending.result;
  const compactedHistory = pending.compactedHistory;
  if (!result || !compactedHistory) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: "replace-pending-assistant",
        text: `Context compaction failed: no valid result was produced | Original error: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: "assistant-response-completed" });
    } else {
      runtime.completeTurn({
        kind: "failed",
        error: `Context compaction failed: no valid result was produced | Original error: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  runtime.historyStore = compactedHistory;
  if (result.droppedMessages > 0) {
    runtime.options.nestedAgentsTracker?.resetForCompaction();
  }
  pending.turn.compactions.push(result);
  if (!runtime.compactionTextStore.trim() && result.summary?.trim()) {
    runtime.compactionTextStore = result.summary;
    runtime.emitEvent({
      kind: "update-pending-assistant-compaction",
      text: runtime.compactionTextStore,
    });
  }

  if (result.droppedMessages === 0 && !pending.toolTruncationApplied) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: "replace-pending-assistant",
        text: `Context limit detected, but history cannot be compacted further. Original error: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: "assistant-response-completed" });
    } else {
      runtime.completeTurn({
        kind: "failed",
        error: `Context limit detected, but history cannot be compacted further. Original error: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  const nextState =
    result.droppedMessages === 0
      ? pending.retryState
      : runtime.options.rebuildRetryStateAfterCompaction
        ? runtime.options.rebuildRetryStateAfterCompaction(
            runtime.historyStore,
            pending.pendingUserInput,
            pending.retryState,
          )
        : runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput);

  if (pending.resumeAsStreaming) {
    await runtime.startStreamingRound(
      nextState,
      pending.pendingUserInput,
      pending.turn,
      pending.streamingEmitBeginResponse,
    );
    return;
  }

  runtime.startToolAgentRoundAsync(nextState, pending.pendingUserInput, pending.turn);
}

export async function waitForCompletedManualHistoryCompactionResult<Config, State, ToolRequest>(
  runtime: CompactionRuntime<Config, State, ToolRequest>,
): Promise<RuntimeManualHistoryCompactionResult> {
  while (true) {
    const existing = runtime.takeCompletedManualHistoryCompactionResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a manual compaction result.");
    }

    await runtime.poll();

    const result = runtime.takeCompletedManualHistoryCompactionResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a manual compaction result.");
    }

    await waitForImmediate();
  }
}
