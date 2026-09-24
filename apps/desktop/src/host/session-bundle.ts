import type {
  ChatArchive,
  LlmActiveSkill,
  RuntimeEvent,
  SpiritLlmTransport,
} from "@spiritagent/agent-core";
import type { DesktopToolRequest, SessionTitleSource } from "./contracts.js";
import type { ApprovalLevel, WorkLocationKind } from "@spiritagent/host-internal";

import type { ModelRef } from "../types.js";

import type { DesktopHostRuntime } from "./runtime.js";
import type { DesktopToolExecutor } from "./tool-executor.js";

import type {
  ActiveSessionSnapshot,
  ConversationContextUsageSnapshot,
  ConversationMessageSnapshot,
  FileRewindWarning,
} from "../types.js";
import type { QueuedUserTurn } from "./message-queue.js";
import type { PendingWorktreeBootstrap } from "./worktree-bootstrap-card.js";
import type { DesktopTimelineSegmentKind, DesktopMessageTimeline } from "./message-timeline.js";
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from "./rewind.js";
import { createTodoSessionScopeKey } from "./todos.js";
import { ensureDesktopTranscriptSessionDirForChatPath } from "./transcript-session.js";
import { rehydrateFinishTaskNoticesForRestoredSession } from "./finish-task-notice-rehydrate.js";
import { nextMessageIdFromMessages, type RestoredSessionState } from "./sessions.js";
import type { SubagentConversationProjection } from "./subagent-conversation-projection.js";
import { DesktopMessageTimeline as TimelineCtor } from "./message-timeline.js";

export interface SessionBundle {
  /** Stable id: `activeSession.filePath` or synthetic until first persist. */
  id: string;
  workspaceRoot: string;
  /** Per-pane workspace binding; foreground syncs to global config on activation. */
  workspaceBinding?: import("../types.js").DesktopWorkspaceBinding;
  /** Git snapshot for background panes whose workspace differs from host state. */
  scopedGit?: import("../types.js").DesktopGitSnapshot;
  activeSession?: ActiveSessionSnapshot;
  messages: ConversationMessageSnapshot[];
  messageTimeline: DesktopMessageTimeline;
  archiveHistory: ChatArchive["llmHistory"];
  archiveSubagentSessions: NonNullable<ChatArchive["subagentSessions"]>;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  activeModel?: ModelRef;
  pendingGitBranch?: string;
  workLocation: WorkLocationKind;
  rewind: StoredDesktopRewindMetadata;
  rewindWarnings: FileRewindWarning[];
  messageIdCounter: number;
  currentTurnSkills: LlmActiveSkill[];
  pendingUnboundFileChangeIds: string[];
  nextTimelineAssistantSegmentKind: DesktopTimelineSegmentKind;
  deferredRuntimeRefreshWhileBusy: boolean;
  deferredRuntimeHostEvents: RuntimeEvent<DesktopToolRequest>[];
  /** Provider builtin preview callIds applied in a prior drain (for deferring terminal previews). */
  responsesBuiltInPreviewSeenCallIds: Set<string>;
  lastPersistedAtUnixMs?: number;
  /** `savedAtUnixMs` from disk; used to avoid bumping list order on background/switch persist. */
  listSortSavedAtUnixMs?: number;
  runtime?: DesktopHostRuntime;
  /** Fingerprint of host config used when `runtime` was last built for this bundle. */
  runtimeActivationSignature?: string;
  runtimeTransport?: SpiritLlmTransport;
  toolExecutor?: DesktopToolExecutor;
  toolExecutorWorkspaceRoot?: string;
  toolExecutorTodoSessionKey?: string;
  /** Isolated TODO storage key until the session is saved to a real chat file. */
  todoSessionScopeKey?: string;
  cachedTodoSnapshot?: import("../types.js").ConversationTodoSnapshot;
  /** Bumped on rewind restore; exposed as `conversation.revision` in snapshots. */
  conversationRevision: number;
  /** Projection cache for refreshArchiveFromRuntime: skip recomputation while the timeline instance + revision are unchanged. */
  archiveProjectionCache?: {
    timeline: DesktopMessageTimeline;
    revision: number;
    archiveMessages: ChatArchive["messages"];
    archiveAssistantAux: ChatArchive["assistantAux"];
  };
  /** Persistence throttling for busy ticks: last tick persistence time (in-memory only, not persisted). */
  lastTickPersistAtMs?: number;
  /** Last successful create_plan absolute path for this session. */
  activePlanPath?: string;
  /** Tracks whether the sidebar title is seed-truncated or LLM-generated. */
  sessionTitleSource?: SessionTitleSource;
  /** Unix ms when the session was pinned; drives sidebar Pinned grouping. Absent when unpinned. */
  pinnedAtUnixMs?: number;
  contextUsage?: ConversationContextUsageSnapshot;
  /** Composer direct image/video generation running in the background; drives snapshot.isBusy together with runtime.isBusy. */
  directMediaTurnInFlight?: boolean;
  /** First Worktree message: gates the LLM turn until the background bootstrap completes. Not persisted. */
  pendingWorktreeBootstrap?: PendingWorktreeBootstrap;
  /** Per-session user message queue (projected in snapshot until sent). */
  queuedUserTurns: QueuedUserTurn[];
  /** Desktop projection of SubAgent sub-sessions (isomorphic to the main timeline, including Thought/Compaction/tool cards). */
  subagentDesktopMessagesBySessionId: Map<string, ConversationMessageSnapshot[]>;
  subagentConversationProjections: Map<string, SubagentConversationProjection>;
  /**
   * Optional `<basic_info>` host override for daemon session.create.
   * Set when the Desktop Web client provides clientHost; Electron leaves undefined (server defaults to Desktop).
   */
  basicInfoHost?: { kind: "Web"; url: string };
}

