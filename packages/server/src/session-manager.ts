import { randomUUID } from "node:crypto";

import type {
  HostToolDescriptionHint,
  JsonValue,
  LlmActiveSkill,
  PendingWorkspaceFile,
  RuntimeEvent,
  AgentMode,
} from "@spiritagent/agent-core";
import type { BridgeRuntimeSnapshot } from "@spiritagent/agent-core/host-bridge";
import {
  createHostTodoStore,
  deriveSessionTitleFallbackSeed,
  generateSessionTitleForTurn,
  type ApprovalLevel,
  type HostDreamScope,
  type HostDreamSourceSessionRef,
  type ModelRef,
} from "@spiritagent/host-internal";

import {
  createServerRuntime,
  type ServerClientKind,
  type ServerRuntimeResult,
  type ServerSessionKind,
} from "./runtime-factory.js";
import { McpRegistry, createExtensionMcpExtraConfigs } from "./mcp-registry.js";
import { buildServerSnapshot } from "./snapshot-projector.js";
import {
  mediaPathsFromLatestUserMessage,
  shouldScheduleSessionTitleGeneration,
} from "./session-title-generation.js";

export type TurnStopReason = "completed" | "failed" | "cancelled";

export type ServerTurnResult =
  | {
      kind: "completed";
      assistantText: string;
      toolExecutions: unknown[];
    }
  | {
      kind: "failed";
      error: string;
      toolExecutions: unknown[];
    };

export interface ServerSessionInfo {
  sessionId: string;
  workspaceRoot: string;
  hostKind: ServerClientKind;
  createdAt: string;
  title?: string;
  isBusy: boolean;
  approvalLevel: ApprovalLevel;
  model: string;
  queuedTurns: number;
  conversationKey?: string;
  attachmentCount: number;
}

interface QueuedUserTurn {
  text: string;
  clientTurnId?: string;
  explicitImages: string[];
  explicitWorkspaceFiles: PendingWorkspaceFile[];
  activeSkills: LlmActiveSkill[];
}

export interface WorkspaceCapabilityTrustRequestPayload {
  workspaceRoot: string;
  contentHash: string;
  hashChanged: boolean;
  hooks: Array<{ event: string; command: string; resolvedPath: string }>;
}

export type WorkspaceCapabilityTrustDecision = "allowOnce" | "deny" | "alwaysTrust";

interface PendingTrustRequest {
  sessionId: string;
  resolve: (decision: WorkspaceCapabilityTrustDecision) => void;
  timer: NodeJS.Timeout;
}

interface ServerSession {
  info: ServerSessionInfo;
  runtimeResult: ServerRuntimeResult;
  /** Incremented per turn; stale completions drop their broadcast. */
  turnGeneration: number;
  queue: QueuedUserTurn[];
  pump: NodeJS.Timeout;
  /** A turn/compaction is in flight (set by the initiator, cleared on finish). */
  turnActive: boolean;
  /** Ticks spent idle while turnActive — guards against result-less endings. */
  idleTicksWhileActive: number;
  polling: boolean;
  /** Skills activated out-of-turn (slash); consumed by the next turn. */
  pendingActiveSkills: LlmActiveSkill[];
  createParams: CreateSessionParams;
  /** Current todo store scope key. */
  todoSessionKey: string;
  /**
   * Latest desktop timeline snapshot pushed by a host client (opaque payload;
   * the daemon never derives it from llm_history). Revision is assigned here
   * and increments per accepted push.
   */
  desktopTimeline?:
    | {
        revision: number;
        timeline: unknown[];
        updatedAtUnixMs: number;
      }
    | undefined;
  /** Fingerprint of childSessions summaries; used to push archives when membership/status changes. */
  childSessionsFingerprint?: string;
}

export interface SessionManagerCallbacks {
  /** Broadcast a runtime event to every connected client. */
  broadcastRuntimeEvent: (sessionId: string, event: RuntimeEvent<JsonValue>) => void;
  broadcastSubagentEvents?: (
    sessionId: string,
    drains: Array<{
      sessionId: string;
      parentToolCallId: string;
      events: RuntimeEvent<JsonValue>[];
      pendingAux: unknown;
      archive?: unknown;
    }>,
  ) => void;
  /** Broadcast before the runtime starts so every client opens the same turn boundary. */
  broadcastUserTurnSubmitted?: (sessionId: string, turn: QueuedUserTurn) => void;
  /** Broadcast turn completion (terminal state of a submitUserTurn). */
  broadcastTurnFinished: (
    sessionId: string,
    stopReason: TurnStopReason,
    result?: ServerTurnResult,
  ) => void;
  /** Broadcast a fresh session projection (throttled by the caller). */
  broadcastSnapshot: (sessionId: string, snapshot: BridgeRuntimeSnapshot) => void;
  /** Route a workspace capability trust prompt to clients; first reply wins. */
  broadcastTrustRequest: (
    sessionId: string,
    requestId: string,
    request: WorkspaceCapabilityTrustRequestPayload,
  ) => void;
  /** Tool-written file change (clients keep rewind bookkeeping). */
  broadcastFileChange: (sessionId: string, change: unknown) => void;
  /** A host client pushed a new desktop timeline snapshot. */
  broadcastDesktopTimelineUpdated?: (sessionId: string, revision: number) => void;
  /** LLM session title for the first user turn. */
  broadcastTitleUpdated?: (sessionId: string, title: string) => void;
  log?: (message: string) => void;
}

