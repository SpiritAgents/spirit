import type {
  AskQuestionsResult,
  SubagentRequest,
  AuthorizationDecision,
  AssistantAuxArchiveEntry,
  ChatArchive,
  ImageGenerationRequest,
  VideoGenerationRequest,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  ToolExecutionOutput,
  ToolRequestExecutionMetadata,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  StoredLlmMessageArchiveEntry,
} from "./ports.js";
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  DEFAULT_VIDEO_GENERATION_DURATION,
  cloneLlmProviderState,
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  createToolExecutionTextOutput,
  llmMessageTextContent,
  normalizeStoredLlmMessage,
} from "./ports.js";
import { STREAM_STALL_TIMEOUT_MS } from "./runtime/constants.js";
import {
  buildToolContinuationStateFromHistory,
  cloneHistory,
  createTurnContext,
  enqueueDeferredToolOutputGuidance,
  enqueueDeferredUserGuidance,
  hasUnansweredAssistantToolCalls,
  pendingMcpResourceFromReadResult,
  promptMessagesFromValue,
  renderError,
  isCompatibleContinuedToolRequest,
  repairMissingToolResultsInHistory,
  shortLabelForPendingMcpResource,
  toolArtifactsFromOutput,
} from "./runtime/helpers.js";
import type { ToolAgentActiveSkill } from "./tool-agent.js";
import { prependSubagentWorktreeMeta } from "./runtime/subagent-worktree-meta.js";
import { buildParentSubagentToolResultText } from "./runtime/subagent-parent-tool-result.js";
import { scopeAgentRuntimeOptionsForSubagentWorkspace } from "./runtime/subagent-workspace-scope.js";
import { prepareSubmittedUserTurn as prepareSubmittedUserTurnInternal } from "./runtime/context.js";
import {
  appendHookAdditionalContexts,
  resolveHookRunner,
  resolveHookSessionContext,
  SubmitPromptHookDeniedError,
} from "./hooks/index.js";
import {
  continuePendingManualToolApproval as continuePendingManualToolApprovalInternal,
  startManualToolCommand as startManualToolCommandInternal,
  startManualToolRequest as startManualToolRequestInternal,
  waitForCompletedManualToolCommandResult as waitForCompletedManualToolCommandResultInternal,
  waitForStartedManualToolCommandResult as waitForStartedManualToolCommandResultInternal,
} from "./runtime/manual-tools.js";
import {
  executeAuthorizedToolCall as executeAuthorizedToolCallInternal,
  handlePendingToolAgentRoundCompletion as handlePendingToolAgentRoundCompletionInternal,
  pollPendingToolAgentRound as pollPendingToolAgentRoundInternal,
  commitSyntheticToolExecutionFailure,
  clearEarlyApprovalWaiters,
  processToolCalls as processToolCallsInternal,
  processToolCallsAsync as processToolCallsAsyncInternal,
  pumpEarlyApprovalQueue,
  resumePendingApproval as resumePendingApprovalInternal,
  resumePendingQuestions as resumePendingQuestionsInternal,
  runTurnLoop as runTurnLoopInternal,
  startToolAgentRoundAsync as startToolAgentRoundAsyncInternal,
  waitForCompletedTurnResult as waitForCompletedTurnResultInternal,
} from "./runtime/turn-machine.js";
import {
  pollPendingBackgroundToolExecution as pollPendingBackgroundToolExecutionInternal,
  scheduleBackgroundToolExecutionAsync as scheduleBackgroundToolExecutionAsyncInternal,
  startBackgroundToolExecutionAsync as startBackgroundToolExecutionAsyncInternal,
  startManualBackgroundToolExecution as startManualBackgroundToolExecutionInternal,
} from "./runtime/background-tools.js";
import {
  compactHistoryImmediate as compactHistoryImmediateInternal,
  pollPendingHistoryCompaction as pollPendingHistoryCompactionInternal,
  startHistoryCompactionAsync as startHistoryCompactionAsyncInternal,
  startManualHistoryCompactionAsync as startManualHistoryCompactionAsyncInternal,
  waitForCompletedManualHistoryCompactionResult as waitForCompletedManualHistoryCompactionResultInternal,
} from "./runtime/compaction.js";
import { buildMergedSessionTranscript } from "./transcript-sync.js";
import { buildSessionTranscript, type SessionTranscriptMessage } from "./transcript.js";
import {
  clearPendingStreamingState as clearPendingStreamingStateInternal,
  clearStreamingUiState as clearStreamingUiStateInternal,
  consumeStreamEvents as consumeStreamEventsInternal,
  currentAuxKind as currentAuxKindInternal,
  currentAuxText as currentAuxTextInternal,
  handlePendingStreamEvent as handlePendingStreamEventInternal,
  handlePendingStreamingCompletion as handlePendingStreamingCompletionInternal,
  handleStreamStallTimeout as handleStreamStallTimeoutInternal,
  pollPendingStreamingRound as pollPendingStreamingRoundInternal,
  startStreamingRound as startStreamingRoundInternal,
} from "./runtime/streaming.js";
import { performToolExecution as performToolExecutionInternal } from "./runtime/tool-execution.js";
import { buildRuntimeToolExecution } from "./runtime/turn-machine.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./runtime/tool-output-append.js";
import type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  EarlyStreamApprovalQueueItem,
  PendingAssistantAux,
  PendingEarlyToolExecution,
  PendingApprovalState,
  PendingBackgroundToolExecution,
  PendingHistoryCompaction,
  PendingQuestionsState,
  PendingMcpResource,
  PendingWorkspaceFile,
  PendingManualApprovalState,
  PendingStreamingRound,
  PendingToolCallContinuation,
  DeferredBackgroundToolExecutionSpec,
  PendingToolAgentRound,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeManualHistoryCompactionResult,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimePendingApproval,
  RuntimeSubagentSessionArchiveEntry,
  RuntimeSubagentSessionSummary,
  RuntimePendingQuestions,
  RuntimeToolExecution,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from "./runtime/types.js";
import type { ContextRuntime } from "./runtime/context.js";
import type { ManualToolsRuntime } from "./runtime/manual-tools.js";
import type { EarlyInternalToolCallResult, TurnMachineRuntime } from "./runtime/turn-machine.js";
import type { BackgroundToolsRuntime } from "./runtime/background-tools.js";
import type { CompactionRuntime } from "./runtime/compaction.js";
import type { StreamingRuntime } from "./runtime/streaming.js";
import type { ToolExecutionRuntime } from "./runtime/tool-execution.js";

export { pendingWorkspaceFilesFromInput, referencedPathsFromInput } from "./runtime/helpers.js";
export type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingAssistantAux,
  PendingMcpResource,
  PendingWorkspaceFile,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeHistoryPreparationResult,
  RuntimeManualHistoryCompactionResult,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimePendingApproval,
  RuntimeSubagentSessionArchiveEntry,
  RuntimeSubagentSessionSummary,
  RuntimePendingQuestions,
  RuntimeStatePreparationResult,
  RuntimeToolExecution,
  RuntimeTurnResult,
  SubagentWorkspaceBootstrap,
  SubagentWorkspaceBootstrapInput,
  SubagentWorkspaceBootstrapResult,
} from "./runtime/types.js";

interface PendingSubagentExecution<Config, State, ToolRequest> {
  parentRequest: ToolRequest;
  parentToolCallId: string;
  parentPendingUserInput: string;
  parentState: State;
  parentRemainingCalls: ToolCallRequest[];
  parentTurn: RuntimeTurnContext<ToolRequest>;
  childRuntime: AgentRuntime<Config, State, ToolRequest>;
  childRecord: RuntimeSubagentSessionArchiveEntry;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

interface PendingSubagentWorktreeBootstrap<State, ToolRequest> {
  parentRequest: ToolRequest;
  parentToolCallId: string;
  parentPendingUserInput: string;
  parentState: State;
  parentRemainingCalls: ToolCallRequest[];
  parentTurn: RuntimeTurnContext<ToolRequest>;
  childRecord: RuntimeSubagentSessionArchiveEntry;
  request: SubagentRequest;
  parentWorkspaceRoot: string;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

interface PendingSubagentBatchContinuation<State, ToolRequest> {
  parentState: State;
  parentPendingUserInput: string;
  parentTurn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

type SubagentToolExecutionResult<ToolRequest> =
  | { kind: "not-handled" }
  | { kind: "started" }
  | {
      kind: "completed";
      text: string;
      failed: boolean;
      sessionId?: string;
      sessionTranscript?: string;
    }
  | {
      kind: "requires-approval";
      approval: RuntimePendingApproval<ToolRequest>;
    }
  | {
      kind: "requires-questions";
      questions: RuntimePendingQuestions<ToolRequest>;
    };

export class AgentRuntime<Config, State, ToolRequest> {
  private readonly options: AgentRuntimeOptions<Config, State, ToolRequest>;
  private historyStore: LlmMessage[];
  private requestTraceStore: JsonValue[];
  private eventQueueStore: RuntimeEvent<ToolRequest>[];
  private pendingBackgroundToolStatusStore: string | undefined;
  private pendingImagePathsStore: string[];
  private pendingMcpResourcesStore: PendingMcpResource[];
  private pendingAssistantTextStore: string;
  private thinkingTextStore: string;
  private toolPreviewSeenInStreamRoundStore = false;
  private providerBuiltinToolTerminalSeenInStreamRoundStore = false;
  private awaitingPostBuiltInToolStreamDeltaStore = false;
  private compactionTextStore: string;
  private pendingUserTurnStore: string | undefined;
  private pendingApproval: PendingApprovalState<State, ToolRequest> | undefined;
  private earlyApprovalQueue: EarlyStreamApprovalQueueItem<State, ToolRequest>[] = [];
  private pendingApprovalSlotWaiters: Array<(canProceed: boolean) => void> = [];
  private earlyApprovalOrderChain: Promise<void> | undefined;
  private pendingQuestions: PendingQuestionsState<State, ToolRequest> | undefined;
  private pendingManualApproval: PendingManualApprovalState<ToolRequest> | undefined;
  private pendingStreamingRound: PendingStreamingRound<State, ToolRequest> | undefined;
  private pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  private pendingToolCallContinuation: PendingToolCallContinuation<State, ToolRequest> | undefined;
  private pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  private deferredBackgroundToolExecutions: DeferredBackgroundToolExecutionSpec<
    State,
    ToolRequest
  >[] = [];
  private readonly turnToolStateByTurn = new WeakMap<RuntimeTurnContext<ToolRequest>, State>();
  private pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  private childSessionsStore: RuntimeSubagentSessionArchiveEntry[];
  private pendingSubagentExecutions = new Map<
    string,
    PendingSubagentExecution<Config, State, ToolRequest>
  >();
  private pendingSubagentWorktreeBootstraps = new Map<
    string,
    PendingSubagentWorktreeBootstrap<State, ToolRequest>
  >();
  private pendingSubagentBatchContinuation:
    | PendingSubagentBatchContinuation<State, ToolRequest>
    | undefined;
  /** pendingToolCallContinuation is already cleared during a synchronous await of performToolExecution, so these are counted separately */
  private inFlightSynchronousToolExecutionsStore = 0;
  private completedTurnResultStore: RuntimeTurnResult<State, ToolRequest> | undefined;
  private completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  private completedManualHistoryCompactionResultStore:
    | RuntimeManualHistoryCompactionResult
    | undefined;
  private pendingStartedAtStore: number | undefined;
  private pendingLastEventAtStore: number | undefined;
  private streamChunkCounterStore: number;
  private loopEnabledStore: boolean;
  private readonly runtimeDepthStore: number;
  private childSessionCounterStore: number;
  /** Durable transcript messages that survive compaction shrinking historyStore. */
  private sealedTranscriptMessagesStore: SessionTranscriptMessage[] = [];

  constructor(
    options: AgentRuntimeOptions<Config, State, ToolRequest>,
    initialHistory: LlmMessage[] = [],
    runtimeDepth = 0,
  ) {
    this.options = options;
    this.historyStore = cloneHistory(initialHistory);
    this.requestTraceStore = [];
    this.eventQueueStore = [];
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingAssistantTextStore = "";
    this.thinkingTextStore = "";
    this.toolPreviewSeenInStreamRoundStore = false;
    this.providerBuiltinToolTerminalSeenInStreamRoundStore = false;
    this.awaitingPostBuiltInToolStreamDeltaStore = false;
    this.compactionTextStore = "";
    this.childSessionsStore = [];
    this.streamChunkCounterStore = 0;
    this.loopEnabledStore = false;
    this.runtimeDepthStore = runtimeDepth;
    this.childSessionCounterStore = 0;
    this.sealedTranscriptMessagesStore = buildSessionTranscript(this.historyStore).messages;
  }

  private async appendToolResultMessageWithOutputTruncation(
    state: State,
    toolCallId: string,
    content: string,
  ): Promise<State> {
    const preparedContent = await prepareAndSyncRuntimeToolResultToHistory(
      { options: this.options, historyStore: this.historyStore },
      toolCallId,
      content,
    );
    return this.options.appendToolResultMessage(state, toolCallId, preparedContent);
  }

  private hasOutstandingToolTurnWorkForResume(): boolean {
    const outstanding = this.readOutstandingToolTurnFlags();
    return (
      outstanding.hasPendingContinuation ||
      this.pendingBackgroundToolExecution !== undefined ||
      outstanding.deferredBgCount > 0
    );
  }

