import {
  isResponsesBuiltInToolName,
  parseMoonshotFormulaSpiritUiFromArgumentsJson,
  parseResponsesBuiltInToolUiFromArgumentsJson,
  previewRequestFromStreamingArguments,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
  type JsonObject,
  type RuntimeEvent,
  type RuntimeToolExecution,
  type RuntimeTurnResult,
} from "@spiritagent/agent-core";
import { toolCallPhaseShowsShimmer } from "../lib/tool-call-shimmer.js";
import type { HostExtensionEvent } from "@spiritagent/host-internal";

import {
  attachEditFileLineDelta,
  type AttachEditFileLineDeltaSource,
  type EditFileLineDelta,
  preserveDeleteFileBaseline,
  preserveDeleteFileLineDelta,
} from "../lib/edit-file-line-delta.js";
import {
  FILE_DIFF_TOOL_NAMES,
  preserveFileToolDiffArguments,
  serializeFileToolDiffArgumentsJson,
} from "../lib/file-tool-diff-source.js";
import i18n from "../lib/i18n-host.js";
import {
  diagnosticsPathsHeadlineDetail,
  parseDiagnosticsPathsFromRequest,
} from "../lib/diagnostics-path-display.js";
import { resolveTodoWriteBeforeSnapshot } from "../lib/todo-tool-display.js";
import {
  buildContextUsagePercent,
  type ContextUsageModelProfile,
  parseModelContextLength,
  resolveModelContextLength,
  supportsContextUsageProvider,
} from "../lib/context-usage.js";
import type {
  ConversationContextUsageSnapshot,
  ConversationMessageSnapshot,
  DesktopModelCatalogHint,
  ToolBlockSnapshot,
} from "../types.js";
import type { DesktopToolRequest } from "./contracts.js";
import type { DesktopHostRuntime } from "./runtime.js";
import type { DesktopAssistantMessageStateMachine } from "./assistant-message-state.js";
import type { DesktopConversationSnapshotView } from "./conversation-snapshot.js";
import type { DesktopMessageTimeline, DesktopTimelineSegmentKind } from "./message-timeline.js";
import { hasAssistantToolInCurrentTurn } from "../lib/conversation-thinking-ui.js";
import {
  assistantPrefixBeforeFirstToolInCurrentTurn,
  assistantTurnHasPlainPrefixMessage,
  finishTaskNoticeFromExecution,
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromExecution,
  applyToolCallSummaryCopy,
  hasActiveSubagentToolInMessages,
  hasInFlightSubagentDelegationInMessages,
  isSubagentStatusSurfaceText,
  toolCallSummaryCopyForResponsesBuiltInTool,
  toolCallSummaryForPhase,
  toolCallSummaryForStreamingPreview,
  type ToolCallSummaryCopy,
  isFinishTaskToolName,
  lastAssistantPlainTextInHistory,
  latestUnsyncedAssistantTextInCurrentTurn,
  messageOrderDebugLevel,
  summarizeMessagesTailForOrderDebug,
  summarizeToolRowsForDebug,
  stripReasonLineFromShellPrompt,
  toolMessageKey,
} from "./message-ordering.js";

export interface DesktopRuntimeEventOrchestratorOptions {
  runtime: () => DesktopHostRuntime | undefined;
  messages: () => ConversationMessageSnapshot[];
  allocateMessageId: () => number;
  assistantMessages: DesktopAssistantMessageStateMachine;
  messageTimeline?: () => DesktopMessageTimeline | undefined;
  takeNextAssistantSegmentKind?: () => DesktopTimelineSegmentKind;
  conversationSnapshotView: DesktopConversationSnapshotView;
  clearCurrentTurnSkills: () => void;
  setLastRuntimeError: (error: string) => void;
  refreshArchiveFromRuntime: () => void;
  dispatchExtensionEvent: (event: HostExtensionEvent) => void;
  bindFileChangesToToolMessage: (
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ) => void;
  onTodoStoreMutated?: () => void;
  /** Incremental copy for the todo_write tool card: returns the session TODOs from before execution. */
  todoItemsBeforeWrite?: () => ReadonlyArray<{
    title: string;
    status: "pending" | "in_progress" | "completed";
  }>;
  /** delete_file: reads the file from disk by path before deletion and counts lines */
  lineDeltaForDeleteFile?: (inputPath: string) => EditFileLineDelta | undefined;
  /** delete_file: reads the full file from disk by path before deletion as the baseline */
  deleteFileBaselineForPath?: (inputPath: string) => string | undefined;
  resolveActiveModel?: () => ContextUsageModelProfile | undefined;
  resolveCatalogHints?: () => DesktopModelCatalogHint[] | undefined;
  setContextUsage?: (usage: ConversationContextUsageSnapshot | undefined) => void;
  refreshContextUsageCatalog?: (input: {
    usage: { inputTokens: number };
    activeModel: ContextUsageModelProfile;
  }) => void;
  currentWorkspaceRoot?: () => string;
}

export class DesktopRuntimeEventOrchestrator {
  private lastApplyEventBatchId = 0;
  private messageOrderDebugLastVerboseLogMs = 0;
  private activeGenerateImageTools = new Map<string, ToolBlockSnapshot>();
  private activeGenerateVideoTools = new Map<string, ToolBlockSnapshot>();
  /**
   * In a tool-less turn, defer splitting the after-stream thinking into its own row: keep it on the
   * current assistant row's aux until body text arrives and collapses within the same AnimatedCollapse
   * instance; split it into a standalone thinking row when this segment completes.
   */
  private deferredAfterStreamThinking: string | undefined;
  private turnErrorRetryMessageId: number | undefined;

  constructor(private readonly options: DesktopRuntimeEventOrchestratorOptions) {}

  private clearTurnErrorRetryUi(): void {
    if (this.turnErrorRetryMessageId !== undefined) {
      this.options.assistantMessages.removeTurnErrorRetryMessage(this.turnErrorRetryMessageId);
      this.turnErrorRetryMessageId = undefined;
    }
    this.options.messageTimeline?.()?.removeTurnErrorRetryMessage();
  }

  clearTurnErrorRetryState(): void {
    this.clearTurnErrorRetryUi();
  }

