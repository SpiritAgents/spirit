import type { SessionTranscript } from "../transcript.js";
import type {
  AskQuestionsRequest,
  ImageGenerationRequest,
  JsonObject,
  JsonValue,
  LlmMessage,
  LlmMessageContent,
  LlmTokenUsage,
  LlmStreamEvent,
  LlmTransport,
  PermissionMemoryTarget,
  SubagentSessionArchiveEntry,
  SubagentSessionStatus,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  ToolExecutionOutput,
  ToolExecutor,
} from "../ports.js";
import type { HookRunner, HookSessionContext } from "../hooks/types.js";
import type { AutoReviewCache } from "./auto-approval-integration.js";

export interface RuntimeToolArtifact {
  kind: "image" | "video";
  path: string;
  mimeType?: string;
}

export interface RuntimeToolExecution<ToolRequest> {
  toolCallId: string;
  toolName: string;
  request: ToolRequest;
  output: string;
  failed: boolean;
  artifacts?: RuntimeToolArtifact[];
  hostUi?: import("../ports.js").ToolExecutionHostUi;
}

import type { PreToolUseGateResult } from "../hooks/tool-hooks.js";

/** Where the host should anchor a finalized thinking segment in the timeline. */
export type AssistantThinkingSegmentPlacement = "before-next-tool" | "after-stream";

export type PendingEarlyToolExecutionOutcome<ToolRequest> =
  | {
      kind: "completed";
      request: ToolRequest;
      execution: RuntimeToolExecution<ToolRequest>;
      output: ToolExecutionOutput;
      enqueueDeferredGuidance: boolean;
      postHookToolInput?: JsonObject;
      fatalError?: string;
    }
  | {
      /** Early allow scheduled background execution; formal must not schedule again. */
      kind: "background-scheduled";
      request: ToolRequest;
      postHookToolInput?: JsonObject;
      preGate?: PreToolUseGateResult<ToolRequest>;
    }
  | {
      /** User denied/guided during early-stream approval; formal commits the failure. */
      kind: "rejected";
      request: ToolRequest;
      resultText: string;
      preGate?: PreToolUseGateResult<ToolRequest>;
    }
  | {
      kind: "deferred";
      reason:
        | "schema-error"
        | "authorization-error"
        | "background-required"
        | "approval-required"
        | "questions-required"
        | "internal-deferred";
      preGate?: PreToolUseGateResult<ToolRequest>;
    };

export interface PendingEarlyToolExecution<ToolRequest> {
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  canonicalArgumentsJson: string;
  outcome: Promise<PendingEarlyToolExecutionOutcome<ToolRequest>>;
}

/** Single-slot early approval: head shows as pendingApproval; rest wait here. */
export interface EarlyStreamApprovalQueueItem<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  prompt: string;
  rememberTarget?: PermissionMemoryTarget;
  autoReviewBlockReason?: string;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  canonicalArgumentsJson: string;
  turn: RuntimeTurnContext<ToolRequest>;
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  resolveDecision: (decision: RuntimeApprovalDecision) => void;
}

export type PendingApprovalSource = "early-stream" | "formal";

export interface RuntimeCompactionRecord {
  droppedMessages: number;
  beforeLength: number;
  afterLength: number;
  summary?: string;
  transcriptDirPath?: string;
}

export interface DeferredUserGuidance {
  userMessage: string;
  contentForLlm: string;
  historyContent?: LlmMessageContent;
}

export interface RuntimeStatePreparationResult<State> {
  state: State;
  changed: boolean;
}

export interface RuntimeHistoryPreparationResult {
  history: LlmMessage[];
  changed: boolean;
}