  private async resumeToolTurnAfterResolvedDenial(
    turn: RuntimeTurnContext<ToolRequest>,
    pendingUserInput: string,
    resumeAsStreaming: boolean,
    streamingEmitBeginResponse: boolean,
  ): Promise<void> {
    if (this.hasOutstandingToolTurnWorkForResume()) {
      return;
    }

    if (hasUnansweredAssistantToolCalls(this.historyStore)) {
      return;
    }

    const continuationState = buildToolContinuationStateFromHistory(
      this.options,
      this.historyStore,
      pendingUserInput,
    );
    this.advanceTurnToolState(turn, continuationState);

    if (resumeAsStreaming) {
      await this.startStreamingRound(
        continuationState,
        pendingUserInput,
        turn,
        streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(continuationState, pendingUserInput, turn);
  }

  history(): readonly LlmMessage[] {
    return this.historyStore;
  }

  requestTrace(): readonly JsonValue[] {
    return this.requestTraceStore;
  }

  childSessions(): readonly RuntimeSubagentSessionSummary[] {
    return this.childSessionsStore.map((entry) => ({ ...entry.summary }));
  }

  loopEnabled(): boolean {
    return this.loopEnabledStore;
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabledStore = enabled;
    this.options.toolExecutor.setLoopToolExposure?.(enabled);
  }

  childSessionArchives(): readonly RuntimeSubagentSessionArchiveEntry[] {
    return this.childSessionsStore.map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => serializeRuntimeLlmMessageForArchive(message)),
    }));
  }

  childSessionArchive(sessionId: string): RuntimeSubagentSessionArchiveEntry | undefined {
    const entry = this.childSessionsStore.find(
      (candidate) => candidate.summary.sessionId === sessionId,
    );
    if (!entry) {
      return undefined;
    }

    return {
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => serializeRuntimeLlmMessageForArchive(message)),
    };
  }

  drainActiveChildSessionEvents(): Array<{
    sessionId: string;
    parentToolCallId: string;
    events: RuntimeEvent<ToolRequest>[];
  }> {
    const drains: Array<{
      sessionId: string;
      parentToolCallId: string;
      events: RuntimeEvent<ToolRequest>[];
    }> = [];

    for (const pending of this.pendingSubagentExecutions.values()) {
      drains.push({
        sessionId: pending.childRecord.summary.sessionId,
        parentToolCallId: pending.childRecord.summary.parentToolCallId,
        events: pending.childRuntime.drainEvents(),
      });
    }

    return drains;
  }

  childSessionPendingAuxState(sessionId: string): PendingAssistantAux | undefined {
    const pending = this.findPendingSubagentBySessionId(sessionId);
    if (!pending) {
      return undefined;
    }

    return pending.childRuntime.pendingAuxState();
  }

  drainEvents(): RuntimeEvent<ToolRequest>[] {
    const events = [...this.eventQueueStore];
    this.eventQueueStore = [];
    return events;
  }

  takeCompletedTurnResult(): RuntimeTurnResult<State, ToolRequest> | undefined {
    const result = this.completedTurnResultStore;
    this.completedTurnResultStore = undefined;
    return result;
  }

  takeCompletedManualToolCommandResult():
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined {
    const result = this.completedManualToolCommandResultStore;
    this.completedManualToolCommandResultStore = undefined;
    return result;
  }

  takeCompletedManualHistoryCompactionResult(): RuntimeManualHistoryCompactionResult | undefined {
    const result = this.completedManualHistoryCompactionResultStore;
    this.completedManualHistoryCompactionResultStore = undefined;
    return result;
  }

  pendingUserTurn(): string | undefined {
    return this.pendingUserTurnStore;
  }

  pendingAssistantText(): string {
    return this.pendingAssistantTextStore;
  }

  thinkingText(): string {
    return this.thinkingTextStore;
  }

  compactionText(): string {
    return this.compactionTextStore;
  }

  pendingStartedAt(): number | undefined {
    return this.pendingStartedAtStore;
  }

  pendingLastEventAt(): number | undefined {
    return this.pendingLastEventAtStore;
  }

  streamChunkCounter(): number {
    return this.streamChunkCounterStore;
  }

  backgroundToolStatus(): string | undefined {
    return this.pendingBackgroundToolStatusStore;
  }

  pendingImagePaths(): readonly string[] {
    return this.pendingImagePathsStore;
  }

  pendingMcpResources(): readonly PendingMcpResource[] {
    return this.pendingMcpResourcesStore;
  }

  pendingAuxState(): PendingAssistantAux | undefined {
    if (this.pendingSubagentExecutions.size > 0) {
      return {
        kind: "thinking",
        statusText: this.currentSubagentStatusText(),
      };
    }

    const kind = this.currentAuxKind();
    if (!kind) {
      return undefined;
    }

    const detailText = this.currentAuxText();
    return {
      kind,
      statusText: "",
      ...(detailText !== undefined ? { detailText } : {}),
    };
  }

  tickThinkingSpinner(): void {
    // Spinner chrome is owned by hosts.
  }

  hasPendingApproval(): boolean {
    return (
      this.pendingApproval !== undefined ||
      this.pendingManualApproval !== undefined ||
      this.findPendingSubagentWithApproval() !== undefined
    );
  }

  hasPendingQuestions(): boolean {
    return (
      this.pendingQuestions !== undefined || this.findPendingSubagentWithQuestions() !== undefined
    );
  }

  currentPendingApproval(): RuntimePendingApproval<ToolRequest> | undefined {
    if (this.pendingApproval) {
      return {
        prompt: this.pendingApproval.prompt,
        request: this.pendingApproval.request,
        ...(this.pendingApproval.rememberTarget !== undefined
          ? { rememberTarget: this.pendingApproval.rememberTarget }
          : {}),
        ...(this.pendingApproval.autoReviewBlockReason !== undefined
          ? { autoReviewBlockReason: this.pendingApproval.autoReviewBlockReason }
          : {}),
        toolCallId: this.pendingApproval.toolCallId,
        toolName: this.pendingApproval.toolName,
      };
    }

    if (this.pendingManualApproval) {
      return {
        prompt: this.pendingManualApproval.prompt,
        request: this.pendingManualApproval.request,
        ...(this.pendingManualApproval.rememberTarget !== undefined
          ? { rememberTarget: this.pendingManualApproval.rememberTarget }
          : {}),
        ...(this.pendingManualApproval.autoReviewBlockReason !== undefined
          ? { autoReviewBlockReason: this.pendingManualApproval.autoReviewBlockReason }
          : {}),
        toolName: this.pendingManualApproval.toolName,
      };
    }

    const pendingSubagent = this.findPendingSubagentWithApproval();
    if (pendingSubagent) {
      const approval = pendingSubagent.childRuntime.currentPendingApproval();
      if (approval) {
        return {
          ...approval,
          subagentSessionId: pendingSubagent.childRecord.summary.sessionId,
          subagentTitle: pendingSubagent.childRecord.summary.title,
        };
      }
    }

    return undefined;
  }

  currentPendingQuestions(): RuntimePendingQuestions<ToolRequest> | undefined {
    if (this.pendingQuestions) {
      return {
        request: this.pendingQuestions.request,
        toolCallId: this.pendingQuestions.toolCallId,
        toolName: this.pendingQuestions.toolName,
        questions: this.pendingQuestions.questions,
      };
    }

    const pendingSubagent = this.findPendingSubagentWithQuestions();
    if (pendingSubagent) {
      return pendingSubagent.childRuntime.currentPendingQuestions();
    }

    return undefined;
  }

  private updateSubagentQuestionsBlockedState(
    record: RuntimeSubagentSessionArchiveEntry,
    questions: RuntimePendingQuestions<ToolRequest>,
  ): void {
    record.summary.status = "blocked";
    record.summary.updatedAtUnixMs = Date.now();
    record.summary.latestMessage = `Awaiting input: ${questions.toolName}`;
    delete record.summary.completedAtUnixMs;
    delete record.summary.finalOutput;
    delete record.summary.error;
  }

  private cachePendingSubagentExecution(
    pending: PendingSubagentExecution<Config, State, ToolRequest>,
  ): void {
    this.pendingSubagentExecutions.set(pending.parentToolCallId, pending);
  }