  private toolSummaryOptions() {
    const workspaceRoot = this.options.currentWorkspaceRoot?.().trim();
    const todosBeforeWrite = this.options.todoItemsBeforeWrite?.();
    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(todosBeforeWrite !== undefined ? { todosBeforeWrite } : {}),
    };
  }

  private todoWriteBeforeSnapshot(toolCallId: string | undefined) {
    return resolveTodoWriteBeforeSnapshot(
      this.findExistingToolSnapshot(toolCallId)?.todoWriteBeforeTodos,
      this.options.todoItemsBeforeWrite?.() ?? [],
    );
  }

  private shouldSuppressMainTimelineChildToolSurface(toolName: string): boolean {
    if (toolName === "subagent") {
      return false;
    }
    const timelineMessages =
      this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
    return hasInFlightSubagentDelegationInMessages(timelineMessages);
  }

  private findExistingToolSnapshot(toolCallId: string | undefined): ToolBlockSnapshot | undefined {
    if (!toolCallId) {
      return undefined;
    }
    const messages = this.options.messages();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.tool?.toolCallId === toolCallId) {
        return message.tool;
      }
    }
    return undefined;
  }

  private attachLineDelta(
    tool: ToolBlockSnapshot,
    source: Omit<
      AttachEditFileLineDeltaSource,
      "resolveDeleteFileLines" | "resolveDeleteFileBaseline"
    >,
  ): ToolBlockSnapshot {
    const prior = this.findExistingToolSnapshot(tool.toolCallId);
    const attached = attachEditFileLineDelta(tool, {
      ...source,
      resolveDeleteFileLines: this.options.lineDeltaForDeleteFile,
      resolveDeleteFileBaseline: this.options.deleteFileBaselineForPath,
    });
    const withDelta = preserveDeleteFileLineDelta(tool.toolName, attached, prior?.editLineDelta);
    return preserveFileToolDiffArguments(
      tool.toolName,
      preserveDeleteFileBaseline(tool.toolName, withDelta, prior?.deleteFileBaselineText),
      prior,
    );
  }

  reset(): void {
    this.lastApplyEventBatchId = 0;
    this.messageOrderDebugLastVerboseLogMs = 0;
    this.activeGenerateImageTools.clear();
    this.activeGenerateVideoTools.clear();
    this.deferredAfterStreamThinking = undefined;
  }

  /** After-stream thinking deferred in a tool-less turn: split into a standalone thinking row when the segment completes or ends with an empty body. */
  private flushDeferredAfterStreamThinking(
    placement: "after-stream" | "before-next-tool" = "after-stream",
  ): void {
    const deferred = this.deferredAfterStreamThinking;
    if (!deferred) {
      return;
    }
    this.deferredAfterStreamThinking = undefined;
    this.options.messageTimeline?.()?.finalizeThinkingSegment(deferred, placement);
  }

  /**
   * User interrupted a streaming thought: drain first, then finalize the deferred aux, to avoid duplicating the split row with the pending row and shifting the layout down.
   */
  finalizeInterruptedDeferredThinking(
    input: {
      thinkingText?: string;
      compactionText?: string;
    } = {},
  ): void {
    const thinking = input.thinkingText?.trim() || this.deferredAfterStreamThinking?.trim() || "";
    this.deferredAfterStreamThinking = undefined;
    const timeline = this.options.messageTimeline?.();
    if (!timeline) {
      return;
    }
    if (thinking) {
      timeline.finalizeThinkingSegment(thinking, "after-stream");
      return;
    }
    const compaction = input.compactionText?.trim() ?? "";
    if (compaction) {
      timeline.finalizeCompactionSegment(compaction);
    }
  }

  consumeCompletedTurnResult(): boolean {
    const runtime = this.options.runtime();
    if (!runtime) {
      return false;
    }

    const result = runtime.takeCompletedTurnResult();
    if (!result) {
      return false;
    }

    this.applyCompletedTurnResult(result);
    return true;
  }

  applyCompletedTurnResult(result: RuntimeTurnResult<unknown, DesktopToolRequest>): void {
    this.integrateToolExecutions(result.toolExecutions, "turn-result");
    switch (result.kind) {
      case "completed": {
        this.options.clearCurrentTurnSkills();
        const finishExecution = [...result.toolExecutions]
          .reverse()
          .find((execution) => isFinishTaskToolName(execution.toolName) && !execution.failed);
        const failedFinishTask = result.toolExecutions.some(
          (execution) => isFinishTaskToolName(execution.toolName) && execution.failed,
        );
        const aux = this.options.assistantMessages.takeLatestPendingAux();
        if (finishExecution) {
          const summary = finishTaskSummaryFromExecution(finishExecution);
          const notice = finishTaskNoticeFromExecution(finishExecution);
          this.options.assistantMessages.applyFinishTaskNotice(
            notice,
            result.assistantText,
            aux,
            summary,
          );
          this.options
            .messageTimeline?.()
            ?.materializeFinishTaskNotice(notice, summary || result.assistantText);
        } else if (failedFinishTask) {
          this.clearFinishTaskNoticePreview();
        } else if (result.assistantText.trim()) {
          this.clearTurnErrorRetryUi();
          if (
            !this.options.assistantMessages.materializeExistingCompletedAssistantMessage(
              result.assistantText,
              aux,
            )
          ) {
            this.options.assistantMessages.appendAssistantMessage(result.assistantText, aux);
          }
          this.options
            .messageTimeline?.()
            ?.materializeCompletedAssistantText(result.assistantText, aux);
        } else {
          // On streaming done with an empty body, only remove-pending-assistant runs, then clearStreamingUiState
          // finalizes the thinking; no assistant-response-completed is emitted, so consume the deferred aux and split the row here.
          this.flushDeferredAfterStreamThinking();
          this.options.messageTimeline?.()?.completeActiveAssistantSegment();
        }
        this.options.setLastRuntimeError("");
        break;
      }
      case "failed":
        this.options.clearCurrentTurnSkills();
        {
          const aux = this.options.assistantMessages.takeLatestPendingAux();
          const errorAux = {
            ...aux,
            turnError: true as const,
          };
          if (this.turnErrorRetryMessageId !== undefined) {
            this.options.assistantMessages.materializeTurnErrorFailureMessage(
              this.turnErrorRetryMessageId,
              result.error,
              errorAux,
            );
            this.turnErrorRetryMessageId = undefined;
          } else if (
            !this.options.assistantMessages.materializeExistingCompletedAssistantMessage(
              result.error,
              errorAux,
            )
          ) {
            this.options.assistantMessages.appendAssistantMessage(result.error, errorAux);
          }
          this.options
            .messageTimeline?.()
            ?.materializeTurnErrorFailureMessage(result.error, errorAux);
        }
        this.options.setLastRuntimeError(result.error);
        break;
      case "requires-approval":
      case "requires-questions":
        this.syncPendingToolStates();
        this.syncAssistantPrefixFromHistoryBeforeToolRow();
        this.options.setLastRuntimeError("");
        break;
      default:
        break;
    }

    this.options.refreshArchiveFromRuntime();
  }

  syncTurnTailState(): void {
    this.syncPendingToolStates();
    this.syncAssistantPrefixFromHistoryBeforeToolRow();
  }

  applyRuntimeHostEvents(events: RuntimeEvent<DesktopToolRequest>[]): void {
    const messages = this.options.messages();
    const batchId =
      events.length > 0 ? (this.lastApplyEventBatchId += 1) : this.lastApplyEventBatchId;
    for (const event of events) {
      if (event.kind === "begin-assistant-response") {
        this.deferredAfterStreamThinking = undefined;
        const insertAt = messages.length;
        const shouldReanchorStandalonePendingAux =
          this.options.conversationSnapshotView.shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
            messages[messages.length - 1],
          );
        const pendingAssistant = this.options.assistantMessages.beginAssistantResponse(
          insertAt,
          batchId,
        );
        const timeline = this.options.messageTimeline?.();
        const timelinePendingAssistant = timeline
          ? timeline.beginAssistantSegment(
              this.options.takeNextAssistantSegmentKind?.() ?? "initial",
            )
          : undefined;
        if (shouldReanchorStandalonePendingAux) {
          this.options.conversationSnapshotView.reanchorPersistedStandalonePendingAux(
            timelinePendingAssistant?.id ?? pendingAssistant.id,
          );
        }
        continue;
      }
      if (event.kind === "context-usage-updated") {
        const activeModel = this.options.resolveActiveModel?.();
        const contextLength = resolveModelContextLength(
          activeModel,
          this.options.resolveCatalogHints?.(),
        );
        const shouldRefreshCatalog =
          activeModel !== undefined &&
          contextLength === undefined &&
          supportsContextUsageProvider(activeModel.provider) &&
          parseModelContextLength(activeModel.contextLength) === undefined;
        if (shouldRefreshCatalog) {
          this.options.refreshContextUsageCatalog?.({
            usage: event.usage,
            activeModel,
          });
          continue;
        }
        if (!activeModel || contextLength === undefined) {
          this.options.setContextUsage?.(undefined);
        } else {
          this.options.setContextUsage?.({
            inputTokens: event.usage.inputTokens,
            contextLength,
            percent: buildContextUsagePercent(event.usage.inputTokens, contextLength),
          });
        }
        continue;
      }
      if (event.kind === "turn-error-retry") {
        this.turnErrorRetryMessageId = this.options.assistantMessages.upsertTurnErrorRetryMessage(
          { attempt: event.attempt, maxAttempts: event.maxAttempts },
          this.turnErrorRetryMessageId,
        );
        this.options.messageTimeline?.()?.upsertTurnErrorRetryMessage({
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        });
        continue;
      }
      if (event.kind === "turn-error-retry-cleared") {
        this.clearTurnErrorRetryUi();
        continue;
      }
      if (event.kind === "update-pending-assistant-thinking") {
        const timelineMessages =
          this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
        if (hasActiveSubagentToolInMessages(timelineMessages)) {
          continue;
        }
        const timeline = this.options.messageTimeline?.();
        if (
          timeline &&
          event.text.trim() &&
          timeline.hasFinalizedAuxInActiveSegment("thinking", event.text)
        ) {
          continue;
        }
        this.options.assistantMessages.updatePendingAssistantAux("thinking", event.text);
        timeline?.updatePendingAssistantAux("thinking", event.text);
        continue;
      }
      if (event.kind === "update-pending-assistant-compaction") {
        this.options.assistantMessages.updatePendingAssistantAux("compacting", event.text);
        this.options.messageTimeline?.()?.updatePendingAssistantAux("compacting", event.text);
        continue;
      }
      if (event.kind === "assistant-chunk") {
        const timelineMessagesForChunk = this.options.messageTimeline?.()?.toMessages() ?? messages;
        if (hasActiveSubagentToolInMessages(timelineMessagesForChunk)) {
          continue;
        }
        this.options.assistantMessages.appendPendingAssistantChunk(event.text);
        this.options.messageTimeline?.()?.appendAssistantTextChunk(event.text);
        continue;
      }
      if (event.kind === "replace-pending-assistant") {
        this.options.assistantMessages.replacePendingAssistantText(event.text);
        this.options.messageTimeline?.()?.replaceAssistantText(event.text);
        continue;
      }
      if (event.kind === "assistant-response-completed") {
        this.finalizeResponsesBuiltInToolPreviews(messages);
        this.options.assistantMessages.completePendingAssistantMessage();
        // The collapse animation has already finished on the same instance; now split the thinking into its own row (consistent with the persisted structure).
        this.flushDeferredAfterStreamThinking();
        this.options.messageTimeline?.()?.completeActiveAssistantSegment();
        continue;
      }
      if (event.kind === "remove-pending-assistant") {
        this.options.assistantMessages.removePendingAssistantMessage();
        const timeline = this.options.messageTimeline?.();
        timeline?.removePendingAssistantText();
        const runtime = this.options.runtime();
        if (timeline && runtime?.isBusy()) {
          timeline.ensureAfterToolsThinkingPlaceholderRow();
          runtime.expectLiveReasoningPlaceholder?.();
        }
        continue;
      }
      if (event.kind === "assistant-thinking-segment-finalized") {
        if (event.text.trim()) {
          const timeline = this.options.messageTimeline?.();
          const turnHasTools =
            messages.length > 0 && hasAssistantToolInCurrentTurn(messages, messages.length - 1);
          const activeTurnHasTools = timeline?.activeTurnHasToolRows() ?? false;
          const segmentHasPreToolBody = timeline?.activeSegmentHasPreToolAssistantBody() ?? false;
          const deferAfterStream =
            event.placement === "after-stream" &&
            Boolean(timeline) &&
            !activeTurnHasTools &&
            !turnHasTools &&
            !segmentHasPreToolBody;
          if (!timeline) {
            this.options.assistantMessages.appendAssistantThinkingSegment(event.text);
          }
          if (deferAfterStream && timeline) {
            if (timeline.hasFinalizedAuxInActiveSegment("thinking", event.text)) {
              continue;
            }
            // Tool-less: do not split the row yet. Keep the thinking on the current assistant row's aux;
            // when body text arrives it transitions from expanded to collapsed within the same
            // AnimatedCollapse instance; split the row when this segment completes.
            timeline.updatePendingAssistantAux("thinking", event.text);
            this.deferredAfterStreamThinking = event.text;
          } else {
            timeline?.finalizeThinkingSegment(event.text, event.placement);
          }
        }
        continue;
      }
      if (event.kind === "tool-call-started") {
        if (isFinishTaskToolName(event.toolName)) {
          continue;
        }
        if (this.shouldSuppressMainTimelineChildToolSurface(event.toolName)) {
          continue;
        }
        const runningSummary =
          event.toolName === "generate_image"
            ? { headline: i18n.t("tool.generateImage", { context: "running" }) }
            : event.toolName === "generate_video"
              ? { headline: i18n.t("tool.generateVideo", { context: "running" }) }
              : event.toolName === "get_diagnostics"
                ? diagnosticsCheckingSummary(event.request)
                : toolCallSummaryForPhase(
                    "running",
                    event.toolName,
                    event.request,
                    this.toolSummaryOptions(),
                  );
        const runningTool: ToolBlockSnapshot = this.attachLineDelta(
          applyToolCallSummaryCopy(
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              phase: "running",
              headline: runningSummary.headline,
              detailLines: [],
              argsExcerpt: truncateJson(event.request),
              ...(event.toolName === "todo_write"
                ? { todoWriteBeforeTodos: [...this.todoWriteBeforeSnapshot(event.toolCallId)] }
                : {}),
            },
            runningSummary,
          ),
          { request: event.request },
        );
        if (event.toolName === "generate_image") {
          this.activeGenerateImageTools.set(event.toolCallId, runningTool);
        }
        if (event.toolName === "generate_video") {
          this.activeGenerateVideoTools.set(event.toolCallId, runningTool);
        }
        this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
        this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
        this.options.dispatchExtensionEvent({
          type: "onToolCall",
          detail: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            request: event.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind === "approval-resolved") {
        this.integrateApprovalResolution(event, batchId);
        this.options.dispatchExtensionEvent({
          type: "onApprovalResolved",
          detail: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            decisionKind: event.decisionKind,
            request: event.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind === "tool-execution-output-chunk") {
        if (this.shouldSuppressMainTimelineChildToolSurface(event.toolName)) {
          continue;
        }
        const existing = this.findExistingToolSnapshot(event.toolCallId);
        if (!existing) {
          continue;
        }
        const updated: ToolBlockSnapshot = {
          ...existing,
          outputExcerpt: `${existing.outputExcerpt ?? ""}${event.chunk}`,
        };
        this.options.assistantMessages.upsertToolMessage(event.toolCallId, updated, batchId);
        this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, updated);
        continue;
      }
      if (event.kind === "tool-execution-finished") {
        if (this.shouldSuppressMainTimelineChildToolSurface(event.execution.toolName)) {
          continue;
        }
        if (event.execution.toolName === "generate_image" && event.execution.toolCallId) {
          this.activeGenerateImageTools.delete(event.execution.toolCallId);
        }
        if (event.execution.toolName === "generate_video" && event.execution.toolCallId) {
          this.activeGenerateVideoTools.delete(event.execution.toolCallId);
        }
        this.integrateToolExecutions([event.execution], "event");
        if (this.options.runtime()?.isBusy()) {
          const placeholder = this.options
            .messageTimeline?.()
            ?.ensureAfterToolsThinkingPlaceholderRow();
          if (placeholder) {
            this.options.runtime()?.expectLiveReasoningPlaceholder?.();
          }
        }
        this.options.dispatchExtensionEvent({
          type: "onToolResult",
          detail: {
            toolCallId: event.execution.toolCallId,
            toolName: event.execution.toolName,
            output: event.execution.output,
            failed: event.execution.failed,
            request: event.execution.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind !== "streaming-tool-preview") {
        continue;
      }
      if (isFinishTaskToolName(event.toolName)) {
        const notice = finishTaskNoticePreviewFromArguments(event.argumentsJson);
        if (notice) {
          this.applyFinishTaskNoticePreview(notice);
        }
        continue;
      }
      if (this.shouldSuppressMainTimelineChildToolSurface(event.toolName)) {
        continue;
      }
      // Before the tool preview, materialize the thinking deferred on the body aux into its own row (before-tools), so inserting the tool does not strip it away.
      this.flushDeferredAfterStreamThinking("before-next-tool");
      const isResponsesBuiltIn = isResponsesBuiltInToolName(event.toolName);
      const formulaUi = isResponsesBuiltIn
        ? parseMoonshotFormulaSpiritUiFromArgumentsJson(event.argumentsJson)
        : undefined;
      const providerUi = isResponsesBuiltIn
        ? parseResponsesBuiltInToolUiFromArgumentsJson(event.argumentsJson)
        : undefined;
      const suppressExpand =
        formulaUi?.suppressExpand === true || providerUi?.suppressExpand === true;
      const previewRequest = previewRequestFromStreamingArguments(
        event.toolName,
        event.argumentsJson,
      );
      const argsExcerpt = providerUi?.inputExcerpt?.trim()
        ? providerUi.inputExcerpt
        : previewRequest !== undefined
          ? truncateJson(previewRequest)
          : truncateText(event.argumentsJson, 4_000);
      const previewSummary = toolCallSummaryForStreamingPreview(
        messages,
        event.toolCallId,
        event.toolName,
        previewRequest,
        {
          ...this.toolSummaryOptions(),
          streamingArgumentsJson: event.argumentsJson,
        },
      );
      const responsesBuiltInPhase = isResponsesBuiltIn
        ? resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(event.argumentsJson)
        : undefined;
      const toolPhase: ToolBlockSnapshot["phase"] =
        responsesBuiltInPhase === "succeeded"
          ? "succeeded"
          : responsesBuiltInPhase === "failed"
            ? "failed"
            : "preview";
      const summaryCopy = isResponsesBuiltIn
        ? toolCallSummaryCopyForResponsesBuiltInTool(
            event.toolName,
            toolPhase,
            previewSummary,
            providerUi,
          )
        : previewSummary;
      const runningTool: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            phase: toolPhase,
            headline: summaryCopy.headline,
            detailLines: providerUi?.detailLines ?? [],
            argsExcerpt,
            ...(providerUi?.outputExcerpt ? { outputExcerpt: providerUi.outputExcerpt } : {}),
            ...(suppressExpand ? { suppressExpand: true } : {}),
            ...(FILE_DIFF_TOOL_NAMES.has(event.toolName) ||
            event.toolName === "tool_call" ||
            event.toolName === "tool_describe" ||
            event.toolName === "subagent"
              ? { streamingArgumentsJson: event.argumentsJson }
              : {}),
            ...(event.toolName === "todo_write"
              ? { todoWriteBeforeTodos: [...this.todoWriteBeforeSnapshot(event.toolCallId)] }
              : {}),
          },
          summaryCopy,
        ),
        // preview: every argument delta batch recomputes line additions/removals; large edits skip LCS and are fully recomputed on the completion event
        { argumentsJson: event.argumentsJson, preview: true },
      );
      this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
      this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
      if (
        isResponsesBuiltIn &&
        (toolPhase === "succeeded" || toolPhase === "failed") &&
        this.options.runtime()?.isBusy()
      ) {
        // On Gateway resume with pre-tool body text, remove-pending-assistant is not emitted (body non-empty),
        // so the placeholder row cannot hang off that event alone; seed the after-tools Thinking placeholder as soon as a built-in tool's final state lands.
        this.options.messageTimeline?.()?.ensureAfterToolsThinkingPlaceholderRow();
      }
    }
    this.logMessageOrderApplyBatch(batchId, events, messages);
  }

  syncAssistantPrefixFromHistoryBeforeToolRow(): void {
    const runtime = this.options.runtime();
    if (!runtime) {
      return;
    }
    const messages = this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
    if (hasActiveSubagentToolInMessages(messages)) {
      return;
    }

    const pendingTrim = runtime.pendingAssistantText().trim();
    const awaitingInteractive =
      Boolean(runtime.currentPendingApproval()) || Boolean(runtime.currentPendingQuestions());

    if (pendingTrim && !awaitingInteractive) {
      return;
    }

    const history = runtime.history();
    const prefixFromUnsyncedLatest = latestUnsyncedAssistantTextInCurrentTurn(history, messages);
    const prefixFromBeforeFirst = assistantPrefixBeforeFirstToolInCurrentTurn(history);
    const prefixFromLastAssistant = lastAssistantPlainTextInHistory(history);
    const prefix =
      (awaitingInteractive && pendingTrim
        ? pendingTrim
        : awaitingInteractive
          ? (prefixFromUnsyncedLatest ?? prefixFromLastAssistant ?? prefixFromBeforeFirst)
          : (prefixFromUnsyncedLatest ?? prefixFromBeforeFirst)
      )?.trim() ?? "";
    const messageCount = messages.length;
    const lastMessage = messageCount > 0 ? messages[messageCount - 1] : undefined;

    if (!prefix || messageCount === 0) {
      return;
    }

    if (isSubagentStatusSurfaceText(prefix)) {
      return;
    }

    const hasPlainPrefix = assistantTurnHasPlainPrefixMessage(messages, prefix);
    if (hasPlainPrefix) {
      return;
    }

    const isLaterUnsyncedPrefix =
      !awaitingInteractive &&
      prefixFromUnsyncedLatest !== undefined &&
      prefix === prefixFromUnsyncedLatest &&
      prefixFromUnsyncedLatest !== prefixFromBeforeFirst;

    if (isLaterUnsyncedPrefix) {
      const insertAt = messages.length;
      const before = insertAt > 0 ? messages[insertAt - 1] : undefined;
      if (before?.role === "assistant" && !before.tool && before.content.trim() === prefix) {
        return;
      }
      this.insertAssistantPrefix(insertAt, prefix, `append-unsynced-prefix@${insertAt}`);
      return;
    }

    if (awaitingInteractive) {
      const approval = runtime.currentPendingApproval();
      const questions = runtime.currentPendingQuestions();
      const key = approval
        ? toolMessageKey(approval)
        : questions
          ? toolMessageKey(questions)
          : undefined;
      if (key) {
        const index = messages.findIndex(
          (message) => message.role === "assistant" && message.tool?.toolCallId === key,
        );
        if (index >= 0) {
          const before = index > 0 ? messages[index - 1] : undefined;
          if (before?.role === "assistant" && !before.tool && before.content.trim() === prefix) {
            return;
          }
          this.insertAssistantPrefix(index, prefix, `splice-before-approval@${index}`);
        }
      }
      return;
    }

    if (lastMessage!.role === "user") {
      messages.push({
        id: this.options.allocateMessageId(),
        role: "assistant",
        content: prefix,
        pending: false,
      });
      this.options.messageTimeline?.()?.insertAssistantPrefix(prefix);
      this.logMessageOrderPrefixSync("push-after-user", messages);
      return;
    }

    if (lastMessage!.role === "assistant" && lastMessage!.tool) {
      this.insertAssistantPrefix(messages.length, prefix, "append-prefix-after-tool");
      return;
    }

    if (
      lastMessage!.role === "assistant" &&
      !lastMessage!.tool &&
      lastMessage!.content.trim() &&
      lastMessage!.content.trim() !== prefix
    ) {
      if (!lastMessage!.content.trim().startsWith(prefix)) {
        this.insertAssistantPrefix(messages.length, prefix, "append-prefix-before-tail");
      }
      return;
    }
  }

  syncPendingToolStates(): void {
    const runtime = this.options.runtime();
    const timelineMessages =
      this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
    const suppressSubagentChildToolSurface =
      hasInFlightSubagentDelegationInMessages(timelineMessages);
    const approval = runtime?.currentPendingApproval();
    if (approval && !approval.subagentSessionId && !suppressSubagentChildToolSurface) {
      const approvalSummary = toolCallSummaryForPhase(
        "pending-approval",
        approval.toolName,
        approval.request,
        this.toolSummaryOptions(),
      );
      const fileToolDiffArgumentsJson = FILE_DIFF_TOOL_NAMES.has(approval.toolName)
        ? serializeFileToolDiffArgumentsJson(approval.request)
        : undefined;
      const pendingTool: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: toolMessageKey(approval),
            toolName: approval.toolName,
            phase: "pending-approval",
            headline: approvalSummary.headline,
            detailLines: [
              stripReasonLineFromShellPrompt(approval.toolName, approval.prompt),
              ...(approval.autoReviewBlockReason?.trim()
                ? [
                    i18n.t("app.autoReviewBlockReason", {
                      reason: approval.autoReviewBlockReason.trim(),
                    }),
                  ]
                : []),
            ],
            argsExcerpt: truncateJson(approval.request),
            ...(fileToolDiffArgumentsJson ? { fileToolDiffArgumentsJson } : {}),
          },
          approvalSummary,
        ),
        { request: approval.request },
      );
      this.options.assistantMessages.upsertToolMessage(
        toolMessageKey(approval),
        pendingTool,
        this.lastApplyEventBatchId,
      );
      this.options.messageTimeline?.()?.upsertToolMessage(toolMessageKey(approval), pendingTool);
    }

    const questions = runtime?.currentPendingQuestions();
    if (questions && !suppressSubagentChildToolSurface) {
      const pendingTool: ToolBlockSnapshot = {
        toolCallId: toolMessageKey(questions),
        toolName: questions.toolName,
        phase: "pending-approval",
        headline: i18n.t("tool.awaitingInfo", { toolName: questions.toolName }),
        detailLines: [questions.questions.title ?? i18n.t("tool.answerFormQuestions")],
        argsExcerpt: truncateJson(questions.questions),
      };
      this.options.assistantMessages.upsertToolMessage(
        toolMessageKey(questions),
        pendingTool,
        this.lastApplyEventBatchId,
      );
      this.options.messageTimeline?.()?.upsertToolMessage(toolMessageKey(questions), pendingTool);
    }

    for (const toolMap of [this.activeGenerateImageTools, this.activeGenerateVideoTools]) {
      for (const [toolCallId, tool] of toolMap) {
        const runningTool: ToolBlockSnapshot = {
          ...tool,
          phase: "running",
        };
        this.options.assistantMessages.upsertToolMessage(
          toolCallId,
          runningTool,
          this.lastApplyEventBatchId,
        );
        this.options.messageTimeline?.()?.upsertToolMessage(toolCallId, runningTool);
      }
    }
  }

  private applyFinishTaskNoticePreview(notice: string): void {
    this.options.assistantMessages.updateFinishTaskNoticePreview(notice);
    this.options.messageTimeline?.()?.updateFinishTaskNoticePreview(notice);
  }

  private clearFinishTaskNoticePreview(): void {
    this.options.assistantMessages.clearFinishTaskNoticePreview();
    this.options.messageTimeline?.()?.clearFinishTaskNoticePreview();
  }

  private integrateToolExecutions(
    executions: RuntimeToolExecution<DesktopToolRequest>[],
    source: "event" | "turn-result",
  ): void {
    for (const execution of executions) {
      if (this.shouldSuppressMainTimelineChildToolSurface(execution.toolName)) {
        continue;
      }
      if (isFinishTaskToolName(execution.toolName)) {
        const toolCallId = execution.toolCallId || `tool:${execution.toolName}`;
        this.options.assistantMessages.removeToolMessage(toolCallId);
        this.options.messageTimeline?.()?.removeToolMessage(toolCallId);
        if (execution.failed) {
          this.clearFinishTaskNoticePreview();
        } else {
          const notice = finishTaskNoticeFromExecution(execution);
          if (notice) {
            this.applyFinishTaskNoticePreview(notice);
          }
        }
        continue;
      }
      if (execution.toolName === "generate_image" && execution.toolCallId) {
        this.activeGenerateImageTools.delete(execution.toolCallId);
      }
      if (execution.toolName === "generate_video" && execution.toolCallId) {
        this.activeGenerateVideoTools.delete(execution.toolCallId);
      }
      const callId = execution.toolCallId || `tool:${execution.toolName}`;
      const existingSnapshot = this.findExistingToolSnapshot(callId);
      if (source === "turn-result") {
        if (existingSnapshot?.phase === "succeeded" || existingSnapshot?.phase === "failed") {
          continue;
        }
      }
      const imagePaths = imagePathsFromExecution(execution);
      const videoPaths = videoPathsFromExecution(execution);
      const todosBeforeWrite =
        execution.toolName === "todo_write" ? this.todoWriteBeforeSnapshot(callId) : undefined;
      const executionSummary =
        execution.toolName === "generate_image"
          ? {
              headline: execution.failed
                ? i18n.t("tool.imageGenFailed")
                : i18n.t("tool.imageGenComplete"),
            }
          : execution.toolName === "generate_video"
            ? {
                headline: execution.failed
                  ? i18n.t("tool.videoGenFailed")
                  : i18n.t("tool.videoGenComplete"),
              }
            : toolCallSummaryForPhase(
                execution.failed ? "failed" : "succeeded",
                execution.toolName,
                execution.request,
                execution.toolName === "todo_write"
                  ? {
                      ...this.toolSummaryOptions(),
                      executionOutput: execution.output,
                      todosBeforeWrite,
                    }
                  : execution.toolName === "read_file"
                    ? {
                        ...this.toolSummaryOptions(),
                        executionOutput: execution.output,
                      }
                    : this.toolSummaryOptions(),
              );
      const argsExcerpt = existingSnapshot?.argsExcerpt?.trim()
        ? existingSnapshot.argsExcerpt
        : truncateJson(execution.request);
      const fileToolDiffArgumentsJson = FILE_DIFF_TOOL_NAMES.has(execution.toolName)
        ? serializeFileToolDiffArgumentsJson(execution.request)
        : undefined;
      const toolBlock: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: execution.toolCallId || `tool:${execution.toolName}`,
            toolName: execution.toolName,
            phase: execution.failed ? "failed" : "succeeded",
            headline: executionSummary.headline,
            detailLines: [],
            argsExcerpt,
            outputExcerpt:
              execution.toolName === "shell"
                ? execution.output
                : truncateText(execution.output, 4_000),
            ...(existingSnapshot?.suppressExpand ? { suppressExpand: true } : {}),
            ...(fileToolDiffArgumentsJson ? { fileToolDiffArgumentsJson } : {}),
            ...(imagePaths.length > 0 ? { imagePaths } : {}),
            ...(videoPaths.length > 0 ? { videoPaths } : {}),
            ...(execution.hostUi?.lspWriteDiagnostics
              ? { lspWriteDiagnostics: execution.hostUi.lspWriteDiagnostics }
              : {}),
            ...(todosBeforeWrite !== undefined
              ? { todoWriteBeforeTodos: [...todosBeforeWrite] }
              : {}),
          },
          executionSummary,
        ),
        { request: execution.request },
      );
      const message = this.options.assistantMessages.upsertToolMessage(
        execution.toolCallId || `tool:${execution.toolName}`,
        toolBlock,
        this.lastApplyEventBatchId,
      );
      this.options
        .messageTimeline?.()
        ?.upsertToolMessage(execution.toolCallId || `tool:${execution.toolName}`, toolBlock);
      if (execution.toolName === "subagent") {
        this.options.conversationSnapshotView.clearStandalonePendingAuxState();
      }
      this.options.bindFileChangesToToolMessage(execution, message.id);
      if (execution.toolName.startsWith("todo_")) {
        this.options.onTodoStoreMutated?.();
      }
      this.logToolExecutionIntegration(source, execution, message.id);
    }
  }

  private logToolExecutionIntegration(
    source: "event" | "turn-result",
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    if (messageOrderDebugLevel() !== "verbose") {
      return;
    }

    const messages = this.options.messages();
    const callId = execution.toolCallId || `tool:${execution.toolName}`;
    const images = imagePathsFromExecution(execution).length;
    const videos = videoPathsFromExecution(execution).length;
    console.warn(
      `[desktop-host][tool-flow] integrate source=${source} call=${callId} name=${execution.toolName} phase=${execution.failed ? "failed" : "succeeded"} msg=${messageId} images=${images} videos=${videos} tools=${summarizeToolRowsForDebug(messages, 8)} tail=${summarizeMessagesTailForOrderDebug(messages, 8)}`,
    );
  }

  private finalizeResponsesBuiltInToolPreviews(messages: ConversationMessageSnapshot[]): void {
    for (const message of messages) {
      const tool = message.tool;
      if (!tool || !isResponsesBuiltInToolName(tool.toolName)) {
        continue;
      }
      if (!toolCallPhaseShowsShimmer(tool.phase)) {
        continue;
      }
      const toolCallId = tool.toolCallId?.trim();
      if (!toolCallId) {
        continue;
      }
      const succeededTool: ToolBlockSnapshot = {
        ...tool,
        phase: "succeeded",
      };
      this.options.assistantMessages.upsertToolMessage(toolCallId, succeededTool, 0);
      this.options.messageTimeline?.()?.upsertToolMessage(toolCallId, succeededTool);
    }
  }

  private integrateApprovalResolution(
    event: Extract<RuntimeEvent<DesktopToolRequest>, { kind: "approval-resolved" }>,
    batchId: number,
  ): void {
    const denied = event.decisionKind === "deny" || event.decisionKind === "guidance";
    if (denied) {
      this.activeGenerateImageTools.delete(event.toolCallId);
      this.activeGenerateVideoTools.delete(event.toolCallId);
      // Keep the pending tool row in place; the following tool-execution-finished event
      // updates it to failed. Removing here races with inline approval guidance and
      // re-inserts the tool card after the user's reply.
      return;
    }

    const runningSummary = toolCallSummaryForPhase(
      "running",
      event.toolName,
      event.request,
      this.toolSummaryOptions(),
    );
    const runningTool: ToolBlockSnapshot = this.attachLineDelta(
      applyToolCallSummaryCopy(
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          phase: "running",
          headline: runningSummary.headline,
          detailLines: [],
          argsExcerpt: truncateJson(event.request),
        },
        runningSummary,
      ),
      { request: event.request },
    );
    this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
    this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
  }

  private insertAssistantPrefix(insertAt: number, prefix: string, logLabel: string): void {
    const messages = this.options.messages();
    messages.splice(insertAt, 0, {
      id: this.options.allocateMessageId(),
      role: "assistant",
      content: prefix,
      pending: false,
    });
    this.options.messageTimeline?.()?.insertAssistantPrefix(prefix);
    this.logMessageOrderPrefixSync(logLabel, messages);
  }

  private logMessageOrderApplyBatch(
    batchId: number,
    events: RuntimeEvent<DesktopToolRequest>[],
    messages: ConversationMessageSnapshot[],
  ): void {
    const mode = messageOrderDebugLevel();
    if (mode === "off") return;

    const tags: string[] = [];
    let previewCount = 0;
    for (const event of events) {
      if (event.kind === "begin-assistant-response") {
        tags.push("begin");
      } else if (event.kind === "assistant-response-completed") {
        tags.push("resp-done");
      } else if (event.kind === "remove-pending-assistant") {
        tags.push("rm-pending");
      } else if (event.kind === "assistant-thinking-segment-finalized") {
        tags.push(event.text.trim() ? "finalize" : "finalize-empty");
      } else if (event.kind === "tool-call-started") {
        tags.push(`tool-start:${event.toolName}`);
      } else if (event.kind === "tool-execution-finished") {
        tags.push(`tool-done:${event.execution.toolName}`);
      } else if (event.kind === "approval-resolved") {
        tags.push(`approval-${event.decisionKind}`);
      } else if (event.kind === "approval-requested") {
        tags.push(`approval:${event.approval.toolName}`);
      } else if (event.kind === "questions-requested") {
        tags.push(`questions:${event.questions.toolName}`);
      } else if (event.kind === "streaming-tool-preview") {
        previewCount += 1;
      }
    }

    const hasOrderTags = tags.length > 0;
    if (!hasOrderTags && previewCount === 0) {
      return;
    }

    if (mode === "compact" && !hasOrderTags) {
      return;
    }

    if (!hasOrderTags && previewCount > 0 && mode === "verbose") {
      const now = Date.now();
      if (now - this.messageOrderDebugLastVerboseLogMs < 1200) {
        return;
      }
      this.messageOrderDebugLastVerboseLogMs = now;
      tags.push(`preview×${previewCount}`);
    } else if (hasOrderTags && previewCount > 0 && mode === "verbose") {
      tags.push(`pv×${previewCount}`);
    }

    const tail = summarizeMessagesTailForOrderDebug(messages, 12);
    console.warn(
      `[desktop-host][msg-order] apply#${batchId} kinds=${tags.join(",")} placement=timeline len=${messages.length} tail=${tail}`,
    );
  }

  private logMessageOrderPrefixSync(how: string, messages: ConversationMessageSnapshot[]): void {
    if (messageOrderDebugLevel() === "off") {
      return;
    }
    const tail = summarizeMessagesTailForOrderDebug(messages, 10);
    console.warn(
      `[desktop-host][msg-order] prefix-sync ${how} len=${messages.length} tail=${tail}`,
    );
  }
}

