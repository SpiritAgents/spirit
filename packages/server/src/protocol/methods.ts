/**
 * Spirit Server protocol surface (Phase 1: server lifecycle).
 *
 * Method names are camelCase JSON-RPC methods. Server→client streaming
 * arrives as notifications, never as RPC responses.
 */

export const PROTOCOL_VERSION = 1;

/** RPC: client handshake after WS connect. */
export const SERVER_INITIALIZE = "server.initialize";
/** RPC: liveness + build info. */
export const SERVER_HEALTH = "server.health";
/** Notification: first frame the server sends after a successful upgrade. */
export const SERVER_CONNECTED = "server.connected";

/** RPC: create a session (owns an AgentRuntime in the daemon). */
export const SESSION_CREATE = "session.create";
/** RPC: join an existing live session (refcount + snapshot). */
export const SESSION_ATTACH = "session.attach";
/** RPC: release a session attachment; destroys when refcount hits zero. */
export const SESSION_DETACH = "session.detach";
/** RPC: move a live session to a new conversation key (provisional → stable path). */
export const SESSION_MIGRATE_CONVERSATION_KEY = "session.migrateConversationKey";
/** RPC: list live sessions. */
export const SESSION_LIST = "session.list";
/** RPC: release this client's attachment (alias of detach); destroys at refcount zero. */
export const SESSION_CLOSE = "session.close";
/** RPC: submit a user turn; streaming arrives via `runtime.event`. */
export const SESSION_SUBMIT_USER_TURN = "session.submitUserTurn";
/** RPC: abort the current turn. */
export const SESSION_ABORT = "session.abort";
/** RPC: abort a running daemon shell by tool call id. */
export const SESSION_ABORT_SHELL = "session.abortShell";
/** RPC: set approval level (default | auto-approval | bypass-approval). */
export const SESSION_SET_APPROVAL_LEVEL = "session.setApprovalLevel";
/** RPC: answer a pending tool approval. */
export const SESSION_REPLY_PENDING_APPROVAL = "session.replyPendingApproval";
/** RPC: answer pending questions. */
export const SESSION_REPLY_PENDING_QUESTIONS = "session.replyPendingQuestions";
/** RPC: resolve a spirit/ui/open Dialog without yielding the turn. */
export const SESSION_RESOLVE_EXTENSION_UI = "session.resolveExtensionUi";
/** RPC: switch agent mode (agent | plan | ask | debug). */
export const SESSION_SET_MODE = "session.setMode";
/** RPC: toggle loop mode. */
export const SESSION_SET_LOOP_ENABLED = "session.setLoopEnabled";
/** RPC: clear history and abort any work in flight. */
export const SESSION_RESET = "session.reset";
/** RPC: set a display title (live sessions only). */
export const SESSION_RENAME = "session.rename";
/** RPC: continue assistant completion from history tail. */
export const SESSION_CONTINUE_COMPLETION = "session.continueAssistantCompletion";
/** RPC: run manual history compaction. */
export const SESSION_COMPACT_HISTORY = "session.compactHistory";
/** RPC: pull the current session projection (watchdog / headless). */
export const SESSION_POLL = "session.poll";
/** RPC: answer a workspace capability trust prompt (first reply wins). */
export const SESSION_REPLY_TRUST = "session.replyWorkspaceCapabilityTrust";
/** RPC: restore a session from a chat archive. */
export const SESSION_REPLACE_FROM_ARCHIVE = "session.replaceFromArchive";
/** RPC: export the session as a chat archive. */
export const SESSION_EXPORT_ARCHIVE = "session.exportArchive";
/** RPC: push the authoritative desktop timeline snapshot for a session. */
export const SESSION_PUSH_DESKTOP_TIMELINE = "session.pushDesktopTimeline";
/** RPC: pull the current desktop timeline snapshot for a session. */
export const SESSION_GET_DESKTOP_TIMELINE = "session.getDesktopTimeline";
/** RPC: export api messages + request trace + system prompts. */
export const SESSION_EXPORT_STATE = "session.exportState";
/** RPC: activate a skill for the next turn (slash). */
export const SESSION_ACTIVATE_SKILL = "session.activateSkill";
/** RPC: queue an image for the next turn. */
export const SESSION_ADD_PENDING_IMAGE = "session.addPendingImage";
export const SESSION_CLEAR_PENDING_IMAGES = "session.clearPendingImages";
/** RPC: attach an MCP resource to the next turn. */
export const SESSION_ATTACH_MCP_RESOURCE = "session.attachMcpResource";
export const SESSION_CLEAR_PENDING_MCP_RESOURCES = "session.clearPendingMcpResources";
/** RPC: apply an MCP prompt as a turn. */
export const SESSION_APPLY_MCP_PROMPT = "session.applyMcpPrompt";
/** RPC: MCP management/read pass-through (`action` selects the operation). */
export const SESSION_MCP = "session.mcp";
/** RPC: manual tool command (`!command` / MCP tool run). */
export const SESSION_START_MANUAL_TOOL_COMMAND = "session.startManualToolCommand";
export const SESSION_CONTINUE_MANUAL_APPROVAL = "session.continuePendingManualToolApproval";
export const SESSION_TAKE_MANUAL_RESULT = "session.takeCompletedManualToolCommandResult";
/** RPC: subagent archive / aux state accessors. */
export const SESSION_SUBAGENT_ARCHIVE = "session.subagentSessionArchive";
export const SESSION_SUBAGENT_AUX = "session.subagentPendingAuxState";
/** RPC: re-resolve transport from config.json, preserving history. */
export const SESSION_REPLACE_CONFIG = "session.replaceConfig";
/** RPC: re-run rules/skills/plan discovery. */
export const SESSION_RELOAD_METADATA = "session.reloadHostMetadata";
/** RPC: run the sessionStart hook (startup | resume | open). */
export const SESSION_RUN_SESSION_START = "session.runSessionStart";
/** RPC: run the sessionEnd hook (abort | close | switch). */
export const SESSION_RUN_SESSION_END = "session.runSessionEnd";
/** RPC: attribution toggles for future turns. */
export const SESSION_SET_ATTRIBUTION = "session.setAttribution";
/** RPC: re-scope the todo store (CLI keys todos by its chat session id). */
export const SESSION_SET_TODO_SESSION_KEY = "session.setTodoSessionKey";