export function createEmptySessionBundle(workspaceRoot: string, id = "__draft__"): SessionBundle {
  const messages: ConversationMessageSnapshot[] = [];
  const rewind = createDesktopRewindMetadata();
  return {
    id,
    workspaceRoot,
    messages,
    messageTimeline: TimelineCtor.fromMessages(messages, {
      allocateMessageId: () => 1,
      reserveMessageId: () => {},
    }),
    archiveHistory: [],
    archiveSubagentSessions: [],
    loopEnabled: false,
    approvalLevel: "default",
    workLocation: "local",
    rewind,
    rewindWarnings: [],
    messageIdCounter: 1,
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: "initial",
    deferredRuntimeRefreshWhileBusy: false,
    deferredRuntimeHostEvents: [],
    responsesBuiltInPreviewSeenCallIds: new Set(),
    queuedUserTurns: [],
    todoSessionScopeKey: createTodoSessionScopeKey(),
    conversationRevision: 0,
    subagentDesktopMessagesBySessionId: new Map(),
    subagentConversationProjections: new Map(),
  };
}

export function sessionBundleFromRestored(
  workspaceRoot: string,
  restored: RestoredSessionState,
  createTimeline: (
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: import("./message-timeline.js").DesktopTimelineTurnSnapshot[],
  ) => DesktopMessageTimeline,
): SessionBundle {
  const id = restored.activeSession.filePath;
  const messageTimeline = createTimeline(restored.messages, restored.desktopMessageTimeline);
  const messages = rehydrateFinishTaskNoticesForRestoredSession({
    messages: restored.messages,
    messageTimeline,
    archiveHistory: restored.archiveHistory,
  });
  void ensureDesktopTranscriptSessionDirForChatPath(id);
  return {
    id,
    workspaceRoot,
    activeSession: restored.activeSession,
    messages,
    messageTimeline,
    archiveHistory: restored.archiveHistory,
    archiveSubagentSessions: restored.archiveSubagentSessions,
    loopEnabled: restored.loopEnabled,
    approvalLevel: restored.approvalLevel,
    ...(restored.activeModel ? { activeModel: restored.activeModel } : {}),
    workLocation: "local",
    rewind: restored.rewind,
    rewindWarnings: [],
    messageIdCounter: nextMessageIdFromMessages(restored.messages),
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: "initial",
    deferredRuntimeRefreshWhileBusy: false,
    deferredRuntimeHostEvents: [],
    responsesBuiltInPreviewSeenCallIds: new Set(),
    queuedUserTurns: restored.queuedUserTurns ? [...restored.queuedUserTurns] : [],
    conversationRevision: 0,
    ...(restored.activePlanPath ? { activePlanPath: restored.activePlanPath } : {}),
    ...(restored.sessionTitleSource ? { sessionTitleSource: restored.sessionTitleSource } : {}),
    ...(restored.pinnedAtUnixMs ? { pinnedAtUnixMs: restored.pinnedAtUnixMs } : {}),
    ...(restored.contextUsage ? { contextUsage: { ...restored.contextUsage } } : {}),
    subagentDesktopMessagesBySessionId: restored.subagentDesktopMessagesBySessionId
      ? new Map(
          [...restored.subagentDesktopMessagesBySessionId.entries()].map(
            ([sessionId, messages]) => [sessionId, messages.map((message) => ({ ...message }))],
          ),
        )
      : new Map(),
    subagentConversationProjections: new Map(),
  };
}

export function resetSessionBundleInPlace(bundle: SessionBundle): void {
  bundle.activeSession = undefined;
  bundle.messages = [];
  bundle.messageTimeline = TimelineCtor.fromMessages([], {
    allocateMessageId: () => 1,
    reserveMessageId: () => {},
  });
  bundle.archiveHistory = [];
  bundle.archiveSubagentSessions = [];
  bundle.loopEnabled = false;
  bundle.approvalLevel = "default";
  bundle.activeModel = undefined;
  bundle.pendingGitBranch = undefined;
  bundle.workLocation = "local";
  bundle.rewind = createDesktopRewindMetadata();
  bundle.rewindWarnings = [];
  bundle.messageIdCounter = 1;
  bundle.currentTurnSkills = [];
  bundle.pendingUnboundFileChangeIds = [];
  bundle.nextTimelineAssistantSegmentKind = "initial";
  bundle.deferredRuntimeRefreshWhileBusy = false;
  bundle.deferredRuntimeHostEvents = [];
  bundle.responsesBuiltInPreviewSeenCallIds = new Set();
  bundle.cachedTodoSnapshot = undefined;
  bundle.todoSessionScopeKey = createTodoSessionScopeKey();
  bundle.conversationRevision = 0;
  bundle.activePlanPath = undefined;
  bundle.sessionTitleSource = undefined;
  bundle.pinnedAtUnixMs = undefined;
  bundle.contextUsage = undefined;
  bundle.directMediaTurnInFlight = false;
  bundle.pendingWorktreeBootstrap = undefined;
  bundle.queuedUserTurns = [];
  bundle.subagentDesktopMessagesBySessionId = new Map();
  bundle.subagentConversationProjections = new Map();
}