function imagePathsFromExecution(execution: RuntimeToolExecution<DesktopToolRequest>): string[] {
  return (execution.artifacts ?? [])
    .filter((artifact) => artifact.kind === "image" && artifact.path.trim().length > 0)
    .map((artifact) => artifact.path.trim());
}

function videoPathsFromExecution(execution: RuntimeToolExecution<DesktopToolRequest>): string[] {
  return (execution.artifacts ?? [])
    .filter((artifact) => artifact.kind === "video" && artifact.path.trim().length > 0)
    .map((artifact) => artifact.path.trim());
}

function truncateJson(value: unknown): string {
  return truncateText(JSON.stringify(value, null, 2), 4_000);
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join("")}...<truncated>`;
}

function diagnosticsCheckingSummary(request: unknown): ToolCallSummaryCopy {
  const detail = diagnosticsPathsHeadlineDetail(parseDiagnosticsPathsFromRequest(request));
  return {
    headline: i18n.t("tool.diagnosticsCheck", { context: "running" }),
    ...(detail ? { headlineDetail: detail } : {}),
  };
}

export function splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
  previewSeenCallIds: ReadonlySet<string> = new Set(),
): {
  toApply: RuntimeEvent<DesktopToolRequest>[];
  deferred: RuntimeEvent<DesktopToolRequest>[];
} {
  const inProgressCallIds = new Set<string>();
  const hasTerminal = new Set<string>();

  for (const event of events) {
    if (event.kind !== "streaming-tool-preview" || !isResponsesBuiltInToolName(event.toolName)) {
      continue;
    }
    const phase = resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(event.argumentsJson);
    if (phase === "succeeded" || phase === "failed") {
      hasTerminal.add(event.toolCallId);
      continue;
    }
    inProgressCallIds.add(event.toolCallId);
  }

  if (hasTerminal.size === 0) {
    return { toApply: events, deferred: [] };
  }

  const toApply: RuntimeEvent<DesktopToolRequest>[] = [];
  const deferred: RuntimeEvent<DesktopToolRequest>[] = [];

  for (const event of events) {
    if (event.kind !== "streaming-tool-preview" || !isResponsesBuiltInToolName(event.toolName)) {
      toApply.push(event);
      continue;
    }
    const phase = resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(event.argumentsJson);
    if (phase === "succeeded" || phase === "failed") {
      const deferTerminal =
        inProgressCallIds.has(event.toolCallId) || !previewSeenCallIds.has(event.toolCallId);
      if (deferTerminal) {
        deferred.push(event);
        continue;
      }
    }
    toApply.push(event);
  }

  return { toApply, deferred };
}

export function runtimeEventsIncludeAppliedResponsesBuiltInToolPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  return events.some((event) => {
    if (event.kind !== "streaming-tool-preview" || !isResponsesBuiltInToolName(event.toolName)) {
      return false;
    }
    // Gateway streaming preview argumentsJson is often empty/incomplete JSON (tool-input-start/delta),
    // so phase parses as undefined; both UI and split treat it as preview, and registering "preview seen" must stay consistent,
    // otherwise the final-state event is deferred forever due to the missing previewSeenCallIds entry.
    const phase = resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(event.argumentsJson);
    return phase !== "succeeded" && phase !== "failed";
  });
}

export function runtimeEventsIncludeAppliedResponsesBuiltInToolStreamingUpdate(
  events: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  return events.some(
    (event) =>
      event.kind === "streaming-tool-preview" && isResponsesBuiltInToolName(event.toolName),
  );
}

export function splitRuntimeEventsForIncrementalFinishTaskPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
): {
  toApply: RuntimeEvent<DesktopToolRequest>[];
  deferred: RuntimeEvent<DesktopToolRequest>[];
} {
  let previewIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind === "streaming-tool-preview" && isFinishTaskToolName(event.toolName)) {
      previewIndex = index;
      break;
    }
  }
  if (previewIndex < 0) {
    return { toApply: events, deferred: [] };
  }
  return {
    toApply: events.slice(0, previewIndex + 1),
    deferred: events.slice(previewIndex + 1),
  };
}

export function runtimeEventsIncludeAppliedFinishTaskPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  return events.some(
    (event) => event.kind === "streaming-tool-preview" && isFinishTaskToolName(event.toolName),
  );
}

export function runtimeEventsIncludeAppliedHostToolStreamingUpdate(
  events: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  return events.some((event) => {
    if (event.kind === "tool-call-started") {
      return !isFinishTaskToolName(event.toolName);
    }
    if (event.kind !== "streaming-tool-preview") {
      return false;
    }
    return !isFinishTaskToolName(event.toolName) && !isResponsesBuiltInToolName(event.toolName);
  });
}