export type RuntimeEvent<ToolRequest> =
  | {
      kind: "begin-assistant-response";
    }
  | {
      kind: "update-pending-assistant-thinking";
      text: string;
    }
  | {
      /** Emitted before clearing `thinkingTextStore`; the host may persist it as a standalone UI message. */
      kind: "assistant-thinking-segment-finalized";
      text: string;
      /**
       * `before-next-tool`: finalize before the next tool card (between tools in the same segment).
       * `after-stream`: trailing thinking before the stream ends, placed after all tools.
       */
      placement?: AssistantThinkingSegmentPlacement;
    }
  | {
      kind: "update-pending-assistant-compaction";
      text: string;
    }
  | {
      kind: "assistant-chunk";
      text: string;
    }
  | {
      kind: "replace-pending-assistant";
      text: string;
    }
  | {
      kind: "assistant-response-completed";
    }
  | {
      kind: "remove-pending-assistant";
    }
  | {
      kind: "history-compacted";
      droppedMessages: number;
      summaryPreview?: string;
    }
  | {
      kind: "session-transcript-sync-failed";
      error: string;
    }
  | {
      kind: "approval-requested";
      approval: RuntimePendingApproval<ToolRequest>;
    }
  | {
      kind: "questions-requested";
      questions: RuntimePendingQuestions<ToolRequest>;
    }
  | {
      kind: "tool-call-started";
      toolCallId: string;
      toolName: string;
      request: ToolRequest;
    }
  | {
      kind: "approval-resolved";
      toolCallId: string;
      toolName: string;
      request: ToolRequest;
      decisionKind: RuntimeApprovalDecision["kind"];
    }
  | {
      kind: "background-tool-status";
      phase: "started" | "finished";
      toolName: string;
      request: ToolRequest;
      statusText?: string;
      failed?: boolean;
    }
  | {
      kind: "streaming-tool-preview";
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
    }
  | {
      kind: "tool-execution-finished";
      execution: RuntimeToolExecution<ToolRequest>;
    }
  | {
      kind: "tool-execution-output-chunk";
      toolCallId: string;
      toolName: string;
      request: ToolRequest;
      chunk: string;
    }
  | {
      kind: "context-usage-updated";
      usage: LlmTokenUsage;
    }
  | {
      kind: "turn-error-retry";
      attempt: number;
      maxAttempts: number;
      error: string;
    }
  | {
      kind: "turn-error-retry-cleared";
    };

export interface RuntimePendingApproval<ToolRequest> {
  prompt: string;
  request: ToolRequest;
  rememberTarget?: PermissionMemoryTarget;
  toolCallId?: string;
  toolName: string;
  subagentSessionId?: string;
  subagentTitle?: string;
  autoReviewBlockReason?: string;
}