/** RPC: offline permission rule check for a shell command or read_file path. */
export const HOST_CHECK_PERMISSION = "host.checkPermission";

/** RPC: process-global LLM fetch knobs (match the legacy bridge semantics). */
export const SERVER_SET_LLM_HTTP_VERSION = "server.setLlmHttpVersion";
export const SERVER_SET_LLM_CLIENT_VERSION = "server.setLlmClientVersion";

/** Notification: one agent-core RuntimeEvent for a session. */
export const RUNTIME_EVENT = "runtime.event";
/** Notification: a submitted turn reached a terminal state. */
export const SESSION_TURN_FINISHED = "session.turnFinished";
/** Notification: a user turn started (clients create a shared timeline boundary). */
export const SESSION_USER_TURN_SUBMITTED = "session.userTurnSubmitted";
/** Notification: drained child-session runtime events and pending aux state. */
export const SESSION_SUBAGENT_EVENTS = "session.subagentEvents";
/** Notification: throttled session projection at interaction boundaries. */
export const SESSION_SNAPSHOT = "session.snapshot";
/** Notification: a client pushed a new desktop timeline snapshot for the session. */
export const SESSION_DESKTOP_TIMELINE_UPDATED = "session.desktopTimelineUpdated";
/** Notification: hooks ask for workspace capability trust. */
export const WORKSPACE_TRUST_REQUESTED = "workspace.trustRequested";
/** Notification: extension MCP asked to open an owned Desktop view. Not a RuntimeEvent. */
export const SESSION_EXTENSION_UI_REQUESTED = "session.extensionUiRequested";
/** Notification: a tool wrote/changed a file (rewind bookkeeping). */
export const SESSION_FILE_CHANGED = "session.fileChanged";
/** Notification: LLM-generated display title for the first user turn. */
export const SESSION_TITLE_UPDATED = "session.titleUpdated";

export type ClientKind = "cli" | "desktop" | "web";

export interface ServerInitializeParams {
  clientKind: ClientKind;
  /** Opaque client identifier (e.g. pid + random suffix), for diagnostics. */
  clientId?: string;
  /** Workspace the client intends to work in; used for registry matching. */
  workspaceRoot?: string;
}