export interface CreateSessionParams {
  workspaceRoot: string;
  hostKind: ServerClientKind;
  approvalLevel?: ApprovalLevel;
  modelRef?: ModelRef;
  agentMode?: AgentMode;
  /** Todo store scope override (defaults to the new session id). */
  todoSessionKey?: string;
  /** Stable chat file path for multi-host attach. */
  conversationKey?: string;
  sessionKind?: ServerSessionKind;
  dreamScope?: HostDreamScope;
  dreamSourceSession?: HostDreamSourceSessionRef;
  /** Host UI Markdown / rendering hints (Desktop Mermaid). CLI omits. */
  hostUiPromptSection?: string;
  /** Host-contributed tool description hints (Desktop Mermaid on create_plan). CLI omits. */
  hostToolDescriptionHints?: HostToolDescriptionHint[];
  /** Optional `<basic_info>` host override (e.g. Desktop Web + page URL). */
  basicInfoHost?: {
    kind: "Desktop" | "CLI" | "Web";
    url?: string;
  };
}

function resolveBasicInfoHost(params: CreateSessionParams): {
  kind: "Desktop" | "CLI" | "Web";
  url?: string;
} {
  if (params.basicInfoHost) {
    const url = params.basicInfoHost.url?.trim();
    return {
      kind: params.basicInfoHost.kind,
      ...(url ? { url } : {}),
    };
  }
  switch (params.hostKind) {
    case "desktop":
      return { kind: "Desktop" };
    case "web":
      return { kind: "Web" };
    case "cli":
    default:
      return { kind: "CLI" };
  }
}

export interface AttachSessionParams {
  sessionId?: string;
  conversationKey?: string;
}

export interface AttachSessionResult {
  session: ServerSessionInfo;
  snapshot: BridgeRuntimeSnapshot;
}

export interface SubmitUserTurnParams {
  text: string;
  clientTurnId?: string;
  explicitImages?: string[];
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  activeSkills?: LlmActiveSkill[];
}

export type SubmitUserTurnOutcome = { accepted: true } | { queued: true; position: number };

const TRUST_REQUEST_TIMEOUT_MS = 120_000;
const PUMP_INTERVAL_MS = 25;
/**
 * Idle ticks (×25ms) with an active turn but no pending work before the turn
 * is declared cancelled. Approval resolution flickers idle for one await
 * boundary — far below this grace window.
 */
const IDLE_GRACE_TICKS = 40;