export interface RuntimeSubagentSessionSummary {
  sessionId: string;
  parentToolCallId: string;
  title: string;
  status: SubagentSessionStatus;
  startedAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
  latestMessage?: string;
  finalOutput?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface RuntimeSubagentSessionArchiveEntry extends SubagentSessionArchiveEntry {
  summary: RuntimeSubagentSessionSummary;
  llmHistory: LlmMessage[];
}

export interface RuntimePendingQuestions<ToolRequest> {
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  questions: AskQuestionsRequest;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface PendingWorkspaceTextFile {
  kind: "text";
  path: string;
  totalChars: number;
  truncated: boolean;
  attachedAtUnixMs: number;
  content: string;
}

export interface PendingWorkspaceImageFile {
  kind: "image";
  path: string;
  attachedAtUnixMs: number;
}

export interface PendingWorkspaceVideoFile {
  kind: "video";
  path: string;
  attachedAtUnixMs: number;
}

export type PendingWorkspaceFile =
  | PendingWorkspaceTextFile
  | PendingWorkspaceImageFile
  | PendingWorkspaceVideoFile;

export type AssistantAuxKind = "thinking" | "compacting";

export interface PendingAssistantAux {
  kind: AssistantAuxKind;
  /** Subagent/runtime status. Empty for generic thinking/compacting; hosts draw chrome. */
  statusText: string;
  detailText?: string;
}

export type RuntimeApprovalDecision =
  | { kind: "allow"; remember?: "session" | "config" }
  | { kind: "deny"; resultText?: string }
  | { kind: "guidance"; userMessage: string; resultText?: string };

export type RuntimeTurnResult<State, ToolRequest> =
  | {
      kind: "completed";
      assistantText: string;
      state: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: "requires-approval";
      approval: RuntimePendingApproval<ToolRequest>;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: "requires-questions";
      questions: RuntimePendingQuestions<ToolRequest>;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: "failed";
      error: string;
      state?: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    };

export interface RuntimeCompletedManualToolCommandResult<ToolRequest> {
  kind: "completed";
  request: ToolRequest;
  toolName: string;
  output: string;
  failed: boolean;
  backgroundExecution: boolean;
}

export type RuntimeManualToolCommandResult<State, ToolRequest> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
  | {
      kind: "requires-approval";
      approval: RuntimePendingApproval<ToolRequest>;
    }
  | {
      kind: "denied";
      request: ToolRequest;
      toolName: string;
      message: string;
    }
  | {
      kind: "submitted-user-turn";
      userMessage: string;
      result: RuntimeTurnResult<State, ToolRequest>;
    }
  | {
      kind: "failed";
      error: string;
      request?: ToolRequest;
    };

export type RuntimeManualToolCommandStartResult<_State, ToolRequest> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
  | {
      kind: "started-background";
      request: ToolRequest;
      toolName: string;
      statusText?: string;
    }
  | {
      kind: "started-user-turn";
      userMessage: string;
    }
  | {
      kind: "requires-approval";
      approval: RuntimePendingApproval<ToolRequest>;
    }
  | {
      kind: "denied";
      request: ToolRequest;
      toolName: string;
      message: string;
    }
  | {
      kind: "failed";
      error: string;
      request?: ToolRequest;
    };

export type RuntimeManualHistoryCompactionResult =
  | {
      kind: "completed";
      result: RuntimeCompactionRecord;
    }
  | {
      kind: "failed";
      error: string;
    };

export interface AgentRuntimeOptions<Config, State, ToolRequest> {
  config: Config;
  llmTransport: LlmTransport<Config, State>;
  toolExecutor: ToolExecutor<ToolRequest>;
  createToolAgentState: (history: LlmMessage[], userInput: string) => State;
  createContinuationState?: (history: LlmMessage[]) => State;
  appendToolResultMessage: (state: State, toolCallId: string, content: string) => State;
  assistantToolCallMessageFromState?: (
    state: State,
    calls: ToolCallRequest[],
  ) => LlmMessage | undefined;
  finalAssistantHistoryMessageFromState?: (state: State, assistantText: string) => LlmMessage;
  appendUserMessage?: (state: State, content: string) => State;
  appendUserLlmMessage?: (state: State, message: LlmMessage) => State;
  extractAssistantText: (state: State) => string | undefined;
  generateImage?: (request: ImageGenerationRequest) => Promise<ToolExecutionOutput>;
  generateVideo?: (
    request: import("../ports.js").VideoGenerationRequest,
  ) => Promise<ToolExecutionOutput>;
  truncateStateForContextRetry?: (state: State) => RuntimeStatePreparationResult<State>;
  truncateHistoryForCompaction?: (history: LlmMessage[]) => RuntimeHistoryPreparationResult;
  rebuildRetryStateAfterCompaction?: (
    history: LlmMessage[],
    pendingUserInput: string,
    retryState: State,
  ) => State;
  maxAutoCompactRetries?: number;
  onEvent?: (event: RuntimeEvent<ToolRequest>) => void;
  /** Host hook to apply queued runtime events before long-running managed provider work (e.g. web_search). */
  flushPendingHostEvents?: () => void | Promise<void>;
  hookRunner?: HookRunner;
  hookSessionContext?: HookSessionContext;
  syncSessionTranscript?: (input: {
    transcript: SessionTranscript;
    sessionKey?: string;
  }) => Promise<string | undefined>;
  syncSubagentTranscript?: (input: {
    transcript: SessionTranscript;
    sessionKey?: string;
    subagentSessionId: string;
  }) => Promise<void>;
  /** Absolute path for a subagent transcript file (for tool-result metadata). */
  resolveSubagentTranscriptPath?: (input: {
    sessionKey?: string;
    subagentSessionId: string;
  }) => string | undefined;
  persistToolOutputArchive?: (input: {
    sessionId?: string;
    toolCallId?: string;
    content: string;
    messageIndex?: number;
  }) => Promise<string | undefined>;
  resolveWorkspaceFilesFromInput?: (
    userInput: string,
  ) => Promise<PendingWorkspaceFile[]> | PendingWorkspaceFile[];
  /** Host-provided resolver used when scoping child subagent runtimes to a different workspace root. */
  resolveWorkspaceFilesForRoot?: (
    workspaceRoot: string,
    userInput: string,
  ) => Promise<PendingWorkspaceFile[]> | PendingWorkspaceFile[];
  bootstrapSubagentWorkspace?: SubagentWorkspaceBootstrap<ToolRequest>;
  getApprovalLevel?: () => import("../auto-approval/types.js").SessionApprovalLevel;
  reviewToolApproval?: import("../auto-approval/types.js").ToolAutoReviewer;
}

export interface SubagentWorkspaceBootstrapInput {
  subagentSessionId: string;
  task: string;
  worktree: boolean;
  parentWorkspaceRoot: string;
}

export type SubagentWorkspaceBootstrapResult<ToolRequest = unknown> =
  | {
      workspaceRoot: string;
      worktreePath?: string;
      branchName?: string;
      toolExecutor?: ToolExecutor<ToolRequest>;
    }
  | { error: string };

export type SubagentWorkspaceBootstrap<ToolRequest = unknown> = (
  input: SubagentWorkspaceBootstrapInput,
) => Promise<SubagentWorkspaceBootstrapResult<ToolRequest>>;

export interface RuntimeTurnContext<ToolRequest> {
  requestTrace: JsonValue[];
  toolExecutions: RuntimeToolExecution<ToolRequest>[];
  compactions: RuntimeCompactionRecord[];
  autoCompactAttempts: number;
  deferredUserGuidances: DeferredUserGuidance[];
  /** Shared across recursive remaining-call batches within one turn. */
  autoReviewCache: AutoReviewCache;
}

export interface PendingApprovalState<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  prompt: string;
  rememberTarget?: PermissionMemoryTarget;
  autoReviewBlockReason?: string;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>;
  /** Defaults to formal when omitted (legacy / formal processToolCalls path). */
  source?: PendingApprovalSource;
  /** Set when source is early-stream; continuePendingApproval resolves the early waiter. */
  resolveEarlyDecision?: (decision: RuntimeApprovalDecision) => void;
}

export interface PendingQuestionsState<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  questions: AskQuestionsRequest;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>;
}