export interface ServerInitializeResult {
  protocolVersion: number;
  instanceId: string;
  version: string;
  startedAt: string;
  dataDir: string;
}

export interface ServerHealthResult {
  ok: true;
  instanceId: string;
  pid: number;
  version: string;
  startedAt: string;
  uptimeMs: number;
  connections: number;
}

export interface ServerConnectedParams {
  protocolVersion: number;
  instanceId: string;
  version: string;
}

export type SessionApprovalLevel = "default" | "auto-approval" | "bypass-approval";

/** Host identity for `<basic_info>` (distinct from extension ClientKind mapping). */
export type SessionBasicInfoHostKind = "Desktop" | "CLI" | "Web";

export interface SessionBasicInfoHost {
  kind: SessionBasicInfoHostKind;
  /** Browser page URL when kind is Web. */
  url?: string;
}

export interface SessionCreateParams {
  workspaceRoot: string;
  /** Stable chat file path; re-create returns the existing live session. */
  conversationKey?: string;
  approvalLevel?: SessionApprovalLevel;
  modelRef?: { groupId: string; name: string };
  agentMode?: "agent" | "plan" | "ask" | "debug";
  todoSessionKey?: string;
  sessionKind?: "default" | "dream-collector";
  dreamScope?: { workspaceRoot: string; gitBranch: string };
  dreamSourceSession?: { path: string; displayName?: string; savedAtUnixMs?: number };
  /**
   * Optional host UI Markdown / rendering hints (e.g. Desktop Mermaid).
   * Plain English; appended to the tool-agent system message. CLI / ACP omit this.
   */
  hostUiPromptSection?: string;
  /**
   * Host-contributed, tool-targeted description hints (e.g. Desktop Mermaid
   * rendering on create_plan content). agent-core merges them into the matching
   * tool / parameter descriptions; CLI / ACP omit this.
   */
  hostToolDescriptionHints?: Array<{ toolName: string; parameterName?: string; text: string }>;
  /** Optional override for `<basic_info>` Current host (e.g. Desktop Web + page URL). */
  basicInfoHost?: SessionBasicInfoHost;
}

export interface SessionAttachParams {
  /** Join by live session id (mutually exclusive with conversationKey). */
  sessionId?: string;
  /** Join by registered chat path (mutually exclusive with sessionId). */
  conversationKey?: string;
}

export interface SessionAttachResult {
  session: SessionInfo;
  snapshot: unknown;
}

export interface SessionDetachResult {
  /** True when the last attachment was released and the session was destroyed. */
  closed: boolean;
}

export interface SessionMigrateConversationKeyParams {
  sessionId: string;
  conversationKey: string;
}

export interface SessionInfo {
  sessionId: string;
  workspaceRoot: string;
  hostKind: ClientKind;
  createdAt: string;
  isBusy: boolean;
  approvalLevel: SessionApprovalLevel;
  model: string;
  conversationKey?: string;
  attachmentCount: number;
}

export interface SessionSubmitUserTurnParams {
  sessionId: string;
  text: string;
  clientTurnId?: string;
  explicitImages?: string[];
  explicitWorkspaceFiles?: unknown[];
  activeSkills?: unknown[];
}

export interface RuntimeEventNotificationParams {
  sessionId: string;
  event: unknown;
}

export type TurnStopReason = "completed" | "failed" | "cancelled";

export interface SessionTurnFinishedParams {
  sessionId: string;
  stopReason: TurnStopReason;
  result?:
    | { kind: "completed"; assistantText: string; toolExecutions: unknown[] }
    | { kind: "failed"; error: string; toolExecutions: unknown[] };
}

export interface SessionUserTurnSubmittedParams {
  sessionId: string;
  text: string;
  clientTurnId?: string;
  explicitWorkspaceFiles?: unknown[];
}

export interface SessionPushDesktopTimelineParams {
  sessionId: string;
  /** Persisted desktop timeline turns (opaque to the daemon). */
  timeline: unknown[];
}

export interface SessionPushDesktopTimelineResult {
  ok: true;
  revision: number;
}

export interface SessionGetDesktopTimelineResult {
  revision: number;
  timeline: unknown[];
}

export interface SessionDesktopTimelineUpdatedParams {
  sessionId: string;
  revision: number;
}

export interface SessionTitleUpdatedParams {
  sessionId: string;
  title: string;
}