  private findPendingSubagentBySessionId(
    sessionId: string,
  ): PendingSubagentExecution<Config, State, ToolRequest> | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRecord.summary.sessionId === sessionId) {
        return pending;
      }
    }
    return undefined;
  }

  private findPendingSubagentWithApproval():
    | PendingSubagentExecution<Config, State, ToolRequest>
    | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRuntime.hasPendingApproval()) {
        return pending;
      }
    }
    return undefined;
  }

  private findPendingSubagentWithQuestions():
    | PendingSubagentExecution<Config, State, ToolRequest>
    | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRuntime.hasPendingQuestions()) {
        return pending;
      }
    }
    return undefined;
  }

  private firstPendingSubagentExecution():
    | PendingSubagentExecution<Config, State, ToolRequest>
    | undefined {
    return this.pendingSubagentExecutions.values().next().value;
  }

  private ensureSubagentBatchContinuation(
    state: State,
    parentPendingUserInput: string,
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming: boolean,
    streamingEmitBeginResponse: boolean,
  ): void {
    if (!this.pendingSubagentBatchContinuation) {
      this.pendingSubagentBatchContinuation = {
        parentState: state,
        parentPendingUserInput,
        parentTurn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      };
    }
  }

  private clearPendingSubagentState(): void {
    for (const pending of this.pendingSubagentExecutions.values()) {
      pending.childRuntime.abort();
    }
    this.pendingSubagentExecutions.clear();
    this.pendingSubagentWorktreeBootstraps.clear();
    this.pendingSubagentBatchContinuation = undefined;
  }

  private buildPendingSubagentExecution(
    parentRequest: ToolRequest,
    parentToolCallId: string,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    childRuntime: AgentRuntime<Config, State, ToolRequest>,
    childRecord: RuntimeSubagentSessionArchiveEntry,
    resumeAsStreaming: boolean,
    streamingEmitBeginResponse: boolean,
  ): PendingSubagentExecution<Config, State, ToolRequest> {
    return {
      parentRequest,
      parentToolCallId,
      parentPendingUserInput,
      parentState,
      parentRemainingCalls,
      parentTurn,
      childRuntime,
      childRecord,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    };
  }

  readOutstandingToolTurnFlags(): {
    hasPendingApproval: boolean;
    hasPendingContinuation: boolean;
    hasPendingQuestions: boolean;
    deferredBgCount: number;
  } {
    return {
      hasPendingApproval: this.hasPendingApproval() || this.earlyApprovalQueue.length > 0,
      hasPendingContinuation: this.pendingToolCallContinuation !== undefined,
      hasPendingQuestions: this.pendingQuestions !== undefined,
      deferredBgCount: this.deferredBackgroundToolExecutions.length,
    };
  }

  advanceTurnToolState(turn: RuntimeTurnContext<ToolRequest>, state: State): void {
    this.turnToolStateByTurn.set(turn, state);
    if (this.pendingApproval?.turn === turn) {
      this.pendingApproval = { ...this.pendingApproval, state };
    }
    if (this.pendingToolCallContinuation?.turn === turn) {
      this.pendingToolCallContinuation = { ...this.pendingToolCallContinuation, state };
    }
  }

  resolveTurnToolState(turn: RuntimeTurnContext<ToolRequest>, fallback: State): State {
    return this.turnToolStateByTurn.get(turn) ?? fallback;
  }

  isBusy(): boolean {
    return (
      this.inFlightSynchronousToolExecutionsStore > 0 ||
      this.pendingStreamingRound !== undefined ||
      this.pendingToolAgentRound !== undefined ||
      this.pendingToolCallContinuation !== undefined ||
      this.pendingBackgroundToolExecution !== undefined ||
      this.deferredBackgroundToolExecutions.length > 0 ||
      this.pendingHistoryCompaction !== undefined ||
      this.pendingSubagentExecutions.size > 0 ||
      this.pendingSubagentWorktreeBootstraps.size > 0 ||
      this.pendingQuestions !== undefined ||
      this.hasPendingApproval()
    );
  }

  abort(): void {
    if (!this.isBusy()) {
      return;
    }

    this.options.toolExecutor.abortRunningShell?.();

    const hasPendingAssistantText = this.pendingAssistantTextStore.trim().length > 0;

    if (hasPendingAssistantText) {
      this.historyStore.push({
        role: "assistant",
        content: createLlmMessageContentFromText(this.pendingAssistantTextStore),
      });
      this.emitEvent({ kind: "assistant-response-completed" });
    } else {
      this.emitEvent({ kind: "remove-pending-assistant" });
    }

    this.pendingUserTurnStore = undefined;
    clearEarlyApprovalWaiters(this as unknown as TurnMachineRuntime<Config, State, ToolRequest>);
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.pendingQuestions = undefined;
    this.clearPendingSubagentState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
  }

  hasPendingManualApproval(): boolean {
    return (
      this.pendingManualApproval !== undefined ||
      [...this.pendingSubagentExecutions.values()].some((pending) =>
        pending.childRuntime.hasPendingManualApproval(),
      )
    );
  }

  replaceHistory(history: LlmMessage[]): void {
    this.historyStore = repairMissingToolResultsInHistory(cloneHistory(history));
    // Keep sealedTranscriptMessagesStore: durable transcript must survive compaction reloads.
    clearEarlyApprovalWaiters(this as unknown as TurnMachineRuntime<Config, State, ToolRequest>);
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.clearPendingSubagentState();
    this.childSessionsStore = [];
  }

  replaceFromArchive(archive: ChatArchive): void {
    this.historyStore = repairMissingToolResultsInHistory(
      archive.llmHistory.map((message) => normalizeStoredLlmMessage(message)),
    );
    // Keep sealedTranscriptMessagesStore: archive llmHistory may already be compacted.
    this.loopEnabledStore = archive.loopEnabled === true;
    this.options.toolExecutor.setLoopToolExposure?.(this.loopEnabledStore);
    this.requestTraceStore = [];
    clearEarlyApprovalWaiters(this as unknown as TurnMachineRuntime<Config, State, ToolRequest>);
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.clearPendingSubagentState();
    this.childSessionsStore = (archive.subagentSessions ?? []).map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => normalizeStoredLlmMessage(message)),
    }));
  }

  async syncSessionTranscriptFromHistory(
    history: readonly LlmMessage[] = this.historyStore,
  ): Promise<string | undefined> {
    const sync = this.options.syncSessionTranscript;
    if (!sync) {
      return undefined;
    }

    try {
      const { transcript, sealedMessages } = buildMergedSessionTranscript(
        this.sealedTranscriptMessagesStore,
        history,
      );
      this.sealedTranscriptMessagesStore = sealedMessages;
      const sessionKey = resolveHookSessionContext(this.options).sessionId;
      return await sync({
        transcript,
        ...(sessionKey !== undefined ? { sessionKey } : {}),
      });
    } catch (error: unknown) {
      this.emitEvent({
        kind: "session-transcript-sync-failed",
        error: renderError(error),
      });
      return undefined;
    }
  }

  private async syncSubagentTranscriptBestEffort(
    subagentSessionId: string,
    history: readonly LlmMessage[],
  ): Promise<void> {
    const sync = this.options.syncSubagentTranscript;
    if (!sync) {
      return;
    }

    try {
      const transcript = buildSessionTranscript(history);
      const sessionKey = resolveHookSessionContext(this.options).sessionId;
      await sync({
        transcript,
        subagentSessionId,
        ...(sessionKey !== undefined ? { sessionKey } : {}),
      });
    } catch (error: unknown) {
      this.emitEvent({
        kind: "session-transcript-sync-failed",
        error: renderError(error),
      });
    }
  }

  private resolveSubagentTranscriptPath(subagentSessionId: string): string | undefined {
    const resolve = this.options.resolveSubagentTranscriptPath;
    if (!resolve) {
      return undefined;
    }
    const sessionKey = resolveHookSessionContext(this.options).sessionId;
    const resolved = resolve({
      subagentSessionId,
      ...(sessionKey !== undefined ? { sessionKey } : {}),
    })?.trim();
    return resolved || undefined;
  }

  private completedSubagentToolOutcome(
    sessionId: string | undefined,
    text: string,
    failed: boolean,
  ): Extract<SubagentToolExecutionResult<ToolRequest>, { kind: "completed" }> {
    const sessionTranscript = sessionId ? this.resolveSubagentTranscriptPath(sessionId) : undefined;
    return {
      kind: "completed",
      text,
      failed,
      ...(sessionId ? { sessionId } : {}),
      ...(sessionTranscript ? { sessionTranscript } : {}),
    };
  }

  /**
   * Persist task + failure into a child session archive and sync its transcript
   * before advertising sessionTranscript in the parent tool result.
   */
  private failSubagentSessionBeforeChildRun(
    record: RuntimeSubagentSessionArchiveEntry,
    request: SubagentRequest,
    failed: string,
  ): Extract<SubagentToolExecutionResult<ToolRequest>, { kind: "completed" }> {
    const childUserTurn = buildSubagentUserTurn(request);
    record.llmHistory = [
      {
        role: "user",
        content: createLlmMessageContentFromText(childUserTurn),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText(failed),
      },
    ];
    record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
    record.summary.error = failed;
    if (
      !this.childSessionsStore.some((entry) => entry.summary.sessionId === record.summary.sessionId)
    ) {
      this.childSessionsStore.push(record);
    }
    this.markChildSessionTerminalAndSyncTranscript(record, "failed");
    return this.completedSubagentToolOutcome(record.summary.sessionId, failed, true);
  }

  toArchive(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    assistantAux: AssistantAuxArchiveEntry[],
  ): ChatArchive {
    return {
      messages,
      assistantAux,
      llmHistory: this.historyStore.map((message) => ({
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
        ...(message.providerState !== undefined
          ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
      })),
      subagentSessions: this.childSessionsStore.map((entry) => ({
        summary: { ...entry.summary },
        llmHistory: entry.llmHistory.map((message) => ({
          role: message.role,
          content: cloneLlmMessageContent(message.content),
          ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
          ...(message.toolCalls !== undefined
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  argumentsJson: toolCall.argumentsJson,
                })),
              }
            : {}),
          ...(message.providerState !== undefined
            ? { providerState: cloneLlmProviderState(message.providerState) }
            : {}),
        })),
      })),
      loopEnabled: this.loopEnabledStore,
    };
  }

  addPendingImage(path: string): void {
    this.pendingImagePathsStore.push(path);
  }

  clearPendingImages(): number {
    const cleared = this.pendingImagePathsStore.length;
    this.pendingImagePathsStore = [];
    return cleared;
  }

  async attachMcpResource(server: string, uri: string): Promise<string> {
    const value = await this.options.toolExecutor.readMcpResource(server, uri);
    const resource = pendingMcpResourceFromReadResult(server, server, uri, value);
    this.pendingMcpResourcesStore.push(resource);
    return shortLabelForPendingMcpResource(resource);
  }

  clearPendingMcpResources(): number {
    const cleared = this.pendingMcpResourcesStore.length;
    this.pendingMcpResourcesStore = [];
    return cleared;
  }

  recordContextMessage(role: "system" | "user" | "assistant", content: string): void {
    this.historyStore.push({
      role,
      content: createLlmMessageContentFromText(content),
    });
  }

  async applyMcpPrompt(
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<{
    notice: string;
    result: RuntimeTurnResult<State, ToolRequest>;
  }> {
    const started = await this.prepareMcpPromptTurn(server, prompt, argsJson, userMessage);
    this.startToolAgentRoundAsync(
      started.state,
      started.userTurn,
      createTurnContext<ToolRequest>(),
    );
    const result = await this.waitForCompletedTurnResult();
    return {
      notice: started.notice,
      result,
    };
  }

  async startApplyMcpPrompt(
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<string> {
    const started = await this.prepareMcpPromptTurn(server, prompt, argsJson, userMessage);
    await this.startStreamingRound(
      started.state,
      started.userTurn,
      createTurnContext<ToolRequest>(),
      true,
    );
    return started.notice;
  }

  async compactHistory(): Promise<RuntimeCompactionRecord> {
    await this.startManualHistoryCompaction();
    const result = await this.waitForCompletedManualHistoryCompactionResult();
    if (result.kind === "failed") {
      throw new Error(result.error);
    }

    return result.result;
  }

  async startManualHistoryCompaction(): Promise<void> {
    if (this.isBusy()) {
      throw new Error("A compaction task is already running in the background; please wait.");
    }

    this.completedManualHistoryCompactionResultStore = undefined;
    this.emitEvent({ kind: "begin-assistant-response" });
    this.startManualHistoryCompactionAsync();
  }

  private async compactHistoryImmediate(): Promise<RuntimeCompactionRecord> {
    return compactHistoryImmediateInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest>,
    );
  }

  async submitUserTurn(
    userInput: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    await this.startUserTurn(userInput, explicitImages, explicitWorkspaceFiles);
    return this.waitForCompletedTurnResult();
  }

  async startUserTurn(
    userInput: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
    activeSkillsForTurn: ToolAgentActiveSkill[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error("A response or approval is already being processed; please wait.");
    }

    this.completedTurnResultStore = undefined;
    try {
      const state = await this.prepareSubmittedUserTurn(
        userInput,
        explicitImages,
        explicitWorkspaceFiles,
        activeSkillsForTurn,
      );
      this.startToolAgentRoundAsync(state, userInput, createTurnContext<ToolRequest>());
    } catch (error) {
      if (error instanceof SubmitPromptHookDeniedError) {
        this.completeSubmitPromptDenied(error);
        return;
      }
      throw error;
    }
  }

  async startUserTurnStreaming(
    userInput: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
    activeSkillsForTurn: ToolAgentActiveSkill[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error("A response or approval is already being processed; please wait.");
    }

    this.completedTurnResultStore = undefined;
    try {
      const state = await this.prepareSubmittedUserTurn(
        userInput,
        explicitImages,
        explicitWorkspaceFiles,
        activeSkillsForTurn,
      );
      await this.startStreamingRound(state, userInput, createTurnContext<ToolRequest>(), true);
    } catch (error) {
      if (error instanceof SubmitPromptHookDeniedError) {
        this.completeSubmitPromptDenied(error);
        return;
      }
      throw error;
    }
  }

  async continueAssistantCompletionStreaming(): Promise<void> {
    if (this.isBusy()) {
      throw new Error("A response or approval is already being processed; please wait.");
    }

    // Abort can leave assistant tool calls unanswered (in-flight background executions are
    // discarded without a result). Repair before building the request, matching the other
    // entry points that read history (prepareSubmittedUserTurn / replaceHistory).
    this.historyStore = repairMissingToolResultsInHistory(this.historyStore);
    const history = cloneHistory(this.historyStore);
    const lastHistoryMessage = [...history].reverse().find((message) => {
      if (message.role === "tool") {
        return true;
      }
      if (message.role === "assistant" || message.role === "user") {
        return llmMessageTextContent(message.content).trim().length > 0;
      }
      return false;
    });
    if (
      !lastHistoryMessage ||
      (lastHistoryMessage.role !== "assistant" &&
        lastHistoryMessage.role !== "user" &&
        lastHistoryMessage.role !== "tool")
    ) {
      throw new Error("There is no reply available to continue.");
    }

    this.completedTurnResultStore = undefined;
    const pendingUserInput = [...history]
      .reverse()
      .find(
        (message) => message.role === "user" && llmMessageTextContent(message.content).trim(),
      )?.content;
    const pendingUserText = pendingUserInput ? llmMessageTextContent(pendingUserInput) : "";
    const state = this.options.createContinuationState
      ? this.options.createContinuationState(history)
      : this.options.createToolAgentState(history, "");
    await this.startStreamingRound(state, pendingUserText, createTurnContext<ToolRequest>(), true);
  }

  async poll(): Promise<void> {
    await this.pollPendingStreamingRound();
    await this.pollPendingToolCallContinuation();
    await this.pollPendingToolAgentRound();
    await this.pollPendingHistoryCompaction();
    await this.pollPendingBackgroundToolExecution();
    await this.pollPendingSubagentWorktreeBootstrap();
    await this.pollPendingSubagentExecution();
  }

  handleStreamStallTimeout(nowMs = Date.now(), stallTimeoutMs = STREAM_STALL_TIMEOUT_MS): void {
    handleStreamStallTimeoutInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
      nowMs,
      stallTimeoutMs,
    );
  }

  async resumePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return resumePendingApprovalInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      decision,
    );
  }

  async resumePendingQuestions(
    result: AskQuestionsResult,
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return resumePendingQuestionsInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      result,
    );
  }

  async continuePendingApproval(decision: RuntimeApprovalDecision): Promise<void> {
    const pending = this.pendingApproval;
    if (!pending) {
      if (this.pendingSubagentExecutions.size > 0) {
        await this.continuePendingSubagentApproval(decision);
        return;
      }
      throw new Error("There is no pending tool call to confirm.");
    }

    this.pendingApproval = undefined;
    this.completedTurnResultStore = undefined;
    this.emitEvent({
      kind: "approval-resolved",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      request: pending.request,
      decisionKind: decision.kind,
    });

    if (pending.source === "early-stream") {
      pending.resolveEarlyDecision?.(decision);
    }
    // Whether this decision came from early-stream or a formal approval, once the slot is
    // released the queued early approval must be promoted: if the formal branch does not pump,
    // the queued waiter's promise would never be settled.
    pumpEarlyApprovalQueue(this as unknown as TurnMachineRuntime<Config, State, ToolRequest>);
    if (pending.source === "early-stream") {
      return;
    }

    if (decision.kind === "allow") {
      if (decision.remember && pending.rememberTarget !== undefined) {
        await this.options.toolExecutor.rememberApproval(pending.rememberTarget, decision.remember);
      }

      if (this.options.toolExecutor.shouldExecuteInBackground?.(pending.request) ?? false) {
        const executionState = this.resolveTurnToolState(pending.turn, pending.state);
        this.scheduleBackgroundToolExecutionAsync(
          pending.pendingUserInput,
          executionState,
          pending.request,
          pending.toolCallId,
          pending.toolName,
          pending.argumentsJson,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        if (pending.remainingCalls.length > 0) {
          this.queuePendingToolCallContinuation(
            executionState,
            pending.pendingUserInput,
            pending.remainingCalls,
            pending.turn,
            pending.resumeAsStreaming,
            pending.streamingEmitBeginResponse,
            pending.earlyToolExecutions,
          );
        }
        return;
      }

      const execution = await this.performToolExecution(
        pending.request,
        pending.toolName,
        pending.toolCallId,
      );
      const finished = buildRuntimeToolExecution({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        request: pending.request,
        output: execution.output,
        failed: execution.failed,
      });
      pending.turn.toolExecutions.push(finished);
      this.emitEvent({ kind: "tool-execution-finished", execution: finished });
      enqueueDeferredToolOutputGuidance(pending.turn, pending.toolName, execution.output);

      const resumedState = await this.appendToolResultMessageWithOutputTruncation(
        pending.state,
        pending.toolCallId,
        execution.output.summaryText,
      );

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedState,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedState,
          pending.pendingUserInput,
          pending.turn,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      this.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
      return;
    }

    if (decision.kind === "guidance") {
      const guidanceText = decision.resultText?.trim()
        ? decision.resultText
        : "[denied by user] tool call rejected by user guidance";
      const guidanceMessage = decision.userMessage.trim();
      commitSyntheticToolExecutionFailure(
        this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
        pending.turn,
        pending.request,
        pending.toolCallId,
        pending.toolName,
        guidanceText,
      );
      let resumedState = await this.appendToolResultMessageWithOutputTruncation(
        pending.state,
        pending.toolCallId,
        guidanceText,
      );
      this.advanceTurnToolState(pending.turn, resumedState);

      if (!guidanceMessage) {
        if (pending.remainingCalls.length > 0) {
          this.queuePendingToolCallContinuation(
            resumedState,
            pending.pendingUserInput,
            pending.remainingCalls,
            pending.turn,
            pending.resumeAsStreaming,
            pending.streamingEmitBeginResponse,
            pending.earlyToolExecutions,
          );
          return;
        }

        await this.resumeToolTurnAfterResolvedDenial(
          pending.turn,
          pending.pendingUserInput,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      enqueueDeferredUserGuidance(pending.turn, guidanceMessage);

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedState,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      await this.resumeToolTurnAfterResolvedDenial(
        pending.turn,
        pending.pendingUserInput,
        pending.resumeAsStreaming,
        true,
      );
      return;
    }

    const deniedText = decision.resultText?.trim()
      ? decision.resultText
      : "[denied by user] tool call rejected by user approval policy";
    commitSyntheticToolExecutionFailure(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      pending.turn,
      pending.request,
      pending.toolCallId,
      pending.toolName,
      deniedText,
    );
    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      pending.state,
      pending.toolCallId,
      deniedText,
    );
    this.advanceTurnToolState(pending.turn, resumedState);

    if (pending.remainingCalls.length > 0) {
      this.queuePendingToolCallContinuation(
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
        pending.earlyToolExecutions,
      );
      return;
    }

    await this.resumeToolTurnAfterResolvedDenial(
      pending.turn,
      pending.pendingUserInput,
      pending.resumeAsStreaming,
      pending.streamingEmitBeginResponse,
    );
  }

  async continuePendingQuestions(result: AskQuestionsResult): Promise<void> {
    if (!this.pendingQuestions) {
      const pendingSubagent = this.findPendingSubagentWithQuestions();
      if (!pendingSubagent) {
        throw new Error("There is no pending question form to answer.");
      }

      this.completedTurnResultStore = undefined;
      await pendingSubagent.childRuntime.continuePendingQuestions(result);
      this.refreshChildSessionRecord(pendingSubagent.childRecord, pendingSubagent.childRuntime);
      const childQuestions = pendingSubagent.childRuntime.currentPendingQuestions();
      if (childQuestions) {
        this.updateSubagentQuestionsBlockedState(pendingSubagent.childRecord, childQuestions);
        return;
      }

      await this.pollPendingSubagentExecution();
      return;
    }

    const pending = this.pendingQuestions;
    this.pendingQuestions = undefined;
    this.completedTurnResultStore = undefined;

    const resumeAfterToolOutput = async (output: string): Promise<void> => {
      const resumedState = await this.appendToolResultMessageWithOutputTruncation(
        pending.state,
        pending.toolCallId,
        output,
      );

      if (pending.remainingCalls.length > 0) {
        await this.processToolCallsAsync(
          resumedState,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedState,
          pending.pendingUserInput,
          pending.turn,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      this.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
    };

    const continuedRequest = this.options.toolExecutor.continueAfterQuestions
      ? await this.options.toolExecutor.continueAfterQuestions(pending.request, result)
      : undefined;

    if (continuedRequest !== undefined) {
      if (!isCompatibleContinuedToolRequest(pending.request, continuedRequest)) {
        await resumeAfterToolOutput(
          "[continueAfterQuestions error] continued request must stay on the same tool.",
        );
        return;
      }

      let authorization: AuthorizationDecision;
      try {
        authorization = await this.options.toolExecutor.authorize(continuedRequest);
      } catch (error) {
        await resumeAfterToolOutput(`[authorization error] ${renderError(error)}`);
        return;
      }

      if (authorization.kind === "denied") {
        await resumeAfterToolOutput(`[denied by permission rule] ${authorization.reason}`);
        return;
      }

      if (authorization.kind === "need-approval") {
        const approval = {
          prompt: authorization.prompt,
          request: continuedRequest,
          ...(authorization.rememberTarget !== undefined
            ? { rememberTarget: authorization.rememberTarget }
            : {}),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
        };
        this.pendingApproval = {
          pendingUserInput: pending.pendingUserInput,
          state: pending.state,
          request: continuedRequest,
          prompt: authorization.prompt,
          ...(authorization.rememberTarget !== undefined
            ? { rememberTarget: authorization.rememberTarget }
            : {}),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          argumentsJson: pending.argumentsJson,
          remainingCalls: pending.remainingCalls,
          turn: pending.turn,
          resumeAsStreaming: pending.resumeAsStreaming,
          streamingEmitBeginResponse: pending.streamingEmitBeginResponse,
          ...(pending.earlyToolExecutions
            ? { earlyToolExecutions: pending.earlyToolExecutions }
            : {}),
        };
        this.emitEvent({
          kind: "approval-requested",
          approval,
        });
        return;
      }

      if (authorization.kind === "need-questions") {
        await resumeAfterToolOutput(
          "[continueAfterQuestions error] continued request cannot require questions again.",
        );
        return;
      }

      const resumedState = pending.state;
      if (this.options.toolExecutor.shouldExecuteInBackground?.(continuedRequest) ?? false) {
        this.scheduleBackgroundToolExecutionAsync(
          pending.pendingUserInput,
          resumedState,
          continuedRequest,
          pending.toolCallId,
          pending.toolName,
          pending.argumentsJson,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        if (pending.remainingCalls.length > 0) {
          this.queuePendingToolCallContinuation(
            resumedState,
            pending.pendingUserInput,
            pending.remainingCalls,
            pending.turn,
            pending.resumeAsStreaming,
            pending.streamingEmitBeginResponse,
            pending.earlyToolExecutions,
          );
        }
        return;
      }

      const execution = await this.performToolExecution(
        continuedRequest,
        pending.toolName,
        pending.toolCallId,
      );
      const finished = buildRuntimeToolExecution({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        request: continuedRequest,
        output: execution.output,
        failed: execution.failed,
      });
      pending.turn.toolExecutions.push(finished);
      this.emitEvent({ kind: "tool-execution-finished", execution: finished });
      enqueueDeferredToolOutputGuidance(pending.turn, pending.toolName, execution.output);

      const resumedStateWithToolOutput = await this.appendToolResultMessageWithOutputTruncation(
        resumedState,
        pending.toolCallId,
        execution.output.summaryText,
      );

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedStateWithToolOutput,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedStateWithToolOutput,
          pending.pendingUserInput,
          pending.turn,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      this.startToolAgentRoundAsync(
        resumedStateWithToolOutput,
        pending.pendingUserInput,
        pending.turn,
      );
      return;
    }

    const output = JSON.stringify(result);
    const questionsFinished: RuntimeToolExecution<ToolRequest> = {
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      request: pending.request,
      output,
      failed: false,
    };
    pending.turn.toolExecutions.push(questionsFinished);
    this.emitEvent({ kind: "tool-execution-finished", execution: questionsFinished });

    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      pending.state,
      pending.toolCallId,
      output,
    );

    if (pending.remainingCalls.length > 0) {
      this.queuePendingToolCallContinuation(
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
        pending.earlyToolExecutions,
      );
      return;
    }

    if (pending.resumeAsStreaming) {
      await this.startStreamingRound(
        resumedState,
        pending.pendingUserInput,
        pending.turn,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
  }

  async executeManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest>> {
    const result = await this.startManualToolCommand(message);
    return this.waitForStartedManualToolCommandResult(result);
  }

  async startManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
    return startManualToolCommandInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest>,
      message,
    );
  }

  async startManualToolRequestDirect(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
    return this.startManualToolRequest(request, toolName);
  }

  async resumePendingManualToolApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest>> {
    const result = await this.continuePendingManualToolApproval(decision);
    return this.waitForStartedManualToolCommandResult(result);
  }

  async continuePendingManualToolApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
    return continuePendingManualToolApprovalInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest>,
      decision,
    );
  }

  private async runTurnLoop(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return runTurnLoopInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      state,
      pendingUserInput,
      turn,
    );
  }

  private async processToolCalls(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return processToolCallsInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      state,
      pendingUserInput,
      calls,
      turn,
    );
  }

  private async executeAuthorizedToolCall(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return executeAuthorizedToolCallInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      remainingCalls,
      turn,
    );
  }

  private async maybeExecuteInternalToolCall(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    _toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest> | undefined> {
    const finishSummary = extractFinishTaskSummary(request);
    if (finishSummary !== undefined && this.loopEnabled()) {
      return this.completeFinishTaskToolCall(state, request, toolCallId, finishSummary, turn);
    }

    const imageResult = await this.tryExecuteGenerateImageTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (imageResult !== undefined) {
      if (imageResult.kind !== "completed" || imageResult.assistantText !== "") {
        return imageResult;
      }

      if (remainingCalls.length > 0) {
        return this.processToolCalls(imageResult.state, pendingUserInput, remainingCalls, turn);
      }

      return this.runTurnLoop(imageResult.state, pendingUserInput, turn);
    }

    const videoResult = await this.tryExecuteGenerateVideoTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (videoResult !== undefined) {
      if (videoResult.kind !== "completed" || videoResult.assistantText !== "") {
        return videoResult;
      }

      if (remainingCalls.length > 0) {
        return this.processToolCalls(videoResult.state, pendingUserInput, remainingCalls, turn);
      }

      return this.runTurnLoop(videoResult.state, pendingUserInput, turn);
    }

    const outcome = await this.tryExecuteSubagentTool(
      request,
      toolCallId,
      pendingUserInput,
      state,
      remainingCalls,
      turn,
    );
    if (outcome.kind === "not-handled") {
      return undefined;
    }

    if (outcome.kind === "requires-approval") {
      const approval = this.currentPendingApproval() ?? outcome.approval;
      return {
        kind: "requires-approval",
        approval,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    if (outcome.kind === "requires-questions") {
      return {
        kind: "requires-questions",
        questions: this.currentPendingQuestions() ?? outcome.questions,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    if (outcome.kind === "started") {
      throw new Error("The subagent non-streaming path must not return a background-start status.");
    }

    const parentToolResultText = buildParentSubagentToolResultTextFromRequest(
      request,
      outcome.text,
      outcome.failed,
      outcome.sessionId,
      outcome.sessionTranscript,
    );

    turn.toolExecutions.push({
      toolCallId,
      toolName: "subagent",
      request,
      output: outcome.text,
      failed: outcome.failed,
    });

    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      state,
      toolCallId,
      parentToolResultText,
    );
    if (remainingCalls.length > 0) {
      return this.processToolCalls(resumedState, pendingUserInput, remainingCalls, turn);
    }

    return this.runTurnLoop(resumedState, pendingUserInput, turn);
  }

  private async maybeContinueInternalToolCallAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    _toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<boolean> {
    const finishSummary = extractFinishTaskSummary(request);
    if (finishSummary !== undefined && this.loopEnabled()) {
      this.completeTurn(
        this.completeFinishTaskToolCall(state, request, toolCallId, finishSummary, turn),
      );
      return true;
    }

    const imageResult = await this.tryExecuteGenerateImageTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (imageResult !== undefined) {
      if (imageResult.kind !== "completed" || imageResult.assistantText !== "") {
        this.completeTurn(imageResult);
        return true;
      }

      if (remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          imageResult.state,
          pendingUserInput,
          remainingCalls,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        );
        return true;
      }

      if (resumeAsStreaming) {
        await this.startStreamingRound(
          imageResult.state,
          pendingUserInput,
          turn,
          streamingEmitBeginResponse,
        );
        return true;
      }

      this.startToolAgentRoundAsync(imageResult.state, pendingUserInput, turn);
      return true;
    }

    const videoResult = await this.tryExecuteGenerateVideoTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (videoResult !== undefined) {
      if (videoResult.kind !== "completed" || videoResult.assistantText !== "") {
        this.completeTurn(videoResult);
        return true;
      }

      if (remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          videoResult.state,
          pendingUserInput,
          remainingCalls,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        );
        return true;
      }

      if (resumeAsStreaming) {
        await this.startStreamingRound(
          videoResult.state,
          pendingUserInput,
          turn,
          streamingEmitBeginResponse,
        );
        return true;
      }

      this.startToolAgentRoundAsync(videoResult.state, pendingUserInput, turn);
      return true;
    }

    const outcome = await this.tryExecuteSubagentTool(
      request,
      toolCallId,
      pendingUserInput,
      state,
      [],
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
    if (outcome.kind === "not-handled") {
      return false;
    }

    if (outcome.kind === "requires-approval") {
      const approval = this.currentPendingApproval() ?? outcome.approval;
      this.emitEvent({
        kind: "approval-requested",
        approval,
      });
      return true;
    }

    if (outcome.kind === "requires-questions") {
      this.emitEvent({
        kind: "questions-requested",
        questions: this.currentPendingQuestions() ?? outcome.questions,
      });
      return true;
    }

    if (outcome.kind === "started") {
      this.ensureSubagentBatchContinuation(
        state,
        pendingUserInput,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      );
      if (remainingCalls.length > 0) {
        await this.processToolCallsAsync(
          state,
          pendingUserInput,
          remainingCalls,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        );
      }
      return true;
    }

    const parentToolResultText = buildParentSubagentToolResultTextFromRequest(
      request,
      outcome.text,
      outcome.failed,
      outcome.sessionId,
      outcome.sessionTranscript,
    );

    turn.toolExecutions.push({
      toolCallId,
      toolName: "subagent",
      request,
      output: outcome.text,
      failed: outcome.failed,
    });

    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      state,
      toolCallId,
      parentToolResultText,
    );
    if (remainingCalls.length > 0) {
      this.queuePendingToolCallContinuation(
        resumedState,
        pendingUserInput,
        remainingCalls,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      );
      return true;
    }

    if (resumeAsStreaming) {
      await this.startStreamingRound(
        resumedState,
        pendingUserInput,
        turn,
        streamingEmitBeginResponse,
      );
      return true;
    }

    this.startToolAgentRoundAsync(resumedState, pendingUserInput, turn);
    return true;
  }

  private completeFinishTaskToolCall(
    state: State,
    request: ToolRequest,
    toolCallId: string,
    summary: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): RuntimeTurnResult<State, ToolRequest> {
    const output = summary.trim() || "Task marked complete.";
    const content = createLlmMessageContentFromText(output);
    this.historyStore.push({
      role: "tool",
      toolCallId,
      content,
    });
    turn.toolExecutions.push({
      toolCallId,
      toolName: "finish_task",
      request,
      output,
      failed: false,
    });
    this.emitEvent({
      kind: "tool-execution-finished",
      execution: {
        toolCallId,
        toolName: "finish_task",
        request,
        output,
        failed: false,
      },
    });
    this.pendingUserTurnStore = undefined;
    return {
      kind: "completed",
      assistantText: output,
      state,
      requestTrace: [...turn.requestTrace],
      toolExecutions: [...turn.toolExecutions],
      compactions: [...turn.compactions],
    };
  }

  private appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void {
    this.requestTraceStore.push(...trace);
    turn.requestTrace.push(...trace);
  }

  private startToolAgentRoundAsync(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emptyAssistantRetries = 0,
  ): void {
    startToolAgentRoundAsyncInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      state,
      pendingUserInput,
      turn,
      emptyAssistantRetries,
    );
  }

  private async pollPendingToolAgentRound(): Promise<void> {
    return pollPendingToolAgentRoundInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
    );
  }

  private async handlePendingToolAgentRoundCompletion(
    pending: PendingToolAgentRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    return handlePendingToolAgentRoundCompletionInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      pending,
      completion,
    );
  }

  private async processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): Promise<void> {
    return processToolCallsAsyncInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
      state,
      pendingUserInput,
      calls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      earlyToolExecutions,
    );
  }

  private queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void {
    this.advanceTurnToolState(turn, state);
    this.pendingToolCallContinuation = {
      pendingUserInput,
      state,
      calls: [...calls],
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
    };
  }

  private startBackgroundToolExecutionAsync(
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
    postHookToolInput?: import("./ports.js").JsonObject,
  ): void {
    startBackgroundToolExecutionAsyncInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest>,
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      argumentsJson,
      remainingCalls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      earlyToolExecutions,
      postHookToolInput,
    );
  }

  private scheduleBackgroundToolExecutionAsync(
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
    postHookToolInput?: import("./ports.js").JsonObject,
  ): void {
    scheduleBackgroundToolExecutionAsyncInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest>,
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      argumentsJson,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      earlyToolExecutions,
      postHookToolInput,
    );
  }

  private async pollPendingToolCallContinuation(): Promise<void> {
    const pending = this.pendingToolCallContinuation;
    if (!pending) {
      return;
    }

    this.pendingToolCallContinuation = undefined;
    await this.processToolCallsAsync(
      pending.state,
      pending.pendingUserInput,
      pending.calls,
      pending.turn,
      pending.resumeAsStreaming,
      pending.streamingEmitBeginResponse,
      pending.earlyToolExecutions,
    );
  }

  private startManualBackgroundToolExecution(
    request: ToolRequest,
    toolName: string,
  ): string | undefined {
    return startManualBackgroundToolExecutionInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest>,
      request,
      toolName,
    );
  }

  private async pollPendingBackgroundToolExecution(): Promise<void> {
    return pollPendingBackgroundToolExecutionInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest>,
    );
  }

  private startHistoryCompactionAsync(
    retryState: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    originalError: string,
    toolTruncationApplied: boolean,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): void {
    startHistoryCompactionAsyncInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest>,
      retryState,
      pendingUserInput,
      turn,
      originalError,
      toolTruncationApplied,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
  }

  private startManualHistoryCompactionAsync(): void {
    startManualHistoryCompactionAsyncInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest>,
    );
  }

  private async pollPendingHistoryCompaction(): Promise<void> {
    return pollPendingHistoryCompactionInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest>,
    );
  }

  private completeTurn(result: RuntimeTurnResult<State, ToolRequest>): void {
    this.completedTurnResultStore = result;
    this.emitSyncTurnResultEvents(result);
    if (this.runtimeDepthStore === 0) {
      void this.syncSessionTranscriptFromHistory();
    }
  }

  private completedViaFinishTask(result: RuntimeTurnResult<State, ToolRequest>): boolean {
    return result.toolExecutions.some(
      (execution) => execution.toolName === "finish_task" && !execution.failed,
    );
  }

  private storeCompletedTurnResult(result: RuntimeTurnResult<State, ToolRequest>): void {
    this.completedTurnResultStore = result;
    // Streaming turns complete here (not via completeTurn); keep transcript in sync.
    if (this.runtimeDepthStore === 0) {
      void this.syncSessionTranscriptFromHistory();
    }
  }

  async waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest>> {
    return waitForCompletedTurnResultInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest>,
    );
  }

  private async prepareSubmittedUserTurn(
    userInput: string,
    explicitImages: string[],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
    activeSkillsForTurn: ToolAgentActiveSkill[] = [],
  ): Promise<State> {
    return prepareSubmittedUserTurnInternal(
      this as unknown as ContextRuntime<Config, State, ToolRequest>,
      userInput,
      explicitImages,
      explicitWorkspaceFiles,
      activeSkillsForTurn,
    );
  }

  private completeSubmitPromptDenied(error: SubmitPromptHookDeniedError): void {
    if (error.followupMessage) {
      this.recordContextMessage("system", error.followupMessage);
    }
    this.historyStore.push({
      role: "assistant",
      content: createLlmMessageContentFromText(error.denialMessage),
    });
    const state = this.options.createToolAgentState(this.historyStore, "");
    this.completedTurnResultStore = {
      kind: "completed",
      assistantText: error.denialMessage,
      state,
      requestTrace: [],
      toolExecutions: [],
      compactions: [],
    };
  }

  private async prepareMcpPromptTurn(
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<{
    notice: string;
    state: State;
    userTurn: string;
  }> {
    if (this.hasPendingApproval()) {
      throw new Error("Respond to the current pending tool call first.");
    }

    if (this.isBusy()) {
      throw new Error("The previous reply is still being processed; please wait.");
    }

    const value = await this.options.toolExecutor.getMcpPrompt(server, prompt, argsJson);
    const promptMessages = promptMessagesFromValue(value);
    if (promptMessages.length === 0) {
      throw new Error("The MCP prompt did not return usable messages");
    }

    this.historyStore.push(...promptMessages);

    const trimmedUserMessage = userMessage?.trim();
    let userTurn: string;
    let state: State;
    if (trimmedUserMessage) {
      userTurn = trimmedUserMessage;
      state = await this.prepareSubmittedUserTurn(userTurn, []);
    } else {
      const promptUserMessage = [...promptMessages]
        .reverse()
        .find(
          (message) => message.role === "user" && llmMessageTextContent(message.content).trim(),
        );
      userTurn = promptUserMessage
        ? llmMessageTextContent(promptUserMessage.content)
        : `Continue based on the applied MCP prompt ${prompt}.`;
      this.pendingUserTurnStore = userTurn;
      state = this.options.createToolAgentState(this.historyStore, userTurn);
    }

    this.completedTurnResultStore = undefined;
    return {
      notice: `Applied MCP prompt: ${server} / ${prompt} (${promptMessages.length} messages)`,
      state,
      userTurn,
    };
  }

  private async startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void> {
    return startStreamingRoundInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
      state,
      pendingUserInput,
      turn,
      emitBeginResponse,
    );
  }

  private async consumeStreamEvents(
    pending: PendingStreamingRound<State, ToolRequest>,
    eventStream: AsyncIterable<LlmStreamEvent>,
  ): Promise<void> {
    return consumeStreamEventsInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
      pending,
      eventStream,
    );
  }

  private async pollPendingStreamingRound(): Promise<void> {
    return pollPendingStreamingRoundInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
    );
  }

  private async handlePendingStreamEvent(
    pending: PendingStreamingRound<State, ToolRequest>,
    event: LlmStreamEvent,
  ): Promise<boolean> {
    return handlePendingStreamEventInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
      pending,
      event,
    );
  }

  private async handlePendingStreamingCompletion(
    pending: PendingStreamingRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    return handlePendingStreamingCompletionInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
      pending,
      completion,
    );
  }

  private emitSyncTurnResultEvents(result: RuntimeTurnResult<State, ToolRequest>): void {
    if (result.kind === "completed") {
      if (this.completedViaFinishTask(result)) {
        return;
      }
      this.emitEvent({ kind: "begin-assistant-response" });
      this.emitEvent({ kind: "assistant-chunk", text: result.assistantText });
      this.emitEvent({ kind: "assistant-response-completed" });
      return;
    }

    if (result.kind === "requires-approval") {
      this.emitEvent({
        kind: "approval-requested",
        approval: result.approval,
      });
      return;
    }

    if (result.kind === "requires-questions") {
      this.emitEvent({
        kind: "questions-requested",
        questions: result.questions,
      });
      return;
    }

    this.emitEvent({ kind: "remove-pending-assistant" });
    this.emitEvent({ kind: "assistant-response-completed" });
  }

  private emitEvent(event: RuntimeEvent<ToolRequest>): void {
    this.eventQueueStore.push(event);
    this.options.onEvent?.(event);
  }

  private clearPendingNonStreamingState(): void {
    this.pendingToolAgentRound = undefined;
    this.pendingToolCallContinuation = undefined;
    this.pendingBackgroundToolExecution = undefined;
    this.deferredBackgroundToolExecutions = [];
    this.pendingHistoryCompaction = undefined;
    this.pendingQuestions = undefined;
    this.completedTurnResultStore = undefined;
    this.completedManualToolCommandResultStore = undefined;
    this.completedManualHistoryCompactionResultStore = undefined;
  }

  private currentAuxKind(): AssistantAuxKind | undefined {
    if (this.pendingSubagentExecutions.size > 0) {
      return "thinking";
    }

    return currentAuxKindInternal(this as unknown as StreamingRuntime<Config, State, ToolRequest>);
  }

  private currentAuxText(): string | undefined {
    if (this.pendingSubagentExecutions.size > 0) {
      return undefined;
    }

    return currentAuxTextInternal(this as unknown as StreamingRuntime<Config, State, ToolRequest>);
  }

  private currentSubagentStatusText(): string {
    const pendingCount = this.pendingSubagentExecutions.size;
    const pending = this.firstPendingSubagentExecution();
    if (!pending) {
      return "SubAgent: Running";
    }

    if (pendingCount > 1) {
      return `SubAgent: ${pendingCount} running`;
    }

    const title = pending.childRecord.summary.title.trim() || "SubAgent";
    const childApproval = pending.childRuntime.currentPendingApproval();
    if (childApproval) {
      return `${title}: Awaiting approval ${childApproval.toolName}`;
    }

    const pendingAssistantProgress = normalizeSubagentStatusProgress(
      pending.childRuntime.pendingAssistantText(),
      title,
    );
    if (pendingAssistantProgress) {
      return `${title}: ${truncateTextForSubagentSummary(pendingAssistantProgress, 120)}`;
    }

    const backgroundProgress = normalizeSubagentStatusProgress(
      pending.childRuntime.backgroundToolStatus(),
      title,
    );
    if (backgroundProgress) {
      return `${title}: ${truncateTextForSubagentSummary(backgroundProgress, 120)}`;
    }

    if (!pending.childRuntime.isBusy()) {
      const completedProgress = normalizeSubagentStatusProgress(
        resolveSubagentResultText("", pending.childRecord, false),
        title,
      );
      if (completedProgress) {
        return `${title}: ${truncateTextForSubagentSummary(completedProgress, 120)}`;
      }

      return `${title}: Done`;
    }

    const progress = normalizeSubagentStatusProgress(
      pending.childRecord.summary.latestMessage,
      title,
    );
    if (!progress) {
      return `${title}: Running`;
    }

    return `${title}: ${truncateTextForSubagentSummary(progress, 120)}`;
  }

  private clearStreamingUiState(): void {
    clearStreamingUiStateInternal(this as unknown as StreamingRuntime<Config, State, ToolRequest>);
  }

  private clearPendingStreamingState(): void {
    clearPendingStreamingStateInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest>,
    );
  }

  private async startManualToolRequest(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
    return startManualToolRequestInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest>,
      request,
      toolName,
    );
  }

  private async waitForStartedManualToolCommandResult(
    result: RuntimeManualToolCommandStartResult<State, ToolRequest>,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest>> {
    return waitForStartedManualToolCommandResultInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest>,
      result,
    );
  }

  private async waitForCompletedManualToolCommandResult(): Promise<
    RuntimeCompletedManualToolCommandResult<ToolRequest>
  > {
    return waitForCompletedManualToolCommandResultInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest>,
    );
  }

  private async waitForCompletedManualHistoryCompactionResult(): Promise<RuntimeManualHistoryCompactionResult> {
    return waitForCompletedManualHistoryCompactionResultInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest>,
    );
  }

  private async performToolExecution(
    request: ToolRequest,
    toolName: string,
    toolCallId?: string,
  ): Promise<{
    output: ToolExecutionOutput;
    failed: boolean;
    backgroundExecution: boolean;
  }> {
    this.inFlightSynchronousToolExecutionsStore += 1;
    try {
      return await performToolExecutionInternal(
        this as unknown as ToolExecutionRuntime<Config, State, ToolRequest>,
        request,
        toolName,
        toolCallId,
      );
    } finally {
      this.inFlightSynchronousToolExecutionsStore -= 1;
    }
  }

  private async tryPerformEarlyInternalToolCall(
    request: ToolRequest,
    _toolCallId: string,
    _toolName: string,
  ): Promise<EarlyInternalToolCallResult | undefined> {
    if (extractFinishTaskSummary(request) !== undefined) {
      return { kind: "defer-to-formal" };
    }

    const imageRequest = extractGenerateImageRequest(request);
    if (imageRequest !== undefined) {
      try {
        if (!this.options.generateImage) {
          throw new Error("No image generation executor is configured.");
        }

        const output = await this.options.generateImage(imageRequest);
        return {
          kind: "completed",
          output,
          failed: false,
          enqueueDeferredGuidance: false,
        };
      } catch (error) {
        const message = renderError(error);
        return {
          kind: "completed",
          output: createToolExecutionTextOutput(`generate_image failed: ${message}`),
          failed: true,
          enqueueDeferredGuidance: false,
          fatalError: message,
        };
      }
    }

    const videoRequest = extractGenerateVideoRequest(request);
    if (videoRequest !== undefined) {
      try {
        if (!this.options.generateVideo) {
          throw new Error("No video generation executor is configured.");
        }

        const output = await this.options.generateVideo(videoRequest);
        return {
          kind: "completed",
          output,
          failed: false,
          enqueueDeferredGuidance: false,
        };
      } catch (error) {
        const message = renderError(error);
        return {
          kind: "completed",
          output: createToolExecutionTextOutput(`generate_video failed: ${message}`),
          failed: true,
          enqueueDeferredGuidance: false,
          fatalError: message,
        };
      }
    }

    if (extractSubagentRequest(request) !== undefined) {
      return { kind: "defer-to-formal" };
    }

    return undefined;
  }

  private takePendingImages(): string[] {
    const images = [...this.pendingImagePathsStore];
    this.pendingImagePathsStore = [];
    return images;
  }

  private takePendingMcpResources(): PendingMcpResource[] {
    const resources = [...this.pendingMcpResourcesStore];
    this.pendingMcpResourcesStore = [];
    return resources;
  }

  private async tryExecuteSubagentTool(
    request: ToolRequest,
    parentToolCallId: string,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<SubagentToolExecutionResult<ToolRequest>> {
    const subagent = extractSubagentRequest(request);
    if (!subagent) {
      return { kind: "not-handled" };
    }

    return this.executeSubagentTool(
      subagent,
      parentToolCallId,
      request,
      parentPendingUserInput,
      parentState,
      parentRemainingCalls,
      parentTurn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
  }

  private async tryExecuteGenerateImageTool(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest> | undefined> {
    const imageRequest = extractGenerateImageRequest(request);
    if (imageRequest === undefined) {
      return undefined;
    }

    try {
      if (!this.options.generateImage) {
        throw new Error("No image generation executor is configured.");
      }

      const output = await this.options.generateImage(imageRequest);
      const resumedState = await this.appendToolResultMessageWithOutputTruncation(
        state,
        toolCallId,
        output.summaryText,
      );
      this.finishGenerateImageToolCall(
        request,
        toolCallId,
        toolName,
        output.summaryText,
        false,
        turn,
        toolArtifactsFromOutput(output),
      );

      return {
        kind: "completed",
        assistantText: "",
        state: resumedState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    } catch (error) {
      const message = renderError(error);
      this.finishGenerateImageToolCall(
        request,
        toolCallId,
        toolName,
        `generate_image failed: ${message}`,
        true,
        turn,
      );
      return this.failedTurnResult(message, state, turn);
    }
  }

  private finishGenerateImageToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>["artifacts"],
  ): RuntimeToolExecution<ToolRequest> {
    return this.finishInternalMediaGenerationToolCall(
      request,
      toolCallId,
      toolName,
      output,
      failed,
      turn,
      artifacts,
    );
  }

  private async tryExecuteGenerateVideoTool(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest> | undefined> {
    const videoRequest = extractGenerateVideoRequest(request);
    if (videoRequest === undefined) {
      return undefined;
    }

    try {
      if (!this.options.generateVideo) {
        throw new Error("No video generation executor is configured.");
      }

      const output = await this.options.generateVideo(videoRequest);
      const resumedState = await this.appendToolResultMessageWithOutputTruncation(
        state,
        toolCallId,
        output.summaryText,
      );
      this.finishGenerateVideoToolCall(
        request,
        toolCallId,
        toolName,
        output.summaryText,
        false,
        turn,
        toolArtifactsFromOutput(output),
      );

      return {
        kind: "completed",
        assistantText: "",
        state: resumedState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    } catch (error) {
      const message = renderError(error);
      this.finishGenerateVideoToolCall(
        request,
        toolCallId,
        toolName,
        `generate_video failed: ${message}`,
        true,
        turn,
      );
      return this.failedTurnResult(message, state, turn);
    }
  }

  private finishGenerateVideoToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>["artifacts"],
  ): RuntimeToolExecution<ToolRequest> {
    return this.finishInternalMediaGenerationToolCall(
      request,
      toolCallId,
      toolName,
      output,
      failed,
      turn,
      artifacts,
    );
  }

  private finishInternalMediaGenerationToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>["artifacts"],
  ): RuntimeToolExecution<ToolRequest> {
    const finished: RuntimeToolExecution<ToolRequest> = {
      toolCallId,
      toolName,
      request,
      output,
      failed,
      ...(artifacts ? { artifacts } : {}),
    };
    turn.toolExecutions.push(finished);
    this.emitEvent({ kind: "tool-execution-finished", execution: finished });
    return finished;
  }

  private failedTurnResult(
    error: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): RuntimeTurnResult<State, ToolRequest> {
    return {
      kind: "failed",
      error,
      state,
      requestTrace: [...turn.requestTrace],
      toolExecutions: [...turn.toolExecutions],
      compactions: [...turn.compactions],
    };
  }

  private async executeSubagentTool(
    request: SubagentRequest,
    parentToolCallId: string,
    parentRequest: ToolRequest,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<SubagentToolExecutionResult<ToolRequest>> {
    if (this.runtimeDepthStore >= 1) {
      return this.completedSubagentToolOutcome(
        undefined,
        "[subagent blocked] This version supports only one level of child sessions from the main session; further nesting is not supported.",
        true,
      );
    }

    const sessionId = this.nextChildSessionId();
    const startedAtUnixMs = Date.now();
    const record: RuntimeSubagentSessionArchiveEntry = {
      summary: {
        sessionId,
        parentToolCallId,
        title: truncateTextForSubagentSummary(request.task.trim(), 72) || "SubAgent",
        status: "running",
        startedAtUnixMs,
        updatedAtUnixMs: startedAtUnixMs,
      },
      llmHistory: [],
    };

    let childToolExecutor:
      | AgentRuntimeOptions<Config, State, ToolRequest>["toolExecutor"]
      | undefined;
    let childWorkspaceRoot: string | undefined;
    if (request.worktree === true) {
      const bootstrap = this.options.bootstrapSubagentWorkspace;
      const parentWorkspaceRoot =
        resolveHookSessionContext(this.options).workspaceRoot?.trim() ?? "";
      if (!bootstrap) {
        return this.failSubagentSessionBeforeChildRun(
          record,
          request,
          "[subagent failed] worktree subagents are not supported on this host.",
        );
      }

      if (resumeAsStreaming) {
        record.summary.status = "bootstrapping";
        const childUserTurn = buildSubagentUserTurn(request);
        record.llmHistory = [
          {
            role: "user",
            content: createLlmMessageContentFromText(childUserTurn),
          },
        ];
        record.summary.latestMessage = truncateTextForSubagentSummary(request.task.trim(), 180);
        this.childSessionsStore.push(record);
        this.pendingSubagentWorktreeBootstraps.set(parentToolCallId, {
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRecord: record,
          request,
          parentWorkspaceRoot,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        });
        return { kind: "started" };
      }

      const boot = await bootstrap({
        subagentSessionId: sessionId,
        task: request.task,
        worktree: true,
        parentWorkspaceRoot,
      });
      if ("error" in boot) {
        return this.failSubagentSessionBeforeChildRun(
          record,
          request,
          `[subagent failed] ${boot.error}`,
        );
      }
      if (boot.worktreePath) {
        record.summary.worktreePath = boot.worktreePath;
      }
      if (boot.branchName) {
        record.summary.worktreeBranch = boot.branchName;
      }
      childToolExecutor = boot.toolExecutor ?? this.options.toolExecutor;
      childWorkspaceRoot = boot.workspaceRoot;
    }

    const childRuntime = this.createChildRuntime(
      record.summary.sessionId,
      record.summary.title,
      childToolExecutor,
      childWorkspaceRoot,
    );
    this.childSessionsStore.push(record);

    const childUserTurn = buildSubagentUserTurn(request);
    const subagentStartDenied = await this.subagentStartHook(
      sessionId,
      request,
      childWorkspaceRoot,
    );
    if (subagentStartDenied) {
      // Persist task + denial before terminal sync; llmHistory is still empty at this point otherwise.
      record.llmHistory = [
        {
          role: "user",
          content: createLlmMessageContentFromText(childUserTurn),
        },
        {
          role: "assistant",
          content: createLlmMessageContentFromText(subagentStartDenied),
        },
      ];
      record.summary.latestMessage = truncateTextForSubagentSummary(subagentStartDenied, 180);
      record.summary.error = subagentStartDenied;
      this.markChildSessionTerminalAndSyncTranscript(record, "failed");
      return this.completedSubagentToolOutcome(sessionId, subagentStartDenied, true);
    }

    record.llmHistory = [
      {
        role: "user",
        content: createLlmMessageContentFromText(childUserTurn),
      },
    ];
    record.summary.latestMessage = truncateTextForSubagentSummary(request.task.trim(), 180);

    if (resumeAsStreaming) {
      try {
        await childRuntime.startUserTurnStreaming(childUserTurn);
        this.cachePendingSubagentExecution({
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRuntime,
          childRecord: record,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        });
        this.refreshChildSessionRecord(record, childRuntime);
        record.summary.status = childRuntime.currentPendingApproval() ? "blocked" : "running";
        return { kind: "started" };
      } catch (error) {
        // Pull any messages already written into the child runtime before terminal sync.
        this.refreshChildSessionRecord(record, childRuntime);
        const failed = `[subagent failed] ${renderError(error)}`;
        record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
        delete record.summary.finalOutput;
        record.summary.error = failed;
        this.markChildSessionTerminalAndSyncTranscript(record, "failed");
        return this.completedSubagentToolOutcome(sessionId, failed, true);
      }
    }

    try {
      const result = await childRuntime.submitUserTurn(childUserTurn);
      this.refreshChildSessionRecord(record, childRuntime);

      if (result.kind === "completed") {
        const finalOutput = resolveSubagentResultText(result.assistantText, record, false);
        record.summary.latestMessage = truncateTextForSubagentSummary(finalOutput, 180);
        record.summary.finalOutput = finalOutput;
        delete record.summary.error;
        this.markChildSessionTerminalAndSyncTranscript(record, "completed");
        return this.completedSubagentToolOutcome(sessionId, finalOutput, false);
      }

      if (result.kind === "requires-approval") {
        record.summary.status = "blocked";
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.latestMessage = `Awaiting foreground approval: ${result.approval.toolName}`;
        delete record.summary.completedAtUnixMs;
        delete record.summary.finalOutput;
        delete record.summary.error;
        this.cachePendingSubagentExecution(
          this.buildPendingSubagentExecution(
            parentRequest,
            parentToolCallId,
            parentPendingUserInput,
            parentState,
            parentRemainingCalls,
            parentTurn,
            childRuntime,
            record,
            resumeAsStreaming,
            streamingEmitBeginResponse,
          ),
        );
        return { kind: "requires-approval", approval: result.approval };
      }

      if (result.kind === "requires-questions") {
        this.updateSubagentQuestionsBlockedState(record, result.questions);
        this.cachePendingSubagentExecution(
          this.buildPendingSubagentExecution(
            parentRequest,
            parentToolCallId,
            parentPendingUserInput,
            parentState,
            parentRemainingCalls,
            parentTurn,
            childRuntime,
            record,
            resumeAsStreaming,
            streamingEmitBeginResponse,
          ),
        );
        return {
          kind: "requires-questions",
          questions: childRuntime.currentPendingQuestions() ?? result.questions,
        };
      }

      const failed = `[subagent failed] ${result.error}`;
      record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
      delete record.summary.finalOutput;
      record.summary.error = failed;
      this.markChildSessionTerminalAndSyncTranscript(record, "failed");
      return this.completedSubagentToolOutcome(sessionId, failed, true);
    } catch (error) {
      const failed = `[subagent failed] ${renderError(error)}`;
      record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
      delete record.summary.finalOutput;
      record.summary.error = failed;
      this.markChildSessionTerminalAndSyncTranscript(record, "failed");
      return this.completedSubagentToolOutcome(sessionId, failed, true);
    }
  }

  private refreshChildSessionRecord(
    record: RuntimeSubagentSessionArchiveEntry,
    childRuntime: AgentRuntime<Config, State, ToolRequest>,
  ): void {
    record.llmHistory = childRuntime
      .history()
      .map((message) => serializeRuntimeLlmMessageForArchive(message));
    const pendingAssistant = childRuntime.pendingAssistantText().trim();
    if (pendingAssistant.length > 0) {
      record.llmHistory.push({
        role: "assistant",
        content: createLlmMessageContentFromText(pendingAssistant),
      });
    }
    record.summary.updatedAtUnixMs = Date.now();

    const latestMessage =
      pendingAssistant.length > 0
        ? truncateTextForSubagentSummary(pendingAssistant, 180)
        : childRuntime.thinkingText().trim().length > 0
          ? truncateTextForSubagentSummary(childRuntime.thinkingText().trim(), 180)
          : latestAssistantMessage(record.llmHistory);
    if (latestMessage !== undefined) {
      record.summary.latestMessage = latestMessage;
    } else {
      delete record.summary.latestMessage;
    }
  }

  private markChildSessionTerminalAndSyncTranscript(
    record: RuntimeSubagentSessionArchiveEntry,
    status: "completed" | "failed",
  ): void {
    record.summary.status = status;
    record.summary.updatedAtUnixMs = Date.now();
    record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
    void this.syncSubagentTranscriptBestEffort(record.summary.sessionId, record.llmHistory);
  }

  private async continuePendingSubagentApproval(decision: RuntimeApprovalDecision): Promise<void> {
    const pending = this.findPendingSubagentWithApproval();
    if (!pending) {
      throw new Error("There is no pending tool call to confirm.");
    }

    this.completedTurnResultStore = undefined;
    await pending.childRuntime.continuePendingApproval(decision);
    this.refreshChildSessionRecord(pending.childRecord, pending.childRuntime);
    pending.childRecord.summary.status = pending.childRuntime.currentPendingApproval()
      ? "blocked"
      : "running";
    if (pending.childRuntime.currentPendingApproval()) {
      pending.childRecord.summary.latestMessage = `Awaiting foreground approval: ${pending.childRuntime.currentPendingApproval()?.toolName}`;
      return;
    }

    await this.pollPendingSubagentExecution();
  }

  private async pollPendingSubagentWorktreeBootstrap(): Promise<void> {
    if (this.pendingSubagentWorktreeBootstraps.size === 0) {
      return;
    }

    for (const [parentToolCallId, pending] of this.pendingSubagentWorktreeBootstraps.entries()) {
      this.pendingSubagentWorktreeBootstraps.delete(parentToolCallId);
      try {
        await this.completePendingSubagentWorktreeBootstrap(pending);
      } catch (error) {
        await this.finishFailedSubagentWorktreeBootstrap(pending, renderError(error));
      }
    }
  }

  private async completePendingSubagentWorktreeBootstrap(
    pending: PendingSubagentWorktreeBootstrap<State, ToolRequest>,
  ): Promise<void> {
    const bootstrap = this.options.bootstrapSubagentWorkspace;
    if (!bootstrap) {
      await this.finishFailedSubagentWorktreeBootstrap(
        pending,
        "worktree subagents are not supported on this host.",
      );
      return;
    }

    const boot = await bootstrap({
      subagentSessionId: pending.childRecord.summary.sessionId,
      task: pending.request.task,
      worktree: true,
      parentWorkspaceRoot: pending.parentWorkspaceRoot,
    });
    if ("error" in boot) {
      await this.finishFailedSubagentWorktreeBootstrap(pending, boot.error);
      return;
    }

    if (boot.worktreePath) {
      pending.childRecord.summary.worktreePath = boot.worktreePath;
    }
    if (boot.branchName) {
      pending.childRecord.summary.worktreeBranch = boot.branchName;
    }

    const childRuntime = this.createChildRuntime(
      pending.childRecord.summary.sessionId,
      pending.childRecord.summary.title,
      boot.toolExecutor ?? this.options.toolExecutor,
      boot.workspaceRoot,
    );

    const subagentStartDenied = await this.subagentStartHook(
      pending.childRecord.summary.sessionId,
      pending.request,
      boot.workspaceRoot,
    );
    if (subagentStartDenied) {
      await this.finishFailedSubagentWorktreeBootstrap(pending, subagentStartDenied);
      return;
    }

    const childUserTurn = buildSubagentUserTurn(pending.request);
    try {
      await childRuntime.startUserTurnStreaming(childUserTurn);
      this.cachePendingSubagentExecution(
        this.buildPendingSubagentExecution(
          pending.parentRequest,
          pending.parentToolCallId,
          pending.parentPendingUserInput,
          pending.parentState,
          pending.parentRemainingCalls,
          pending.parentTurn,
          childRuntime,
          pending.childRecord,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
        ),
      );
      this.refreshChildSessionRecord(pending.childRecord, childRuntime);
      pending.childRecord.summary.status = childRuntime.currentPendingApproval()
        ? "blocked"
        : "running";
    } catch (error) {
      this.refreshChildSessionRecord(pending.childRecord, childRuntime);
      await this.finishFailedSubagentWorktreeBootstrap(pending, renderError(error));
    }
  }

  private async finishFailedSubagentWorktreeBootstrap(
    pending: PendingSubagentWorktreeBootstrap<State, ToolRequest>,
    errorText: string,
  ): Promise<void> {
    const failed = `[subagent failed] ${errorText}`;
    pending.childRecord.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
    delete pending.childRecord.summary.finalOutput;
    pending.childRecord.summary.error = failed;
    this.markChildSessionTerminalAndSyncTranscript(pending.childRecord, "failed");

    const parentToolResultText = prependSubagentWorktreeMeta(
      buildParentSubagentToolResultText(
        pending.childRecord.summary.title,
        failed,
        true,
        pending.childRecord.summary.sessionId,
        this.resolveSubagentTranscriptPath(pending.childRecord.summary.sessionId),
      ),
      pending.childRecord.summary.worktreePath,
      pending.childRecord.summary.worktreeBranch,
    );

    const finishedExecution = {
      toolCallId: pending.parentToolCallId,
      toolName: "subagent",
      request: pending.parentRequest,
      output: failed,
      failed: true,
    };
    pending.parentTurn.toolExecutions.push(finishedExecution);
    this.emitEvent({ kind: "tool-execution-finished", execution: finishedExecution });

    const batch = this.pendingSubagentBatchContinuation;
    const baseState = batch?.parentState ?? pending.parentState;
    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      baseState,
      pending.parentToolCallId,
      parentToolResultText,
    );
    if (batch) {
      batch.parentState = resumedState;
    }

    if (this.pendingSubagentExecutions.size > 0) {
      return;
    }

    const finalState = batch?.parentState ?? resumedState;
    const continuation = batch ?? {
      parentPendingUserInput: pending.parentPendingUserInput,
      parentTurn: pending.parentTurn,
      resumeAsStreaming: pending.resumeAsStreaming,
      streamingEmitBeginResponse: pending.streamingEmitBeginResponse,
    };
    this.pendingSubagentBatchContinuation = undefined;

    if (pending.parentRemainingCalls.length > 0) {
      await this.processToolCallsAsync(
        finalState,
        continuation.parentPendingUserInput,
        pending.parentRemainingCalls,
        continuation.parentTurn,
        continuation.resumeAsStreaming,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    if (continuation.resumeAsStreaming) {
      await this.startStreamingRound(
        finalState,
        continuation.parentPendingUserInput,
        continuation.parentTurn,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(
      finalState,
      continuation.parentPendingUserInput,
      continuation.parentTurn,
    );
  }

  private async pollPendingSubagentExecution(): Promise<void> {
    if (this.pendingSubagentExecutions.size === 0) {
      return;
    }

    for (const pending of this.pendingSubagentExecutions.values()) {
      await pending.childRuntime.poll();
      // Do not drain here: child session events are consumed by desktop syncSubagentConversationProjections.
      this.refreshChildSessionRecord(pending.childRecord, pending.childRuntime);

      const childApproval = pending.childRuntime.currentPendingApproval();
      if (childApproval) {
        pending.childRecord.summary.status = "blocked";
        pending.childRecord.summary.latestMessage = `Awaiting foreground approval: ${childApproval.toolName}`;
        delete pending.childRecord.summary.completedAtUnixMs;
        delete pending.childRecord.summary.finalOutput;
        delete pending.childRecord.summary.error;
        continue;
      }

      const result = pending.childRuntime.takeCompletedTurnResult();
      if (!result) {
        if (pending.childRuntime.isBusy()) {
          pending.childRecord.summary.status = "running";
        }
        continue;
      }

      if (result.kind === "requires-approval") {
        pending.childRecord.summary.status = "blocked";
        pending.childRecord.summary.latestMessage = `Awaiting foreground approval: ${result.approval.toolName}`;
        continue;
      }

      if (result.kind === "requires-questions") {
        this.updateSubagentQuestionsBlockedState(
          pending.childRecord,
          pending.childRuntime.currentPendingQuestions() ?? result.questions,
        );
        continue;
      }

      if (result.kind === "completed" || result.kind === "failed") {
        await this.finishPendingSubagentExecution(pending, result);
      }
    }
  }

  private async finishPendingSubagentExecution(
    pending: PendingSubagentExecution<Config, State, ToolRequest>,
    result: Extract<RuntimeTurnResult<State, ToolRequest>, { kind: "completed" | "failed" }>,
  ): Promise<void> {
    this.pendingSubagentExecutions.delete(pending.parentToolCallId);

    const output =
      result.kind === "completed"
        ? {
            text: resolveSubagentResultText(result.assistantText, pending.childRecord, false),
            failed: false,
          }
        : {
            text: resolveSubagentResultText(
              `[subagent failed] ${result.error}`,
              pending.childRecord,
              true,
            ),
            failed: true,
          };
    const parentToolResultText = prependSubagentWorktreeMeta(
      buildParentSubagentToolResultText(
        pending.childRecord.summary.title,
        output.text,
        output.failed,
        pending.childRecord.summary.sessionId,
        this.resolveSubagentTranscriptPath(pending.childRecord.summary.sessionId),
      ),
      pending.childRecord.summary.worktreePath,
      pending.childRecord.summary.worktreeBranch,
    );

    pending.childRecord.summary.latestMessage = truncateTextForSubagentSummary(output.text, 180);
    if (output.failed) {
      pending.childRecord.summary.error = output.text;
      delete pending.childRecord.summary.finalOutput;
    } else {
      pending.childRecord.summary.finalOutput = output.text;
      delete pending.childRecord.summary.error;
    }
    this.markChildSessionTerminalAndSyncTranscript(
      pending.childRecord,
      output.failed ? "failed" : "completed",
    );

    await this.subagentEndHook(pending, output, pending.childRecord.summary.worktreePath);

    const finishedExecution = {
      toolCallId: pending.parentToolCallId,
      toolName: "subagent",
      request: pending.parentRequest,
      output: output.text,
      failed: output.failed,
    };
    pending.parentTurn.toolExecutions.push(finishedExecution);
    this.emitEvent({ kind: "tool-execution-finished", execution: finishedExecution });

    const batch = this.pendingSubagentBatchContinuation;
    const baseState = batch?.parentState ?? pending.parentState;
    const resumedState = await this.appendToolResultMessageWithOutputTruncation(
      baseState,
      pending.parentToolCallId,
      parentToolResultText,
    );
    if (batch) {
      batch.parentState = resumedState;
    }

    if (this.pendingSubagentExecutions.size > 0) {
      return;
    }

    const finalState = batch?.parentState ?? resumedState;
    const continuation = batch ?? {
      parentPendingUserInput: pending.parentPendingUserInput,
      parentTurn: pending.parentTurn,
      resumeAsStreaming: pending.resumeAsStreaming,
      streamingEmitBeginResponse: pending.streamingEmitBeginResponse,
    };
    this.pendingSubagentBatchContinuation = undefined;

    if (pending.parentRemainingCalls.length > 0) {
      await this.processToolCallsAsync(
        finalState,
        continuation.parentPendingUserInput,
        pending.parentRemainingCalls,
        continuation.parentTurn,
        continuation.resumeAsStreaming,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    if (continuation.resumeAsStreaming) {
      await this.startStreamingRound(
        finalState,
        continuation.parentPendingUserInput,
        continuation.parentTurn,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(
      finalState,
      continuation.parentPendingUserInput,
      continuation.parentTurn,
    );
  }

  private createChildRuntime(
    subagentSessionId: string,
    subagentTitle: string,
    childToolExecutor?: AgentRuntimeOptions<Config, State, ToolRequest>["toolExecutor"],
    childWorkspaceRoot?: string,
  ): AgentRuntime<Config, State, ToolRequest> {
    const baseExecutor = childToolExecutor ?? this.options.toolExecutor;
    const scopedOptions = childWorkspaceRoot?.trim()
      ? scopeAgentRuntimeOptionsForSubagentWorkspace(this.options, childWorkspaceRoot)
      : this.options;
    // Parent owns transcript files; child must not overwrite the main session transcript.
    // onEvent is the parent session's host channel (e.g. the server broadcasts it as
    // `runtime.event`); child events must reach hosts only via drainActiveChildSessionEvents,
    // otherwise child thinking/text leaks into the main session's event stream.
    const {
      syncSessionTranscript: _omitSyncSessionTranscript,
      syncSubagentTranscript: _omitSyncSubagentTranscript,
      onEvent: _omitOnEvent,
      ...childRuntimeOptions
    } = scopedOptions;
    return new AgentRuntime<Config, State, ToolRequest>(
      {
        ...childRuntimeOptions,
        toolExecutor: createSubagentToolExecutor(baseExecutor, subagentSessionId, subagentTitle),
      },
      [],
      this.runtimeDepthStore + 1,
    );
  }

  private nextChildSessionId(): string {
    this.childSessionCounterStore += 1;
    return `subagent-${Date.now()}-${this.childSessionCounterStore}`;
  }

  private async subagentStartHook(
    subagentSessionId: string,
    request: SubagentRequest,
    hookWorkspaceRoot?: string,
  ): Promise<string | undefined> {
    const hookRunner = resolveHookRunner(this.options);
    if (!hookRunner) {
      return undefined;
    }

    const context = resolveHookSessionContext(this.options);
    const workspaceRoot = hookWorkspaceRoot?.trim() || context.workspaceRoot;
    const result = await hookRunner.runSubagentStart({
      sessionId: context.sessionId,
      conversationPath: context.conversationPath,
      workspaceRoot,
      model: context.model,
      subagentSessionId,
      subagentType: request.subagentType ?? "generalPurpose",
      task: request.task,
    });

    appendHookAdditionalContexts(
      (role, content) => this.recordContextMessage(role, content),
      result.additionalContexts,
    );

    if (!result.denied) {
      return undefined;
    }
    return result.userMessage ?? result.agentMessage ?? "Subagent start denied by hook.";
  }

  private async subagentEndHook<
    Pending extends PendingSubagentExecution<Config, State, ToolRequest>,
  >(
    pending: Pending,
    output: { text: string; failed: boolean },
    hookWorkspaceRoot?: string,
  ): Promise<void> {
    const hookRunner = resolveHookRunner(this.options);
    if (!hookRunner) {
      return;
    }

    const subagentRequest = extractSubagentRequest(pending.parentRequest);
    const context = resolveHookSessionContext(this.options);
    const workspaceRoot = hookWorkspaceRoot?.trim() || context.workspaceRoot;
    const result = await hookRunner.runSubagentEnd({
      sessionId: context.sessionId,
      conversationPath: context.conversationPath,
      workspaceRoot,
      model: context.model,
      subagentSessionId: pending.childRecord.summary.sessionId,
      subagentType: subagentRequest?.subagentType ?? "generalPurpose",
      status: output.failed ? "error" : "completed",
      task: subagentRequest?.task ?? pending.childRecord.summary.title,
      summary: output.text,
      modifiedFiles: undefined,
    });

    appendHookAdditionalContexts(
      (role, content) => this.recordContextMessage(role, content),
      result.additionalContexts,
    );

    if (!output.failed && result.followupMessage?.trim()) {
      enqueueDeferredUserGuidance(pending.parentTurn, result.followupMessage.trim());
    }
  }
}

function extractGenerateImageRequest<ToolRequest>(
  request: ToolRequest,
): ImageGenerationRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: Record<string, JsonValue>;
  if (readOptionalStringField(request, "name") === "generate_image") {
    if (readOptionalStringField(request, "prompt") !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, "argumentsJson");
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!("GenerateImage" in request)) {
      return undefined;
    }

    const candidate = request.GenerateImage;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }

  const prompt = readOptionalStringField(value, "prompt");
  if (prompt === undefined) {
    return undefined;
  }

  return {
    prompt,
    size: readOptionalStringField(value, "size") ?? DEFAULT_IMAGE_GENERATION_SIZE,
  };
}

function extractGenerateVideoRequest<ToolRequest>(
  request: ToolRequest,
): VideoGenerationRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: Record<string, JsonValue>;
  if (readOptionalStringField(request, "name") === "generate_video") {
    if (readOptionalStringField(request, "prompt") !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, "argumentsJson");
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!("GenerateVideo" in request)) {
      return undefined;
    }

    const candidate = request.GenerateVideo;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }

  const prompt = readOptionalStringField(value, "prompt");
  if (prompt === undefined) {
    return undefined;
  }

  const durationField = value.duration;
  const duration =
    typeof durationField === "number" && Number.isFinite(durationField) ? durationField : undefined;

  const aspectRatio = readOptionalStringField(value, "aspect_ratio");
  const resolution = readOptionalStringField(value, "resolution");

  return {
    prompt,
    duration: duration ?? DEFAULT_VIDEO_GENERATION_DURATION,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function extractFinishTaskSummary<ToolRequest>(request: ToolRequest): string | undefined {
  if (!isJsonObject(request) || readOptionalStringField(request, "name") !== "finish_task") {
    return undefined;
  }

  return readOptionalStringField(request, "summary") ?? "";
}

function extractSubagentRequest<ToolRequest>(request: ToolRequest): SubagentRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: JsonValue;
  if (readOptionalStringField(request, "name") === "subagent") {
    if (readOptionalStringField(request, "task") !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, "argumentsJson");
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!("Subagent" in request)) {
      return undefined;
    }

    const candidate = request.Subagent;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }
  const task = readOptionalStringField(value, "task");
  if (task === undefined) {
    return undefined;
  }

  const successCriteria = readOptionalStringField(value, "success_criteria", "successCriteria");
  const contextSummary = readOptionalStringField(value, "context_summary", "contextSummary");
  const filesToInspect = readOptionalStringArrayField(value, "files_to_inspect", "filesToInspect");
  const expectedOutput = readOptionalStringField(value, "expected_output", "expectedOutput");
  const subagentType = readOptionalStringField(value, "subagent_type", "subagentType");
  const worktree = value.worktree === true ? true : undefined;

  return {
    task,
    ...(subagentType !== undefined ? { subagentType } : {}),
    ...(successCriteria !== undefined ? { successCriteria } : {}),
    ...(contextSummary !== undefined ? { contextSummary } : {}),
    ...(filesToInspect !== undefined ? { filesToInspect } : {}),
    ...(expectedOutput !== undefined ? { expectedOutput } : {}),
    ...(worktree !== undefined ? { worktree } : {}),
  };
}

function buildSubagentUserTurn(request: SubagentRequest): string {
  const sections = [request.task.trim()];
  if (request.contextSummary?.trim()) {
    sections.push(`Context summary:\n${request.contextSummary.trim()}`);
  }
  if (request.successCriteria?.trim()) {
    sections.push(`Success criteria:\n${request.successCriteria.trim()}`);
  }
  if (request.filesToInspect && request.filesToInspect.length > 0) {
    sections.push(`Suggested files to inspect:\n- ${request.filesToInspect.join("\n- ")}`);
  }
  if (request.expectedOutput?.trim()) {
    sections.push(`Expected output:\n${request.expectedOutput.trim()}`);
  }
  sections.push(
    "You are already inside the delegated child session. Execute the delegated task directly.",
  );
  sections.push(
    "Do not discuss whether subagent sessions, delegation, or system permissions are available. Do not add policy or configuration commentary.",
  );
  sections.push("Return only the requested result.");
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

function buildParentSubagentToolResultTextFromRequest<ToolRequest>(
  request: ToolRequest,
  outputText: string,
  failed: boolean,
  sessionId?: string,
  sessionTranscript?: string,
): string {
  const subagent = extractSubagentRequest(request);
  const title = truncateTextForSubagentSummary(subagent?.task?.trim() ?? "", 72) || "SubAgent";
  return buildParentSubagentToolResultText(title, outputText, failed, sessionId, sessionTranscript);
}

function resolveSubagentResultText(
  outputText: string,
  record: RuntimeSubagentSessionArchiveEntry,
  failed: boolean,
): string {
  const normalizedOutput = outputText.trim();
  if (normalizedOutput.length > 0) {
    return normalizedOutput;
  }

  if (failed) {
    return record.summary.error?.trim() || record.summary.latestMessage?.trim() || normalizedOutput;
  }

  return (
    record.summary.finalOutput?.trim() ||
    latestAssistantMessage(record.llmHistory)?.trim() ||
    record.summary.latestMessage?.trim() ||
    normalizedOutput
  );
}

function singleLineStatusText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSubagentStatusProgress(
  text: string | undefined,
  title: string,
): string | undefined {
  const normalized = singleLineStatusText(text ?? "");
  if (
    !normalized ||
    normalized === title ||
    normalized === "Thinking…" ||
    normalized === "Compacting…"
  ) {
    return undefined;
  }

  return normalized;
}

function createSubagentToolExecutor<ToolRequest>(
  base: AgentRuntimeOptions<unknown, unknown, ToolRequest>["toolExecutor"],
  subagentSessionId: string,
  subagentTitle: string,
): AgentRuntimeOptions<unknown, unknown, ToolRequest>["toolExecutor"] {
  return {
    toolDefinitionsJson: () => filterSubagentToolDefinitions(base.toolDefinitionsJson()),
    parseCommand: (message) => base.parseCommand(message),
    requestFromFunctionCall: (name, argumentsJson) =>
      base.requestFromFunctionCall(name, argumentsJson),
    authorize: (request) => base.authorize(request),
    rememberApproval: (target, scope) => base.rememberApproval(target, scope),
    execute: (request) => base.execute(request),
    startMcpBackgroundRefresh: () => base.startMcpBackgroundRefresh(),
    mcpStatusSnapshot: () => base.mcpStatusSnapshot(),
    addMcpServer: (name, config) => base.addMcpServer(name, config),
    listMcpServers: () => base.listMcpServers(),
    inspectMcpServer: (name) => base.inspectMcpServer(name),
    listMcpTools: (name) => base.listMcpTools(name),
    listMcpResources: (name) => base.listMcpResources(name),
    readMcpResource: (name, uri) => base.readMcpResource(name, uri),
    listCachedMcpPrompts: (name) => base.listCachedMcpPrompts(name),
    listMcpPrompts: (name) => base.listMcpPrompts(name),
    getMcpPrompt: (name, prompt, argsJson) => base.getMcpPrompt(name, prompt, argsJson),
    ...(base.attachRequestMetadata
      ? {
          attachRequestMetadata: (request: ToolRequest, metadata: ToolRequestExecutionMetadata) =>
            base.attachRequestMetadata!(request, {
              ...metadata,
              subagentSessionId,
              subagentTitle,
            }),
        }
      : {}),
    ...(base.shouldExecuteInBackground
      ? {
          shouldExecuteInBackground: (request: ToolRequest) =>
            base.shouldExecuteInBackground!(request),
        }
      : {}),
    ...(base.backgroundStatusText
      ? {
          backgroundStatusText: (request: ToolRequest) => base.backgroundStatusText!(request),
        }
      : {}),
  };
}

function filterSubagentToolDefinitions(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.filter((entry) => {
    if (!isJsonObject(entry)) {
      return true;
    }

    const fn = entry.function;
    return !isJsonObject(fn) || fn.name !== "subagent";
  });
}

function latestAssistantMessage(history: LlmMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const text = message ? llmMessageTextContent(message.content).trim() : "";
    if (message?.role === "assistant" && text.length > 0) {
      return truncateTextForSubagentSummary(text, 180);
    }
  }

  return undefined;
}

function truncateTextForSubagentSummary(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join("")}...`;
}

function readOptionalStringField(
  value: Record<string, JsonValue>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function readOptionalStringArrayField(
  value: Record<string, JsonValue>,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  }

  return undefined;
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeRuntimeLlmMessageForArchive(message: LlmMessage): StoredLlmMessageArchiveEntry {
  return {
    role: message.role,
    content: cloneLlmMessageContent(message.content),
    ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolCalls !== undefined
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            argumentsJson: toolCall.argumentsJson,
          })),
        }
      : {}),
    ...(message.providerState !== undefined
      ? { providerState: cloneLlmProviderState(message.providerState) }
      : {}),
  };
}