export interface PendingToolCallContinuation<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  calls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>;
}

export interface PendingManualApprovalState<ToolRequest> {
  request: ToolRequest;
  prompt: string;
  rememberTarget?: PermissionMemoryTarget;
  toolName: string;
  autoReviewBlockReason?: string;
}

export interface PendingStreamingRound<State, ToolRequest> {
  pendingUserInput: string;
  /** Round state at stream start; early approval / execute uses resolveTurnToolState when available. */
  streamState: State;
  turn: RuntimeTurnContext<ToolRequest>;
  rawEvents: LlmStreamEvent[];
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>;
  /** toolCallId → canonical argumentsJson used for streaming auto-review invalidate. */
  autoReviewArgFingerprints: Map<string, string>;
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  streamEnded: boolean;
  streamConsumerFinished: boolean;
  cancel: (() => void) | undefined;
}

export interface PendingToolAgentRound<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  turn: RuntimeTurnContext<ToolRequest>;
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  emptyAssistantRetries: number;
}

export interface PendingToolCallBackgroundToolExecution<State, ToolRequest> {
  kind: "tool-call";
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  startedAtUnixMs: number;
  postHookToolInput?: JsonObject;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>;
  statusText: string | undefined;
  output: ToolExecutionOutput | undefined;
  failed: boolean | undefined;
}

/** Held while the background slot is occupied; the state after prior tools complete is injected at actual start. */
export interface DeferredBackgroundToolExecutionSpec<_State, ToolRequest> {
  pendingUserInput: string;
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>;
  postHookToolInput?: JsonObject;
}

export interface PendingManualBackgroundToolExecution<ToolRequest> {
  kind: "manual";
  request: ToolRequest;
  toolName: string;
  statusText: string | undefined;
  output: ToolExecutionOutput | undefined;
  failed: boolean | undefined;
}

export type PendingBackgroundToolExecution<State, ToolRequest> =
  | PendingToolCallBackgroundToolExecution<State, ToolRequest>
  | PendingManualBackgroundToolExecution<ToolRequest>;

export interface PendingAutoHistoryCompaction<State, ToolRequest> {
  kind: "auto-retry";
  pendingUserInput: string;
  retryState: State;
  turn: RuntimeTurnContext<ToolRequest>;
  originalError: string;
  toolTruncationApplied: boolean;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

export interface PendingManualHistoryCompaction {
  kind: "manual";
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

export type PendingHistoryCompaction<State, ToolRequest> =
  | PendingAutoHistoryCompaction<State, ToolRequest>
  | PendingManualHistoryCompaction;