/**
 * Owns live sessions. Each session has its own AgentRuntime and a 25ms pump
 * (the Desktop session-pump model): the pump drives `runtime.poll()` and
 * harvests terminal results, so turns survive transient idle windows inside
 * the turn machine (e.g. the await boundary in approval resolution).
 * Events reach clients in real time via `onEvent` push.
 *
 * Interaction routing: approvals / questions / workspace trust prompts are
 * broadcast to every connected client; the first reply wins. When the last
 * client disconnects, pending interactions are denied/skipped so runtimes
 * never park forever.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ServerSession>();
  private readonly conversationIndex = new Map<string, string>();
  /** sessionId → attached clientIds (refcount). */
  private readonly attachments = new Map<string, Set<string>>();
  private readonly pendingTrustRequests = new Map<string, PendingTrustRequest>();
  private readonly spiritDataDir: string;
  /** Shared per-workspace MCP services (also serve host.mcp* management RPCs). */
  readonly mcpRegistry: McpRegistry;
  /** conversationKey → in-flight create; collapses concurrent creates for the same chat. */
  private readonly creatingByConversationKey = new Map<string, Promise<ServerSessionInfo>>();

  constructor(
    spiritDataDir: string,
    private readonly callbacks: SessionManagerCallbacks,
  ) {
    this.spiritDataDir = spiritDataDir;
    this.mcpRegistry = new McpRegistry(
      createExtensionMcpExtraConfigs(spiritDataDir, ["cli", "desktop"]),
    );
  }

  async createSession(params: CreateSessionParams): Promise<ServerSessionInfo> {
    const conversationKey = params.conversationKey?.trim();
    if (conversationKey) {
      const existingId = this.conversationIndex.get(conversationKey);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing) {
          return this.projectInfo(existing);
        }
        this.conversationIndex.delete(conversationKey);
      }
      const inflight = this.creatingByConversationKey.get(conversationKey);
      if (inflight) {
        return inflight;
      }
      const promise = this.createSessionInner(params, conversationKey);
      this.creatingByConversationKey.set(conversationKey, promise);
      try {
        return await promise;
      } finally {
        this.creatingByConversationKey.delete(conversationKey);
      }
    }
    return this.createSessionInner(params);
  }

  private async createSessionInner(
    params: CreateSessionParams,
    conversationKey?: string,
  ): Promise<ServerSessionInfo> {
    const trimmedKey = conversationKey?.trim();
    if (trimmedKey) {
      const existingId = this.conversationIndex.get(trimmedKey);
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (existing) {
          return this.projectInfo(existing);
        }
        this.conversationIndex.delete(trimmedKey);
      }
    }

    const sessionId = `sess_${randomUUID().replaceAll("-", "")}`;
    // Transcript / basicInfo sessionKey: prefer conversationKey (chat path) so Desktop can
    // resolve transcript.json from listSessions without a sess_* mapping.
    const transcriptSessionKey = trimmedKey || sessionId;
    const runtimeResult = await createServerRuntime({
      workspaceRoot: params.workspaceRoot,
      spiritDataDir: this.spiritDataDir,
      sessionKey: transcriptSessionKey,
      ...(params.modelRef ? { modelRef: params.modelRef } : {}),
      ...(params.todoSessionKey?.trim() ? { todoSessionKey: params.todoSessionKey.trim() } : {}),
      ...(params.sessionKind === "dream-collector"
        ? {}
        : { mcpService: this.mcpRegistry.forWorkspace(params.workspaceRoot) }),
      hostKind: params.hostKind === "web" ? "cli" : params.hostKind,
      approvalLevel: params.approvalLevel ?? "default",
      ...(params.sessionKind ? { sessionKind: params.sessionKind } : {}),
      ...(params.dreamScope ? { dreamScope: params.dreamScope } : {}),
      ...(params.dreamSourceSession ? { dreamSourceSession: params.dreamSourceSession } : {}),
      ...(params.hostUiPromptSection ? { hostUiPromptSection: params.hostUiPromptSection } : {}),
      ...(params.hostToolDescriptionHints
        ? { hostToolDescriptionHints: params.hostToolDescriptionHints }
        : {}),
      basicInfoHost: resolveBasicInfoHost(params),
      onEvent: (event) => this.handleRuntimeEvent(sessionId, event),
      onFileChange: (change) => this.callbacks.broadcastFileChange(sessionId, change),
      requestWorkspaceCapabilityTrust: (request) =>
        this.requestWorkspaceCapabilityTrust(sessionId, request),
      ...(this.callbacks.log ? { log: this.callbacks.log } : {}),
    });
    await runtimeResult.setAgentMode(params.agentMode ?? "agent");

    const info: ServerSessionInfo = {
      sessionId,
      workspaceRoot: params.workspaceRoot,
      hostKind: params.hostKind,
      createdAt: new Date().toISOString(),
      isBusy: false,
      approvalLevel: params.approvalLevel ?? "default",
      model: runtimeResult.transportConfig.model,
      queuedTurns: 0,
      attachmentCount: 0,
      ...(trimmedKey ? { conversationKey: trimmedKey } : {}),
    };
    const session: ServerSession = {
      info,
      runtimeResult,
      turnGeneration: 0,
      queue: [],
      pump: undefined as unknown as NodeJS.Timeout,
      turnActive: false,
      idleTicksWhileActive: 0,
      polling: false,
      pendingActiveSkills: [],
      createParams: params,
      todoSessionKey: params.todoSessionKey?.trim() || sessionId,
    };
    session.pump = setInterval(() => this.tickSession(session), PUMP_INTERVAL_MS);
    session.pump.unref();
    this.sessions.set(sessionId, session);
    if (trimmedKey) {
      this.conversationIndex.set(trimmedKey, sessionId);
    }
    return { ...info };
  }

  attachSession(clientId: string, params: AttachSessionParams): AttachSessionResult {
    const sessionId = this.resolveSessionId(params);
    const session = this.requireSession(sessionId);
    let clients = this.attachments.get(sessionId);
    if (!clients) {
      clients = new Set();
      this.attachments.set(sessionId, clients);
    }
    clients.add(clientId);
    return {
      session: this.projectInfo(session),
      snapshot: this.snapshotForSession(session),
    };
  }

  async detachSession(clientId: string, sessionId: string): Promise<{ closed: boolean }> {
    const clients = this.attachments.get(sessionId);
    if (!clients?.has(clientId)) {
      return { closed: false };
    }
    clients.delete(clientId);
    if (clients.size > 0) {
      return { closed: false };
    }
    this.attachments.delete(sessionId);
    await this.destroySession(sessionId);
    return { closed: true };
  }

  /** Move a live session to a new conversation key (e.g. provisional → stable chat path). */
  async migrateConversationKey(sessionId: string, nextKey: string): Promise<void> {
    const trimmed = nextKey.trim();
    if (!trimmed) {
      throw new Error("missing conversationKey");
    }
    const session = this.requireSession(sessionId);
    const previousKey = session.info.conversationKey?.trim();
    if (previousKey === trimmed) {
      return;
    }
    const occupied = this.conversationIndex.get(trimmed);
    if (occupied && occupied !== sessionId) {
      throw new Error(`conversationKey already registered: ${trimmed}`);
    }
    if (previousKey) {
      const indexed = this.conversationIndex.get(previousKey);
      if (indexed === sessionId) {
        this.conversationIndex.delete(previousKey);
      }
    }
    session.info.conversationKey = trimmed;
    this.conversationIndex.set(trimmed, sessionId);
    await session.runtimeResult.setTranscriptSessionKey(trimmed);
  }

  private resolveSessionId(params: AttachSessionParams): string {
    const byId = params.sessionId?.trim();
    if (byId) {
      return byId;
    }
    const key = params.conversationKey?.trim();
    if (!key) {
      throw new Error("missing sessionId or conversationKey");
    }
    const sessionId = this.conversationIndex.get(key);
    if (!sessionId) {
      throw new Error(`no live session for conversationKey: ${key}`);
    }
    return sessionId;
  }

  listSessions(): ServerSessionInfo[] {
    return [...this.sessions.values()].map((session) => this.projectInfo(session));
  }

  getSession(sessionId: string): ServerSessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.projectInfo(session) : undefined;
  }

  snapshot(sessionId: string): BridgeRuntimeSnapshot {
    const session = this.requireSession(sessionId);
    return this.snapshotForSession(session);
  }

  private snapshotForSession(session: ServerSession): BridgeRuntimeSnapshot {
    const snapshot = buildServerSnapshot(session.runtimeResult);
    // approval-resolved mid-broadcast clears pending approval before the resumed
    // tool/LLM round marks runtime busy again; keep clients on the busy edge
    // for the whole turn while session.turnActive is set.
    if (session.turnActive && !snapshot.isBusy) {
      return { ...snapshot, isBusy: true };
    }
    return snapshot;
  }

  private projectInfo(session: ServerSession): ServerSessionInfo {
    return {
      ...session.info,
      isBusy: session.runtimeResult.runtime.isBusy(),
      queuedTurns: session.queue.length,
      attachmentCount: this.attachments.get(session.info.sessionId)?.size ?? 0,
    };
  }

  private requireSession(sessionId: string): ServerSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  private handleRuntimeEvent(sessionId: string, event: RuntimeEvent<JsonValue>): void {
    this.callbacks.broadcastRuntimeEvent(sessionId, event);
    // Approval/question lifecycle changes are exactly when clients need a
    // fresh projection (to open or close the interactive UI).
    if (
      event.kind === "approval-requested" ||
      event.kind === "approval-resolved" ||
      event.kind === "questions-requested"
    ) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
      }
    }
  }

  // ------------------------------------------------------------------ pump

  private tickSession(session: ServerSession): void {
    if (session.polling) {
      return;
    }
    session.polling = true;
    void (async () => {
      const { runtime } = session.runtimeResult;
      await session.runtimeResult.toolExecutor.refreshCaches();
      await runtime.poll();
      const childSessions = runtime.childSessions();
      const childSessionsFingerprint = childSessions
        .map((entry) => `${entry.sessionId}:${entry.status}:${entry.parentToolCallId}`)
        .join("|");
      const childSessionsChanged = session.childSessionsFingerprint !== childSessionsFingerprint;
      if (childSessionsChanged) {
        session.childSessionsFingerprint = childSessionsFingerprint;
      }

      const childDrains = runtime.drainActiveChildSessionEvents().map((drain) => ({
        ...drain,
        pendingAux: runtime.childSessionPendingAuxState(drain.sessionId),
        archive: runtime.childSessionArchive(drain.sessionId),
      }));
      const hasLiveChildPayload = childDrains.some(
        (drain) => drain.events.length > 0 || drain.pendingAux !== undefined,
      );
      // Membership/status changes (incl. first create + mid-turn complete) must push
      // archives even when the child produced no events this tick — Desktop remote
      // runtime otherwise keeps empty childSessionArchives until turnFinished.
      if (hasLiveChildPayload || childSessionsChanged) {
        const drains = hasLiveChildPayload
          ? childDrains
          : runtime.childSessionArchives().map((archive) => ({
              sessionId: archive.summary.sessionId,
              parentToolCallId: archive.summary.parentToolCallId,
              events: [] as RuntimeEvent<JsonValue>[],
              pendingAux: runtime.childSessionPendingAuxState(archive.summary.sessionId),
              archive,
            }));
        this.callbacks.broadcastSubagentEvents?.(session.info.sessionId, drains);
      }
      if (childSessionsChanged) {
        this.callbacks.broadcastSnapshot(session.info.sessionId, this.snapshotForSession(session));
      }
      // The bridge had clients drive this on a timer; the daemon pump owns it now.
      runtime.handleStreamStallTimeout();

      const turnResult = runtime.takeCompletedTurnResult();
      if (turnResult && session.turnActive) {
        if (turnResult.kind !== "completed" && turnResult.kind !== "failed") {
          return;
        }
        this.finishTurn(
          session,
          session.turnGeneration,
          turnResult.kind === "failed" ? "failed" : "completed",
          turnResult.kind === "failed"
            ? {
                kind: "failed",
                error: turnResult.error,
                toolExecutions: turnResult.toolExecutions,
              }
            : {
                kind: "completed",
                assistantText: turnResult.assistantText,
                toolExecutions: turnResult.toolExecutions,
              },
        );
        return;
      }
      const compactionResult = runtime.takeCompletedManualHistoryCompactionResult();
      if (compactionResult && session.turnActive) {
        this.finishTurn(session, session.turnGeneration, "completed");
        return;
      }

      if (session.turnActive) {
        const idle =
          !runtime.isBusy() && !runtime.hasPendingApproval() && !runtime.hasPendingQuestions();
        session.idleTicksWhileActive = idle ? session.idleTicksWhileActive + 1 : 0;
        if (session.idleTicksWhileActive >= IDLE_GRACE_TICKS) {
          // The turn machine went idle without producing a result (should not
          // happen outside abort); release the session instead of hanging.
          this.finishTurn(session, session.turnGeneration, "cancelled");
          return;
        }
      } else {
        session.idleTicksWhileActive = 0;
      }

      this.drainQueue(session);
    })()
      .catch((err) => {
        this.callbacks.log?.(
          `session ${session.info.sessionId} pump error: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        session.polling = false;
      });
  }

  // ---------------------------------------------------------------- turns

  async submitUserTurn(
    sessionId: string,
    params: SubmitUserTurnParams,
  ): Promise<SubmitUserTurnOutcome> {
    const session = this.requireSession(sessionId);
    const { runtime } = session.runtimeResult;
    const text = params.text.trim();
    const imageCount = params.explicitImages?.length ?? 0;
    const fileCount = params.explicitWorkspaceFiles?.length ?? 0;
    const pendingImageCount = runtime.pendingImagePaths().length;
    const hasPayload = Boolean(text) || imageCount > 0 || fileCount > 0 || pendingImageCount > 0;
    if (!hasPayload) {
      throw new Error("empty user turn");
    }

    const turn: QueuedUserTurn = {
      text: params.text,
      ...(params.clientTurnId?.trim() ? { clientTurnId: params.clientTurnId.trim() } : {}),
      explicitImages: params.explicitImages ?? [],
      explicitWorkspaceFiles: params.explicitWorkspaceFiles ?? [],
      activeSkills: params.activeSkills ?? [],
    };

    if (runtime.isBusy() || session.turnActive) {
      // Busy sessions queue; the queue drains when the current turn lands.
      session.queue.push(turn);
      return { queued: true, position: session.queue.length };
    }
    if (runtime.hasPendingApproval() || runtime.hasPendingQuestions()) {
      throw new Error("session has a pending approval or questionnaire; answer it first");
    }

    await this.startTurn(session, turn);
    return { accepted: true };
  }

  private async startTurn(session: ServerSession, turn: QueuedUserTurn): Promise<void> {
    const { runtime } = session.runtimeResult;
    await session.runtimeResult.toolExecutor.refreshCaches();
    session.turnActive = true;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = true;
    session.turnGeneration += 1;

    // Skills activated out-of-turn (slash) merge with per-turn activations.
    const pending = session.pendingActiveSkills ?? [];
    const merged = [...pending, ...(turn.activeSkills ?? [])];
    const seen = new Set<string>();
    const activeSkills = merged.filter((skill) => {
      if (seen.has(skill.id)) {
        return false;
      }
      seen.add(skill.id);
      return true;
    });
    session.pendingActiveSkills = [];

    await runtime.startUserTurnStreaming(
      turn.text,
      turn.explicitImages,
      turn.explicitWorkspaceFiles,
      activeSkills,
    );
    this.scheduleSessionTitleGenerationIfNeeded(session, turn.text);
    this.callbacks.broadcastUserTurnSubmitted?.(session.info.sessionId, turn);
    // Push the busy edge immediately so clients see the turn start.
    this.callbacks.broadcastSnapshot(session.info.sessionId, this.snapshotForSession(session));
  }

  private scheduleSessionTitleGenerationIfNeeded(session: ServerSession, userText: string): void {
    const history = session.runtimeResult.runtime.history();
    if (
      !shouldScheduleSessionTitleGeneration({
        sessionKind: session.createParams.sessionKind,
        conversationKey: session.info.conversationKey ?? session.createParams.conversationKey,
        history,
      })
    ) {
      return;
    }

    const { imagePaths, videoPaths } = mediaPathsFromLatestUserMessage(history);
    const fallbackSeedTitle = deriveSessionTitleFallbackSeed(userText);
    const sessionId = session.info.sessionId;
    void generateSessionTitleForTurn({
      spiritDataDir: this.spiritDataDir,
      workspaceRoot: session.info.workspaceRoot,
      userText,
      imagePaths,
      videoPaths,
      fallbackSeedTitle,
    })
      .then((result) => {
        const live = this.sessions.get(sessionId);
        if (!live) {
          return;
        }
        live.info.title = result.title;
        this.callbacks.broadcastTitleUpdated?.(sessionId, result.title);
      })
      .catch((error) => {
        console.warn(
          "[session-title] generation failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  private finishTurn(
    session: ServerSession,
    generation: number,
    stopReason: TurnStopReason,
    result?: ServerTurnResult,
  ): void {
    if (session.turnGeneration !== generation || !session.turnActive) {
      return;
    }
    session.turnActive = false;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = false;
    this.callbacks.broadcastTurnFinished(session.info.sessionId, stopReason, result);
    this.callbacks.broadcastSnapshot(session.info.sessionId, this.snapshotForSession(session));
    this.drainQueue(session);
  }

  private drainQueue(session: ServerSession): void {
    const { runtime } = session.runtimeResult;
    if (session.queue.length === 0 || session.turnActive || runtime.isBusy()) {
      return;
    }
    if (runtime.hasPendingApproval() || runtime.hasPendingQuestions()) {
      return;
    }
    const next = session.queue.shift()!;
    this.startTurn(session, next).catch((err) => {
      session.turnActive = false;
      session.info.isBusy = false;
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.broadcastTurnFinished(session.info.sessionId, "failed", {
        kind: "failed",
        error: message,
        toolExecutions: [],
      });
      this.callbacks.log?.(`drainQueue failed: ${message}`);
      this.drainQueue(session);
    });
  }

  abort(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.turnGeneration += 1;
    session.runtimeResult.runtime.abort();
    session.turnActive = false;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = false;
    this.callbacks.broadcastTurnFinished(sessionId, "cancelled");
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
    this.drainQueue(session);
  }

  abortShell(sessionId: string, toolCallId: string): boolean {
    return this.requireSession(sessionId).runtimeResult.abortShell(toolCallId);
  }

  async continueAssistantCompletion(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const { runtime } = session.runtimeResult;
    if (runtime.isBusy() || session.turnActive) {
      throw new Error("session is busy; wait for the current turn to finish");
    }
    session.turnActive = true;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = true;
    session.turnGeneration += 1;
    await runtime.continueAssistantCompletionStreaming();
  }

  async compactHistory(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const { runtime } = session.runtimeResult;
    if (runtime.isBusy() || session.turnActive) {
      throw new Error("session is busy; wait for the current turn to finish");
    }
    session.turnActive = true;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = true;
    session.turnGeneration += 1;
    await runtime.startManualHistoryCompaction();
  }

  // ------------------------------------------------------- session config

  async setApprovalLevel(sessionId: string, level: ApprovalLevel): Promise<void> {
    const session = this.requireSession(sessionId);
    session.runtimeResult.setApprovalLevel(level);
    session.info.approvalLevel = level;
  }

  async setAgentMode(sessionId: string, mode: AgentMode): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.runtimeResult.setAgentMode(mode);
    session.createParams.agentMode = mode;
  }

  setLoopEnabled(sessionId: string, enabled: boolean): void {
    const session = this.requireSession(sessionId);
    session.runtimeResult.setLoopEnabled(enabled);
  }

  reset(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.turnGeneration += 1;
    session.runtimeResult.runtime.abort();
    session.queue = [];
    session.turnActive = false;
    session.runtimeResult.runtime.replaceHistory([]);
    session.info.isBusy = false;
    session.desktopTimeline = undefined;
    // Match the legacy bridge's fresh-session semantics: todos reset with it.
    void createHostTodoStore({
      spiritDataDir: this.spiritDataDir,
      scope: { sessionKey: session.todoSessionKey },
    })
      .purge()
      .catch(() => {});
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
  }

  rename(sessionId: string, title: string): void {
    const session = this.requireSession(sessionId);
    const trimmed = title.trim();
    if (trimmed) {
      session.info.title = trimmed;
    } else {
      delete session.info.title;
    }
  }

  // ---------------------------------------------------- archive / restore

  replaceFromArchive(sessionId: string, archive: unknown): void {
    const session = this.requireSession(sessionId);
    const { runtime } = session.runtimeResult;
    if (runtime.isBusy() || session.turnActive) {
      throw new Error("session is busy; cannot replace archive while a turn is active");
    }
    session.runtimeResult.runtime.replaceFromArchive(archive as never);
    // History was replaced wholesale; the previous timeline is stale until
    // the owning host pushes a fresh snapshot.
    session.desktopTimeline = undefined;
  }

  exportArchive(sessionId: string, messages: unknown, assistantAux: unknown): unknown {
    const session = this.requireSession(sessionId);
    const archive = session.runtimeResult.runtime.toArchive(
      messages as never,
      assistantAux as never,
    );
    const stored = session.desktopTimeline;
    if (!stored) {
      return archive;
    }
    return {
      ...archive,
      desktopMessageTimeline: stored.timeline,
      desktopMessageTimelineRevision: stored.revision,
    };
  }

  /**
   * Store the authoritative desktop timeline pushed by a host client and
   * notify every attached client. Payload stays opaque; only the array shape
   * is enforced at this boundary.
   */
  pushDesktopTimeline(sessionId: string, timeline: unknown): { ok: true; revision: number } {
    const session = this.requireSession(sessionId);
    if (!Array.isArray(timeline)) {
      throw new Error("desktop timeline must be an array");
    }
    const revision = (session.desktopTimeline?.revision ?? 0) + 1;
    session.desktopTimeline = {
      revision,
      timeline,
      updatedAtUnixMs: Date.now(),
    };
    this.callbacks.broadcastDesktopTimelineUpdated?.(sessionId, revision);
    return { ok: true, revision };
  }

  getDesktopTimeline(sessionId: string): { revision: number; timeline: unknown[] } | null {
    const session = this.requireSession(sessionId);
    const stored = session.desktopTimeline;
    if (!stored) {
      return null;
    }
    return { revision: stored.revision, timeline: stored.timeline };
  }

  async exportState(sessionId: string): Promise<unknown> {
    const session = this.requireSession(sessionId);
    return session.runtimeResult.exportState();
  }

  // ---------------------------------------------------------- skills / MCP

  activateSkill(sessionId: string, skill: LlmActiveSkill): void {
    const session = this.requireSession(sessionId);
    const pending = session.pendingActiveSkills.filter((entry) => entry.id !== skill.id);
    pending.push(skill);
    session.pendingActiveSkills = pending;
  }

  addPendingImage(sessionId: string, path: string): void {
    this.requireSession(sessionId).runtimeResult.runtime.addPendingImage(path);
  }

  clearPendingImages(sessionId: string): number {
    const { runtime } = this.requireSession(sessionId).runtimeResult;
    const count = runtime.pendingImagePaths().length;
    runtime.clearPendingImages();
    return count;
  }

  async attachMcpResource(sessionId: string, server: string, uri: string): Promise<string> {
    return this.requireSession(sessionId).runtimeResult.runtime.attachMcpResource(server, uri);
  }

  clearPendingMcpResources(sessionId: string): number {
    const { runtime } = this.requireSession(sessionId).runtimeResult;
    const count = runtime.pendingMcpResources().length;
    runtime.clearPendingMcpResources();
    return count;
  }

  async applyMcpPrompt(
    sessionId: string,
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<string> {
    const session = this.requireSession(sessionId);
    await session.runtimeResult.toolExecutor.refreshCaches();
    session.turnActive = true;
    session.idleTicksWhileActive = 0;
    session.turnGeneration += 1;
    return session.runtimeResult.runtime.startApplyMcpPrompt(server, prompt, argsJson, userMessage);
  }

  /** MCP management/read pass-throughs to the session's tool executor. */
  async mcpCall(
    sessionId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const { toolExecutor, runtime } = this.requireSession(sessionId).runtimeResult;
    switch (action) {
      case "listMcpServers":
        return toolExecutor.listMcpServers();
      case "inspectMcpServer":
        return toolExecutor.inspectMcpServer(String(params["name"] ?? ""));
      case "listMcpTools":
        return toolExecutor.listMcpTools(String(params["name"] ?? ""));
      case "listMcpResources":
        return toolExecutor.listMcpResources(String(params["name"] ?? ""));
      case "listMcpPrompts":
        return toolExecutor.listMcpPrompts(String(params["name"] ?? ""));
      case "listCachedMcpPrompts":
        return toolExecutor.listCachedMcpPrompts(String(params["name"] ?? ""));
      case "getMcpPrompt":
        return toolExecutor.getMcpPrompt(
          String(params["server"] ?? ""),
          String(params["prompt"] ?? ""),
          typeof params["argsJson"] === "string" ? params["argsJson"] : undefined,
        );
      case "callMcpTool":
        return toolExecutor.callMcpTool(
          String(params["server"] ?? ""),
          String(params["tool"] ?? ""),
          typeof params["argsJson"] === "string" ? params["argsJson"] : undefined,
        );
      case "readMcpResource":
        return toolExecutor.readMcpResource(
          String(params["server"] ?? ""),
          String(params["uri"] ?? ""),
        );
      case "mcpStatusSnapshot":
        return toolExecutor.mcpStatusSnapshot();
      case "startMcpBackgroundRefresh":
        toolExecutor.startMcpBackgroundRefresh();
        return toolExecutor.mcpStatusSnapshot();
      case "startManualMcpTool": {
        const request = await toolExecutor.createMcpToolRequest(
          String(params["server"] ?? ""),
          String(params["tool"] ?? ""),
          typeof params["argsJson"] === "string" ? params["argsJson"] : undefined,
        );
        return runtime.startManualToolRequestDirect(request, "manual");
      }
      default:
        throw new Error(`unknown mcp action: ${action}`);
    }
  }

  // -------------------------------------------------------- manual tools

  async startManualToolCommand(sessionId: string, message: string): Promise<unknown> {
    const { runtime } = this.requireSession(sessionId).runtimeResult;
    const result = await runtime.startManualToolCommand(message);
    return { result, snapshot: this.snapshot(sessionId) };
  }

  async continuePendingManualToolApproval(sessionId: string, decision: unknown): Promise<unknown> {
    const { runtime } = this.requireSession(sessionId).runtimeResult;
    const result = await runtime.continuePendingManualToolApproval(decision as never);
    return { result, snapshot: this.snapshot(sessionId) };
  }

  takeCompletedManualToolCommandResult(sessionId: string): unknown {
    return (
      this.requireSession(sessionId).runtimeResult.runtime.takeCompletedManualToolCommandResult() ??
      null
    );
  }

  // ------------------------------------------------------------ subagents

  subagentSessionArchive(sessionId: string, subagentSessionId: string): unknown {
    return (
      this.requireSession(sessionId).runtimeResult.runtime.childSessionArchive(subagentSessionId) ??
      null
    );
  }

  subagentPendingAuxState(sessionId: string, subagentSessionId: string): unknown {
    return (
      this.requireSession(sessionId).runtimeResult.runtime.childSessionPendingAuxState(
        subagentSessionId,
      ) ?? null
    );
  }

  // ------------------------------------------------- config / hooks / mode

  /** Re-resolve the transport from config.json and rebuild the runtime, preserving history. */
  async replaceConfig(sessionId: string, modelRef?: ModelRef): Promise<void> {
    const session = this.requireSession(sessionId);
    if (modelRef?.groupId?.trim() && modelRef?.name?.trim()) {
      session.createParams.modelRef = {
        groupId: modelRef.groupId.trim(),
        name: modelRef.name.trim(),
      };
    } else {
      delete session.createParams.modelRef;
    }
    const old = session.runtimeResult;
    await old.runSessionEnd("switch");
    old.runtime.abort();
    const history = [...old.runtime.history()];

    const fresh = await createServerRuntime({
      workspaceRoot: session.createParams.workspaceRoot,
      spiritDataDir: this.spiritDataDir,
      sessionKey: sessionId,
      ...(session.createParams.modelRef ? { modelRef: session.createParams.modelRef } : {}),
      todoSessionKey: session.todoSessionKey,
      mcpService: this.mcpRegistry.forWorkspace(session.createParams.workspaceRoot),
      hostKind: session.createParams.hostKind === "web" ? "cli" : session.createParams.hostKind,
      approvalLevel: session.info.approvalLevel,
      ...(session.createParams.hostUiPromptSection
        ? { hostUiPromptSection: session.createParams.hostUiPromptSection }
        : {}),
      ...(session.createParams.hostToolDescriptionHints
        ? { hostToolDescriptionHints: session.createParams.hostToolDescriptionHints }
        : {}),
      basicInfoHost: resolveBasicInfoHost(session.createParams),
      onEvent: (event) => this.handleRuntimeEvent(sessionId, event),
      onFileChange: (change) => this.callbacks.broadcastFileChange(sessionId, change),
      requestWorkspaceCapabilityTrust: (request) =>
        this.requestWorkspaceCapabilityTrust(sessionId, request),
      ...(this.callbacks.log ? { log: this.callbacks.log } : {}),
    });
    fresh.runtime.replaceHistory(history);
    fresh.setLoopEnabled(old.runtime.loopEnabled());
    await fresh.setAgentMode(session.createParams.agentMode ?? "agent");
    session.runtimeResult = fresh;
    session.info.model = fresh.transportConfig.model;
    await old.toolExecutor.disposeLsp();
    await fresh.runSessionStart("resume");
  }

  async reloadHostMetadata(sessionId: string, mode: AgentMode): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.runtimeResult.reloadHostMetadata(mode);
    session.runtimeResult.toolExecutor.setAgentModeToolExposure(mode);
  }

  async runSessionStart(sessionId: string, source: "startup" | "resume" | "open"): Promise<void> {
    await this.requireSession(sessionId).runtimeResult.runSessionStart(source);
  }

  async runSessionEnd(sessionId: string, reason: "abort" | "close" | "switch"): Promise<void> {
    await this.requireSession(sessionId).runtimeResult.runSessionEnd(reason);
  }

  setAttribution(
    sessionId: string,
    attribution: { commitEnabled?: boolean; prEnabled?: boolean },
  ): void {
    this.requireSession(sessionId).runtimeResult.setAttribution(attribution);
  }

  setTodoSessionKey(sessionId: string, sessionKey: string): void {
    const session = this.requireSession(sessionId);
    session.todoSessionKey = sessionKey;
    session.runtimeResult.setTodoSessionKey(sessionKey);
  }

  // ------------------------------------------------------ interactions

  async replyPendingApproval(
    sessionId: string,
    decision: Parameters<ServerRuntimeResult["runtime"]["continuePendingApproval"]>[0],
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.runtimeResult.runtime.continuePendingApproval(decision);
    // approval-resolved mid-broadcast often sees isBusy=false (pending cleared, tool not
    // inFlight yet). Push again after continue so clients see the resumed busy edge —
    // same pattern as replyPendingQuestions.
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
  }

  async replyPendingQuestions(
    sessionId: string,
    result: Parameters<ServerRuntimeResult["runtime"]["continuePendingQuestions"]>[0],
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.runtimeResult.runtime.continuePendingQuestions(result);
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
  }

  private requestWorkspaceCapabilityTrust(
    sessionId: string,
    request: WorkspaceCapabilityTrustRequestPayload,
  ): Promise<WorkspaceCapabilityTrustDecision> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingTrustRequests.delete(requestId);
        resolve("deny");
      }, TRUST_REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pendingTrustRequests.set(requestId, { sessionId, resolve, timer });
      this.callbacks.broadcastTrustRequest(sessionId, requestId, request);
    });
  }

  replyWorkspaceCapabilityTrust(
    requestId: string,
    decision: WorkspaceCapabilityTrustDecision,
  ): void {
    const pending = this.pendingTrustRequests.get(requestId);
    if (!pending) {
      // Already answered (first-responder wins) or timed out.
      return;
    }
    this.pendingTrustRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(decision);
  }

  pendingTrustSessionId(requestId: string): string | undefined {
    return this.pendingTrustRequests.get(requestId)?.sessionId;
  }

  /**
   * Last client disconnected: deny/skip every pending interaction so no
   * runtime parks on input that can never arrive.
   */
  handleNoClientsRemaining(): void {
    for (const session of this.sessions.values()) {
      const { runtime } = session.runtimeResult;
      if (runtime.hasPendingApproval()) {
        runtime
          .continuePendingApproval({
            kind: "deny",
            resultText: "All clients disconnected.",
          })
          .catch((err) =>
            this.callbacks.log?.(
              `session ${session.info.sessionId}: deny failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
      if (runtime.hasPendingQuestions()) {
        runtime
          .continuePendingQuestions({ status: "skipped" })
          .catch((err) =>
            this.callbacks.log?.(
              `session ${session.info.sessionId}: skip questions failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
    }
    for (const [requestId, pending] of this.pendingTrustRequests) {
      this.pendingTrustRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve("deny");
    }
  }

  /** Re-read installed extensions into every live session (post install/remove). */
  async refreshExtensions(): Promise<void> {
    await this.mcpRegistry.refreshAllConfigs();
    for (const session of this.sessions.values()) {
      await session.runtimeResult.refreshExtensions();
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.destroySession(sessionId);
  }

  private async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    const conversationKey = session.info.conversationKey?.trim();
    if (conversationKey && this.conversationIndex.get(conversationKey) === sessionId) {
      this.conversationIndex.delete(conversationKey);
    }
    this.attachments.delete(sessionId);
    session.turnGeneration += 1;
    session.queue = [];
    clearInterval(session.pump);
    session.runtimeResult.runtime.abort();
    this.sessions.delete(sessionId);
    await session.runtimeResult.toolExecutor.disposeLsp();
  }

  /** Aborts every session; called on daemon shutdown. */
  async shutdown(): Promise<void> {
    const disposals: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.turnGeneration += 1;
      clearInterval(session.pump);
      session.runtimeResult.runtime.abort();
      disposals.push(session.runtimeResult.toolExecutor.disposeLsp());
    }
    this.sessions.clear();
    this.conversationIndex.clear();
    this.attachments.clear();
    for (const [requestId, pending] of this.pendingTrustRequests) {
      this.pendingTrustRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve("deny");
    }
    await Promise.all(disposals);
  }
}
