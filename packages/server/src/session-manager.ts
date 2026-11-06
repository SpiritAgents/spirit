import { randomUUID } from "node:crypto";

import {
  buildStartImplementingPrompt,
  buildParentSubagentToolResultText,
  createToolExecutionTextOutput,
  getTransportConfigLastInputTokens,
  type HostToolDescriptionHint,
  type JsonValue,
  type LlmActiveSkill,
  type McpUiOpenRequest,
  type McpUiOpenResult,
  type McpUiOpener,
  type PendingWorkspaceFile,
  type RuntimeEvent,
  type RuntimeSubagentSessionArchiveEntry,
  type RuntimeSubagentSessionSummary,
  type AgentMode,
  type SubagentSessionExecutionRequest,
  type SessionTaskContext,
  type SessionTaskResult,
} from "@spiritagent/agent-core";
import type { BridgeRuntimeSnapshot } from "@spiritagent/agent-core/host-bridge";
import {
  createHostTodoStore,
  createBackgroundTaskOwner,
  createSessionId,
  createSubagentWorkspaceBootstrap,
  readSessionStorageKey,
  resolveSubagentTranscriptFilePath,
  RuntimeSessionStore,
  type BackgroundTaskOwner,
  deriveSessionTitleFallbackSeed,
  generateSessionTitleForTurn,
  extractActivePlanPathFromLlmHistory,
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
  sessionKind?: ServerSessionKind;
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
  workLocation?: import("@spiritagent/host-internal/work-location").WorkLocationKind;
  worktreePath?: string;
  worktreeBranch?: string;
  attachmentCount: number;
  restoredFromDisk: boolean;
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
  agentWriter?: {
    ownerSessionId: string;
    toolCallId: string;
    context: SessionTaskContext;
    blocked: boolean;
  };
  /** Incremented per turn; stale completions drop their broadcast. */
  turnGeneration: number;
  queue: QueuedUserTurn[];
  pump: NodeJS.Timeout;
  /** A turn/compaction is in flight (set by the initiator, cleared on finish). */
  turnActive: boolean;
  /** Ticks spent idle while turnActive — guards against result-less endings. */
  idleTicksWhileActive: number;
  polling: boolean;
  closing: boolean;
  operations: Promise<void>;
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
        presentationSequence?: number;
      }
    | undefined;
  /** Fingerprint of childSessions summaries; used to push archives when membership/status changes. */
  childSessionsFingerprint?: string;
  agentTurnWaiters?: Array<{
    resolve(result: { text: string; failed: boolean }): void;
    reject(error: unknown): void;
  }>;
}

interface NativeSubagentLink {
  parentSessionId: string;
  parentToolCallId: string;
  title: string;
}

export interface SessionManagerCallbacks {
  /** Broadcast a runtime event to every connected client. */
  broadcastRuntimeEvent: (
    sessionId: string,
    event: RuntimeEvent<JsonValue>,
    presentationSequence?: number,
  ) => void;
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
  broadcastUserTurnSubmitted?: (
    sessionId: string,
    turn: QueuedUserTurn,
    presentationSequence?: number,
  ) => void;
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
  /** Independent of RuntimeEvent — keeps tools/call in flight. */
  broadcastExtensionUiRequested?: (
    sessionId: string,
    request: {
      requestId: string;
      extensionId: string;
      viewId: string;
      params?: unknown;
    },
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
  sessionId?: string;
  workLocation?: import("@spiritagent/host-internal/work-location").WorkLocationKind;
  worktreePath?: string;
  worktreeBranch?: string;
  approvalLevel?: ApprovalLevel;
  modelRef?: ModelRef;
  agentMode?: AgentMode;
  /** Todo store scope override (defaults to the new session id). */
  todoSessionKey?: string;
  /** Stable chat file path for multi-host attach. */
  conversationKey?: string;
  sessionKind?: ServerSessionKind;
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
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
  private noClientsRemaining = false;
  private readonly unattendedInputs = new Set<string>();
  private readonly pendingTrustRequests = new Map<string, PendingTrustRequest>();
  private readonly pendingExtensionUi = new Map<
    string,
    {
      sessionId: string;
      resolve: (result: McpUiOpenResult) => void;
    }
  >();
  private readonly spiritDataDir: string;
  private taskOwner: Promise<BackgroundTaskOwner> | undefined;
  /** Shared per-workspace MCP services (also serve host.mcp* management RPCs). */
  readonly mcpRegistry: McpRegistry;
  /** conversationKey → in-flight create; collapses concurrent creates for the same chat. */
  private readonly creatingByConversationKey = new Map<string, Promise<ServerSessionInfo>>();
  private readonly agentTurnWaiters = new Map<
    string,
    Array<{
      resolve(result: { text: string; failed: boolean }): void;
      reject(error: unknown): void;
    }>
  >();
  private readonly nativeSubagentLinks = new Map<string, Map<string, NativeSubagentLink>>();

  constructor(
    spiritDataDir: string,
    private readonly callbacks: SessionManagerCallbacks,
  ) {
    this.spiritDataDir = spiritDataDir;
    this.mcpRegistry = new McpRegistry(
      spiritDataDir,
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
    requireExisting = false,
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

    const sessionId =
      params.sessionId?.trim() ||
      (trimmedKey ? readSessionStorageKey(this.spiritDataDir, trimmedKey) : undefined) ||
      createSessionId();
    // Transcript lookup prefers conversationKey (chat path); its alias resolves to sessionId.
    const transcriptSessionKey = trimmedKey || sessionId;
    const runtimeResult = await createServerRuntime({
      workspaceRoot: params.workspaceRoot,
      spiritDataDir: this.spiritDataDir,
      sessionKey: transcriptSessionKey,
      sessionId,
      subagentSessionDelegate: {
        execute: (request: SubagentSessionExecutionRequest) =>
          this.delegateSubagentTurn(sessionId, request),
      },
      ...(requireExisting ? { requireExisting: true } : {}),
      ...(params.subagentOrigin ? { subagentOrigin: params.subagentOrigin } : {}),
      ...(params.workLocation ? { workLocation: params.workLocation } : {}),
      ...(params.worktreePath ? { worktreePath: params.worktreePath } : {}),
      ...(params.worktreeBranch ? { worktreeBranch: params.worktreeBranch } : {}),
      taskOwner: await (this.taskOwner ??= createBackgroundTaskOwner(this.spiritDataDir)),
      ...(params.modelRef ? { modelRef: params.modelRef } : {}),
      ...(params.todoSessionKey?.trim() ? { todoSessionKey: params.todoSessionKey.trim() } : {}),
      ...(params.sessionKind === "dream-collector"
        ? {}
        : { mcpService: this.mcpRegistry.forWorkspace(params.workspaceRoot) }),
      hostKind: params.hostKind === "web" ? "cli" : params.hostKind,
      approvalLevel: params.approvalLevel ?? "default",
      agentMode: params.agentMode ?? "agent",
      ...(params.sessionKind ? { sessionKind: params.sessionKind } : {}),
      ...(params.dreamScope ? { dreamScope: params.dreamScope } : {}),
      ...(params.dreamSourceSession ? { dreamSourceSession: params.dreamSourceSession } : {}),
      ...(params.hostUiPromptSection ? { hostUiPromptSection: params.hostUiPromptSection } : {}),
      ...(params.hostToolDescriptionHints
        ? { hostToolDescriptionHints: params.hostToolDescriptionHints }
        : {}),
      basicInfoHost: resolveBasicInfoHost(params),
      onEvent: (event, sequence) => this.handleRuntimeEvent(sessionId, event, sequence),
      onFileChange: (change) => this.callbacks.broadcastFileChange(sessionId, change),
      requestWorkspaceCapabilityTrust: (request) =>
        this.requestWorkspaceCapabilityTrust(sessionId, request),
      ...(this.callbacks.log ? { log: this.callbacks.log } : {}),
    });
    if (params.agentMode) await runtimeResult.setAgentMode(params.agentMode);
    this.attachDesktopMcpUiOpener(sessionId, runtimeResult, params.hostKind);

    const info: ServerSessionInfo = {
      sessionId,
      workspaceRoot: runtimeResult.workspaceRoot,
      hostKind: params.hostKind,
      createdAt: new Date().toISOString(),
      isBusy: false,
      approvalLevel: params.approvalLevel ?? "default",
      model: runtimeResult.transportConfig.model,
      queuedTurns: 0,
      attachmentCount: 0,
      restoredFromDisk: runtimeResult.restoredFromDisk,
      workLocation: runtimeResult.workLocation,
      ...(runtimeResult.worktreePath ? { worktreePath: runtimeResult.worktreePath } : {}),
      ...(runtimeResult.worktreeBranch ? { worktreeBranch: runtimeResult.worktreeBranch } : {}),
      ...(runtimeResult.sessionKind ? { sessionKind: runtimeResult.sessionKind } : {}),
      ...(runtimeResult.subagentOrigin ? { subagentOrigin: runtimeResult.subagentOrigin } : {}),
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
      closing: false,
      operations: Promise.resolve(),
      ...(runtimeResult.restoredDesktopTimeline
        ? { desktopTimeline: runtimeResult.restoredDesktopTimeline }
        : {}),
      pendingActiveSkills: [],
      createParams: {
        ...params,
        workspaceRoot: runtimeResult.workspaceRoot,
        workLocation: runtimeResult.workLocation,
        ...(runtimeResult.worktreePath ? { worktreePath: runtimeResult.worktreePath } : {}),
        ...(runtimeResult.worktreeBranch ? { worktreeBranch: runtimeResult.worktreeBranch } : {}),
      },
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

  private waitForAgentTurn(sessionId: string): Promise<{ text: string; failed: boolean }> {
    return new Promise((resolve, reject) => {
      const waiters = this.agentTurnWaiters.get(sessionId) ?? [];
      waiters.push({ resolve, reject });
      this.agentTurnWaiters.set(sessionId, waiters);
    });
  }

  private settleAgentTurnWaiters(
    sessionId: string,
    result: { text: string; failed: boolean },
  ): void {
    const waiters = this.agentTurnWaiters.get(sessionId) ?? [];
    this.agentTurnWaiters.delete(sessionId);
    for (const waiter of waiters) waiter.resolve(result);
  }

  private failAgentTurnWaiters(sessionId: string, error: unknown): void {
    const waiters = this.agentTurnWaiters.get(sessionId) ?? [];
    this.agentTurnWaiters.delete(sessionId);
    for (const waiter of waiters) waiter.reject(error);
  }

  async delegateSubagentTurn(
    parentSessionId: string,
    request: SubagentSessionExecutionRequest,
  ): Promise<SessionTaskResult> {
    const parent = this.requireSession(parentSessionId);
    if (!request.sessionId && parent.info.sessionKind === "subagent") {
      throw new Error("Nested subagents are not supported.");
    }
    const target = request.sessionId
      ? await this.resumeSession(request.sessionId, parent.info.workspaceRoot, parent.info.hostKind)
      : await this.createSession({
          workspaceRoot: parent.info.workspaceRoot,
          hostKind: parent.info.hostKind,
          sessionKind: "subagent",
          subagentOrigin: {
            parentSessionId,
            parentToolCallId: request.parentToolCallId,
          },
          ...(parent.createParams.modelRef ? { modelRef: parent.createParams.modelRef } : {}),
          ...(parent.createParams.agentMode ? { agentMode: parent.createParams.agentMode } : {}),
          approvalLevel: parent.info.approvalLevel,
          ...(parent.createParams.hostUiPromptSection
            ? { hostUiPromptSection: parent.createParams.hostUiPromptSection }
            : {}),
          ...(parent.createParams.hostToolDescriptionHints
            ? { hostToolDescriptionHints: parent.createParams.hostToolDescriptionHints }
            : {}),
          ...(parent.createParams.basicInfoHost
            ? { basicInfoHost: parent.createParams.basicInfoHost }
            : {}),
        });
    const targetSession = this.requireSession(target.sessionId);
    const links = this.nativeSubagentLinks.get(target.sessionId) ?? new Map();
    links.set(`${parentSessionId}\n${request.parentToolCallId}`, {
      parentSessionId,
      parentToolCallId: request.parentToolCallId,
      title: request.prompt.trim().slice(0, 72) || "SubAgent",
    });
    this.nativeSubagentLinks.set(target.sessionId, links);
    const { runtime } = targetSession.runtimeResult;
    if (runtime.hasPendingApproval() || runtime.hasPendingQuestions()) {
      throw new Error("Answer the target session's pending approval or questionnaire first.");
    }
    if (targetSession.agentWriter) {
      throw new Error("The target session is already being prompted by another agent.");
    }
    const writer: NonNullable<ServerSession["agentWriter"]> = {
      ownerSessionId: parentSessionId,
      toolCallId: request.parentToolCallId,
      context: request.context,
      blocked: false,
    };
    targetSession.agentWriter = writer;
    const cancel = () => {
      const target = this.sessions.get(targetSession.info.sessionId);
      if (target && !target.closing)
        this.abort(target.info.sessionId, { preserveAgentWriter: true });
    };
    request.context.signal.addEventListener("abort", cancel, { once: true });
    let completion: Promise<{ text: string; failed: boolean }> | undefined;
    try {
      const transcript = resolveSubagentTranscriptFilePath(
        this.spiritDataDir,
        target.sessionId,
        target.sessionId,
      );
      if (runtime.isBusy() || targetSession.turnActive) {
        this.abort(target.sessionId, { preserveAgentWriter: true });
        await targetSession.operations;
      }
      await this.serializeSession(targetSession, async () => {
        if (request.worktree) {
          await this.setSessionWorktree(target.sessionId);
        }
        await request.context.update({
          sessionId: target.sessionId,
          sessionTranscript: transcript,
          ...(targetSession.info.worktreePath
            ? { worktreePath: targetSession.info.worktreePath }
            : {}),
          ...(targetSession.info.worktreeBranch
            ? { worktreeBranch: targetSession.info.worktreeBranch }
            : {}),
        });
        completion = this.waitForAgentTurn(target.sessionId);
        await this.startTurn(targetSession, {
          text: request.prompt,
          explicitImages: [],
          explicitWorkspaceFiles: [],
          activeSkills: [],
        });
      });
      const result = await completion!;
      await request.context.update({
        finalOutputPreview: result.text.slice(0, 16_384),
      });
      await request.context.writeOutput(`\n\nFinal response:\n${result.text}\n`);
      return {
        output: createToolExecutionTextOutput(
          buildParentSubagentToolResultText(
            result.text,
            result.failed,
            target.sessionId,
            transcript,
          ),
        ),
        failed: result.failed,
      };
    } catch (error) {
      if (targetSession.agentWriter === writer) {
        void completion?.catch(() => {});
        this.failAgentTurnWaiters(target.sessionId, error);
      }
      throw error;
    } finally {
      request.context.signal.removeEventListener("abort", cancel);
      if (targetSession.agentWriter === writer) delete targetSession.agentWriter;
    }
  }

  async setSessionWorktree(sessionId: string): Promise<ServerSessionInfo> {
    const session = this.requireSession(sessionId);
    if (session.info.workLocation === "worktree" && session.info.worktreePath) {
      return session.info;
    }
    if (session.runtimeResult.runtime.isBusy() || session.turnActive) {
      throw new Error("The target session is busy; wait for the current turn to finish.");
    }
    const bootstrap = createSubagentWorkspaceBootstrap({
      parentWorkspaceRoot: session.info.workspaceRoot,
      buildScopedRuntime: async () => ({ toolExecutor: session.runtimeResult.toolExecutor }),
    });
    const boot = await bootstrap({
      subagentSessionId: sessionId,
      task: "Continue session",
      worktree: true,
      parentWorkspaceRoot: session.info.workspaceRoot,
    });
    if ("error" in boot) throw new Error(boot.error);
    if (!boot.worktreePath || !boot.branchName) {
      await boot.rollback?.();
      throw new Error("The subagent worktree identity is incomplete.");
    }
    const previousRoot = session.info.workspaceRoot;
    let switched = false;
    try {
      const fresh = await this.reconfigureSessionWorkspace(session, boot.workspaceRoot);
      switched = true;
      session.runtimeResult = fresh;
      session.info.workspaceRoot = boot.workspaceRoot;
      session.info.workLocation = "worktree";
      session.info.worktreePath = boot.worktreePath;
      session.info.worktreeBranch = boot.branchName;
      session.createParams.workspaceRoot = boot.workspaceRoot;
      session.createParams.workLocation = "worktree";
      session.createParams.worktreePath = boot.worktreePath;
      session.createParams.worktreeBranch = boot.branchName;
      fresh.workLocation = "worktree";
      fresh.worktreePath = boot.worktreePath;
      fresh.worktreeBranch = boot.branchName;
      await fresh.persist();
      boot.markStarted?.();
    } catch (error) {
      const cleanup: Promise<unknown>[] = [Promise.resolve(boot.rollback?.())];
      if (switched) {
        cleanup.push(
          this.reconfigureSessionWorkspace(session, previousRoot).then((restored) => {
            session.runtimeResult = restored;
            session.info.workspaceRoot = previousRoot;
            session.info.workLocation = "local";
            delete session.info.worktreePath;
            delete session.info.worktreeBranch;
            session.createParams.workspaceRoot = previousRoot;
            session.createParams.workLocation = "local";
            delete session.createParams.worktreePath;
            delete session.createParams.worktreeBranch;
          }),
        );
      }
      const results = await Promise.allSettled(cleanup);
      const failures = results.flatMap((entry) =>
        entry.status === "rejected" ? [entry.reason] : [],
      );
      if (failures.length) throw new AggregateError([error, ...failures]);
      throw error;
    }
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
    return session.info;
  }

  private reconfigureSessionWorkspace(
    session: ServerSession,
    workspaceRoot: string,
  ): Promise<ServerRuntimeResult> {
    const current = session.runtimeResult;
    return current.reconfigure({
      workspaceRoot,
      spiritDataDir: this.spiritDataDir,
      sessionKey: current.sessionId,
      agentMode: current.agentModeSnapshot(),
      ...(session.createParams.modelRef ? { modelRef: session.createParams.modelRef } : {}),
      todoSessionKey: session.todoSessionKey,
      mcpService: this.mcpRegistry.forWorkspace(workspaceRoot),
      hostKind: session.createParams.hostKind === "web" ? "cli" : session.createParams.hostKind,
      approvalLevel: session.info.approvalLevel,
      ...(session.info.sessionKind ? { sessionKind: session.info.sessionKind } : {}),
      ...(session.info.subagentOrigin ? { subagentOrigin: session.info.subagentOrigin } : {}),
      ...(session.createParams.hostUiPromptSection
        ? { hostUiPromptSection: session.createParams.hostUiPromptSection }
        : {}),
      ...(session.createParams.hostToolDescriptionHints
        ? { hostToolDescriptionHints: session.createParams.hostToolDescriptionHints }
        : {}),
      basicInfoHost: resolveBasicInfoHost(session.createParams),
      onEvent: (event, sequence) =>
        this.handleRuntimeEvent(session.info.sessionId, event, sequence),
      onFileChange: (change) => this.callbacks.broadcastFileChange(session.info.sessionId, change),
      requestWorkspaceCapabilityTrust: (request) =>
        this.requestWorkspaceCapabilityTrust(session.info.sessionId, request),
      ...(this.callbacks.log ? { log: this.callbacks.log } : {}),
    });
  }

  async resumeSession(
    sessionId: string,
    workspaceRoot: string,
    hostKind: ServerClientKind = "desktop",
  ): Promise<ServerSessionInfo> {
    const trimmed = sessionId.trim();
    if (!trimmed) throw new Error("missing sessionId");
    const live = this.sessions.get(trimmed);
    if (live) {
      return this.projectInfo(live);
    }
    const storageKey = readSessionStorageKey(this.spiritDataDir, trimmed);
    const saved = storageKey
      ? await new RuntimeSessionStore(this.spiritDataDir, storageKey).read()
      : undefined;
    return this.createSessionInner(
      {
        workspaceRoot: saved?.workspaceRoot ?? workspaceRoot,
        hostKind,
        sessionId: trimmed,
        ...(saved?.modelRef ? { modelRef: saved.modelRef } : {}),
      },
      undefined,
      true,
    );
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
    this.noClientsRemaining = false;
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
    return { closed: false };
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
    await session.runtimeResult.setTranscriptSessionKey(trimmed);
    if (previousKey) {
      const indexed = this.conversationIndex.get(previousKey);
      if (indexed === sessionId) {
        this.conversationIndex.delete(previousKey);
      }
    }
    session.info.conversationKey = trimmed;
    this.conversationIndex.set(trimmed, sessionId);
    await session.runtimeResult.persist();
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

  listSessions(options: { includeSubagents?: boolean } = {}): ServerSessionInfo[] {
    return [...this.sessions.values()]
      .filter(
        (session) => options.includeSubagents === true || session.info.sessionKind !== "subagent",
      )
      .map((session) => this.projectInfo(session));
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
    let snapshot = buildServerSnapshot(session.runtimeResult);
    const delegated = [...this.sessions.values()].filter(
      (target) => target.agentWriter?.ownerSessionId === session.info.sessionId,
    );
    if (!snapshot.currentPendingApproval) {
      for (const target of delegated) {
        const approval = target.runtimeResult.runtime.currentPendingApproval();
        if (!approval) continue;
        snapshot = {
          ...snapshot,
          hasPendingApproval: true,
          currentPendingApproval: {
            ...approval,
            subagentSessionId: target.info.sessionId,
            subagentTitle: target.info.title ?? "SubAgent",
          },
        };
        break;
      }
    }
    if (!snapshot.currentPendingQuestions) {
      const questions = delegated
        .map((target) => target.runtimeResult.runtime.currentPendingQuestions())
        .find((pending) => pending !== undefined);
      if (questions)
        snapshot = { ...snapshot, hasPendingQuestions: true, currentPendingQuestions: questions };
    }
    // approval-resolved mid-broadcast clears pending approval before the resumed
    // tool/LLM round marks runtime busy again; keep clients on the busy edge
    // for the whole turn while session.turnActive is set.
    if (session.turnActive && !snapshot.isBusy) {
      return { ...snapshot, isBusy: true };
    }
    return snapshot;
  }

  private syncDelegatedInputState(session: ServerSession): void {
    const writer = session.agentWriter;
    if (!writer) return;
    const blocked =
      session.runtimeResult.runtime.hasPendingApproval() ||
      session.runtimeResult.runtime.hasPendingQuestions();
    if (writer.blocked === blocked) return;
    writer.blocked = blocked;
    void writer.context.update({}, blocked ? "blocked" : "running").catch((error: unknown) => {
      this.callbacks.log?.(
        `session ${session.info.sessionId}: delegated input state failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const parent = this.sessions.get(writer.ownerSessionId);
    if (parent && !parent.closing) {
      this.callbacks.broadcastSnapshot(parent.info.sessionId, this.snapshotForSession(parent));
    }
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
    if (!session || session.closing) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  private handleRuntimeEvent(
    sessionId: string,
    event: RuntimeEvent<JsonValue>,
    presentationSequence?: number,
  ): void {
    if (event.kind === "background-task-error") {
      this.callbacks.log?.(`session ${sessionId}: ${event.error}`);
    }
    this.callbacks.broadcastRuntimeEvent(sessionId, event, presentationSequence);
    const session = this.sessions.get(sessionId);
    if (
      session &&
      (event.kind === "approval-requested" ||
        event.kind === "approval-resolved" ||
        event.kind === "questions-requested")
    ) {
      this.syncDelegatedInputState(session);
    }
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

  private serializeSession<T>(
    session: ServerSession,
    action: () => Promise<T>,
    allowClosing = false,
  ): Promise<T> {
    const guarded = async () => {
      if (session.closing && !allowClosing) throw new Error("Session is closing.");
      return action();
    };
    const run = session.operations.then(guarded, guarded);
    session.operations = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private tickSession(session: ServerSession): void {
    if (this.noClientsRemaining) this.denyUnattendedInputs(session);
    if (session.polling || session.closing) {
      return;
    }
    session.polling = true;
    void this.serializeSession(
      session,
      async () => {
        if (this.sessions.get(session.info.sessionId) !== session || session.closing) return;
        const { runtime } = session.runtimeResult;
        await session.runtimeResult.toolExecutor.refreshCaches();
        await runtime.poll({ allowBackgroundWakeup: false });
        this.syncDelegatedInputState(session);
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
        const childInputChanged = childDrains.some((drain) =>
          drain.events.some(
            (event) =>
              event.kind === "approval-requested" ||
              event.kind === "approval-resolved" ||
              event.kind === "questions-requested",
          ),
        );
        if (childSessionsChanged || childInputChanged) {
          this.callbacks.broadcastSnapshot(
            session.info.sessionId,
            this.snapshotForSession(session),
          );
        }
        // The bridge had clients drive this on a timer; the daemon pump owns it now.
        runtime.handleStreamStallTimeout();
        const drainedEvents = runtime.drainEvents();
        this.broadcastNativeSubagentEvents(session, drainedEvents);

        const turnResult = runtime.takeCompletedTurnResult();
        if (turnResult && session.turnActive) {
          if (turnResult.kind !== "completed" && turnResult.kind !== "failed") {
            return;
          }
          await this.finishTurn(
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
          await this.finishTurn(session, session.turnGeneration, "completed");
          return;
        }

        if (session.turnActive) {
          const idle =
            !runtime.isBusy() && !runtime.hasPendingApproval() && !runtime.hasPendingQuestions();
          session.idleTicksWhileActive = idle ? session.idleTicksWhileActive + 1 : 0;
          if (session.idleTicksWhileActive >= IDLE_GRACE_TICKS) {
            // The turn machine went idle without producing a result (should not
            // happen outside abort); release the session instead of hanging.
            await this.finishTurn(session, session.turnGeneration, "cancelled");
            return;
          }
        } else {
          session.idleTicksWhileActive = 0;
        }

        await this.drainQueue(session);
        if (
          !session.turnActive &&
          !runtime.isBusy() &&
          !runtime.hasPendingApproval() &&
          !runtime.hasPendingQuestions() &&
          runtime.hasPendingBackgroundTaskNotifications()
        ) {
          session.turnActive = true;
          session.turnGeneration += 1;
          session.info.isBusy = true;
          try {
            if (!(await runtime.resumeBackgroundTaskNotifications())) {
              session.turnActive = false;
              session.info.isBusy = false;
            }
          } catch (error) {
            session.turnActive = false;
            session.info.isBusy = false;
            throw error;
          }
          this.callbacks.broadcastSnapshot(
            session.info.sessionId,
            this.snapshotForSession(session),
          );
        }
      },
      true,
    )
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
    return this.serializeSession(session, () => this.submitUserTurnNow(session, params));
  }

  async startImplementing(
    sessionId: string,
    clientTurnId?: string,
  ): Promise<SubmitUserTurnOutcome> {
    const session = this.requireSession(sessionId);
    const assertReady = () => {
      const { runtime } = session.runtimeResult;
      if (
        runtime.isBusy() ||
        session.turnActive ||
        runtime.hasPendingApproval() ||
        runtime.hasPendingQuestions()
      )
        throw new Error(
          "Finish the current turn and answer pending requests before starting implementation.",
        );
    };
    assertReady();
    return this.serializeSession(session, async () => {
      assertReady();
      const planPath = session.runtimeResult.activePlanPathSnapshot();
      session.runtimeResult.setActivePlanPath(planPath);
      await session.runtimeResult.setAgentMode("agent");
      session.createParams.agentMode = "agent";
      await session.runtimeResult.persist();
      return this.submitUserTurnNow(session, {
        text: buildStartImplementingPrompt(planPath),
        ...(clientTurnId ? { clientTurnId } : {}),
      });
    });
  }

  private async submitUserTurnNow(
    session: ServerSession,
    params: SubmitUserTurnParams,
  ): Promise<SubmitUserTurnOutcome> {
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
    const unconfiguredReason = session.runtimeResult.unconfiguredReason;
    if (unconfiguredReason) {
      throw new Error(unconfiguredReason);
    }
    const { runtime } = session.runtimeResult;
    await session.runtimeResult.toolExecutor.refreshCaches();
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

    const presentationSequence = session.runtimeResult.presentation.append({
      kind: "user",
      text: turn.text,
      explicitWorkspaceFiles: turn.explicitWorkspaceFiles,
      ...(turn.clientTurnId ? { clientTurnId: turn.clientTurnId } : {}),
    });
    this.callbacks.broadcastUserTurnSubmitted?.(session.info.sessionId, turn, presentationSequence);
    await this.startForegroundAction(session, () =>
      runtime.startUserTurnStreaming(
        turn.text,
        turn.explicitImages,
        turn.explicitWorkspaceFiles,
        activeSkills,
      ),
    );
    this.scheduleSessionTitleGenerationIfNeeded(session, turn.text);
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

  private async finishTurn(
    session: ServerSession,
    generation: number,
    stopReason: TurnStopReason,
    result?: ServerTurnResult,
  ): Promise<void> {
    if (session.turnGeneration !== generation || !session.turnActive) {
      return;
    }
    session.turnActive = false;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = false;
    await session.runtimeResult.persist();
    this.callbacks.broadcastTurnFinished(session.info.sessionId, stopReason, result);
    this.callbacks.broadcastSnapshot(session.info.sessionId, this.snapshotForSession(session));
    this.settleAgentTurnWaiters(session.info.sessionId, {
      text:
        result?.kind === "completed"
          ? result.assistantText
          : result?.kind === "failed"
            ? result.error
            : "The turn was cancelled.",
      failed: stopReason !== "completed",
    });
    await this.drainQueue(session);
  }

  private async drainQueue(session: ServerSession): Promise<void> {
    const { runtime } = session.runtimeResult;
    if (session.queue.length === 0 || session.turnActive || runtime.isBusy()) {
      return;
    }
    if (runtime.hasPendingApproval() || runtime.hasPendingQuestions()) {
      return;
    }
    const next = session.queue.shift()!;
    try {
      await this.startTurn(session, next);
    } catch (err) {
      session.turnActive = false;
      session.info.isBusy = false;
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.broadcastTurnFinished(session.info.sessionId, "failed", {
        kind: "failed",
        error: message,
        toolExecutions: [],
      });
      this.callbacks.log?.(`drainQueue failed: ${message}`);
      await this.drainQueue(session);
    }
  }

  abort(sessionId: string, options: { preserveAgentWriter?: boolean } = {}): void {
    const session = this.requireSession(sessionId);
    session.turnGeneration += 1;
    if (!options.preserveAgentWriter) delete session.agentWriter;
    session.runtimeResult.runtime.abort();
    session.turnActive = false;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = false;
    this.callbacks.broadcastTurnFinished(sessionId, "cancelled");
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
    void this.serializeSession(session, async () => {
      await session.runtimeResult.persist();
      await this.drainQueue(session);
    }).catch((error: unknown) =>
      this.callbacks.broadcastRuntimeEvent(sessionId, {
        kind: "background-task-error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  abortShell(sessionId: string, toolCallId: string): boolean {
    return this.requireSession(sessionId).runtimeResult.abortShell(toolCallId);
  }

  async continueAssistantCompletion(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.serializeSession(session, () =>
      this.startForegroundAction(session, () =>
        session.runtimeResult.runtime.continueAssistantCompletionStreaming(),
      ),
    );
  }

  async compactHistory(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.serializeSession(session, () =>
      this.startForegroundAction(session, () =>
        session.runtimeResult.runtime.startManualHistoryCompaction(),
      ),
    );
  }

  private requireIdleForeground(session: ServerSession): void {
    const { runtime } = session.runtimeResult;
    if (
      runtime.isBusy() ||
      session.turnActive ||
      runtime.hasPendingApproval() ||
      runtime.hasPendingQuestions()
    ) {
      throw new Error("session is busy; wait for the current turn to finish");
    }
  }

  private async startForegroundAction<T>(
    session: ServerSession,
    action: () => Promise<T>,
  ): Promise<T> {
    this.requireIdleForeground(session);
    session.turnActive = true;
    session.idleTicksWhileActive = 0;
    session.info.isBusy = true;
    const generation = ++session.turnGeneration;
    try {
      return await action();
    } catch (error) {
      if (session.turnGeneration === generation) {
        session.turnActive = false;
        session.info.isBusy = false;
      }
      throw error;
    }
  }

  // ------------------------------------------------------- session config

  async setApprovalLevel(sessionId: string, level: ApprovalLevel): Promise<void> {
    const session = this.requireSession(sessionId);
    session.runtimeResult.setApprovalLevel(level);
    session.info.approvalLevel = level;
  }

  async setAgentMode(sessionId: string, mode: AgentMode): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.serializeSession(session, async () => {
      await session.runtimeResult.setAgentMode(mode);
      session.createParams.agentMode = mode;
      await session.runtimeResult.persist();
    });
  }

  setLoopEnabled(sessionId: string, enabled: boolean): void {
    const session = this.requireSession(sessionId);
    session.runtimeResult.setLoopEnabled(enabled);
  }

  async reset(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    session.turnGeneration += 1;
    session.runtimeResult.runtime.abort();
    await this.serializeSession(session, async () => {
      await session.runtimeResult.tasks.cancelOwnedWork();
      await session.runtimeResult.runtime.settlePendingTaskNotifications();
      for (const task of session.runtimeResult.tasks.records()) {
        if (task.terminalEventId && !task.notificationDelivered) {
          await session.runtimeResult.tasks.markNotified(task.id, { runtimeId: "main" });
        }
      }
      session.queue = [];
      session.turnActive = false;
      session.runtimeResult.runtime.replaceHistory([], { retainBackgroundHistory: false });
      session.runtimeResult.presentation.clear();
      session.runtimeResult.setActivePlanPath();
      session.info.isBusy = false;
      session.desktopTimeline = {
        revision: (session.desktopTimeline?.revision ?? 0) + 1,
        timeline: [],
        updatedAtUnixMs: Date.now(),
        presentationSequence: session.runtimeResult.presentation.snapshot().sequence,
      };
      // Match the legacy bridge's fresh-session semantics: todos reset with it.
      await createHostTodoStore({
        spiritDataDir: this.spiritDataDir,
        scope: { sessionKey: session.todoSessionKey },
      }).purge();
      await session.runtimeResult.persist({
        initialized: true,
        desktopTimeline: session.desktopTimeline,
      });
      this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
    });
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

  async replaceFromArchive(sessionId: string, archive: unknown): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.serializeSession(session, async () => {
      const { runtime } = session.runtimeResult;
      if (runtime.isBusy() || session.turnActive) {
        throw new Error("session is busy; cannot replace archive while a turn is active");
      }
      const importedTimeline =
        archive && typeof archive === "object" && "desktopMessageTimeline" in archive
          ? archive.desktopMessageTimeline
          : undefined;
      if (importedTimeline !== undefined && !Array.isArray(importedTimeline)) {
        throw new Error("desktop timeline must be an array");
      }
      await runtime.settlePendingTaskNotifications();
      runtime.replaceFromArchive(archive as never);
      session.runtimeResult.presentation.clear();
      session.runtimeResult.setActivePlanPath(
        extractActivePlanPathFromLlmHistory(runtime.history()),
      );
      // Import the matching UI baseline before any new journal events can arrive.
      session.desktopTimeline = importedTimeline
        ? {
            revision: (session.desktopTimeline?.revision ?? 0) + 1,
            timeline: structuredClone(importedTimeline),
            updatedAtUnixMs: Date.now(),
            presentationSequence: session.runtimeResult.presentation.snapshot().sequence,
          }
        : undefined;
      await session.runtimeResult.restoreTaskNotifications();
      await session.runtimeResult.persist({
        initialized: true,
        desktopTimeline: session.desktopTimeline ?? null,
      });
    });
  }

  exportArchive(sessionId: string, messages: unknown, assistantAux: unknown): unknown {
    const session = this.requireSession(sessionId);
    const archive = {
      ...session.runtimeResult.runtime.toArchive(messages as never, assistantAux as never),
      presentation: session.runtimeResult.presentation.snapshot(),
    };
    const stored = session.desktopTimeline;
    if (!stored) {
      return archive;
    }
    return {
      ...archive,
      desktopMessageTimeline: stored.timeline,
      desktopMessageTimelineRevision: stored.revision,
      desktopPresentationSequence: stored.presentationSequence ?? 0,
    };
  }

  /**
   * Store the authoritative desktop timeline pushed by a host client and
   * notify every attached client. Payload stays opaque; only the array shape
   * is enforced at this boundary.
   */
  async pushDesktopTimeline(
    sessionId: string,
    timeline: unknown,
    presentationSequence?: number,
  ): Promise<{ ok: true; revision: number }> {
    const session = this.requireSession(sessionId);
    if (!Array.isArray(timeline)) {
      throw new Error("desktop timeline must be an array");
    }
    if (presentationSequence === undefined) {
      throw new Error("A presentation cursor is required for a desktop timeline.");
    }
    return this.serializeSession(session, async () => {
      if (presentationSequence < (session.desktopTimeline?.presentationSequence ?? 0)) {
        throw new Error("The timeline is older than the saved presentation cursor.");
      }
      session.runtimeResult.presentation.acknowledge(presentationSequence);
      const revision = (session.desktopTimeline?.revision ?? 0) + 1;
      session.desktopTimeline = {
        revision,
        timeline,
        updatedAtUnixMs: Date.now(),
        presentationSequence,
      };
      await session.runtimeResult.persist({ desktopTimeline: session.desktopTimeline });
      this.callbacks.broadcastDesktopTimelineUpdated?.(sessionId, revision);
      return { ok: true, revision };
    });
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
    return this.serializeSession(session, () =>
      this.startForegroundAction(session, async () => {
        await session.runtimeResult.toolExecutor.refreshCaches();
        return session.runtimeResult.runtime.startApplyMcpPrompt(
          server,
          prompt,
          argsJson,
          userMessage,
        );
      }),
    );
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
        const session = this.requireSession(sessionId);
        return this.serializeSession(session, async () => {
          this.requireIdleForeground(session);
          const request = await toolExecutor.createMcpToolRequest(
            String(params["server"] ?? ""),
            String(params["tool"] ?? ""),
            typeof params["argsJson"] === "string" ? params["argsJson"] : undefined,
          );
          return runtime.startManualToolRequestDirect(request, "manual");
        });
      }
      default:
        throw new Error(`unknown mcp action: ${action}`);
    }
  }

  // -------------------------------------------------------- manual tools

  async startManualToolCommand(sessionId: string, message: string): Promise<unknown> {
    const session = this.requireSession(sessionId);
    return this.serializeSession(session, async () => {
      this.requireIdleForeground(session);
      const result = await session.runtimeResult.runtime.startManualToolCommand(message);
      return { result, snapshot: this.snapshot(sessionId) };
    });
  }

  async continuePendingManualToolApproval(
    sessionId: string,
    decision: unknown,
    requestId?: string,
  ): Promise<unknown> {
    const session = this.requireSession(sessionId);
    return this.serializeSession(session, async () => {
      const result = await session.runtimeResult.runtime.continuePendingManualToolApproval(
        decision as never,
        requestId,
      );
      return { result, snapshot: this.snapshot(sessionId) };
    });
  }

  takeCompletedManualToolCommandResult(sessionId: string): unknown {
    return (
      this.requireSession(sessionId).runtimeResult.runtime.takeCompletedManualToolCommandResult() ??
      null
    );
  }

  // ------------------------------------------------------------ subagents

  async subagentSessionArchive(
    sessionId: string,
    subagentSessionId: string,
    parentToolCallId?: string,
  ): Promise<RuntimeSubagentSessionArchiveEntry | null> {
    const parent = this.requireSession(sessionId);
    const archived = parent.runtimeResult.runtime.childSessionArchive(subagentSessionId);
    if (archived) return archived;
    const link = this.nativeSubagentLinksForTarget(subagentSessionId).find(
      (candidate) =>
        candidate.parentSessionId === sessionId &&
        (!parentToolCallId || candidate.parentToolCallId === parentToolCallId),
    );
    if (!link) return null;
    await this.resumeSession(subagentSessionId, parent.info.workspaceRoot, parent.info.hostKind);
    const target = this.requireSession(subagentSessionId);
    return this.nativeSubagentArchive(target, link);
  }

  subagentPendingAuxState(sessionId: string, subagentSessionId: string): unknown {
    const parent = this.requireSession(sessionId);
    const pending = parent.runtimeResult.runtime.childSessionPendingAuxState(subagentSessionId);
    if (pending) return pending;
    if (
      !this.nativeSubagentLinksForTarget(subagentSessionId).some(
        (candidate) => candidate.parentSessionId === sessionId,
      )
    )
      return null;
    return this.sessions.get(subagentSessionId)?.runtimeResult.runtime.pendingAuxState() ?? null;
  }

  private nativeSubagentLinksForTarget(targetSessionId: string): NativeSubagentLink[] {
    const links = new Map<string, NativeSubagentLink>(
      this.nativeSubagentLinks.get(targetSessionId) ?? [],
    );
    for (const parent of this.sessions.values()) {
      for (const task of parent.runtimeResult.runtime.backgroundTaskRecords()) {
        if (task.kind !== "subagent" || task.sessionId !== targetSessionId) continue;
        const key = `${parent.info.sessionId}\n${task.toolCallId}`;
        if (links.has(key)) continue;
        links.set(key, {
          parentSessionId: parent.info.sessionId,
          parentToolCallId: task.toolCallId,
          title: task.input.trim().slice(0, 72) || "SubAgent",
        });
      }
    }
    return [...links.values()].filter((link) => {
      const parent = this.sessions.get(link.parentSessionId);
      return parent && !parent.closing;
    });
  }

  private nativeSubagentArchive(
    target: ServerSession,
    link: NativeSubagentLink,
  ): RuntimeSubagentSessionArchiveEntry {
    const parent = this.requireSession(link.parentSessionId);
    const taskSummary = buildServerSnapshot(parent.runtimeResult).childSessions.find(
      (summary) =>
        summary.sessionId === target.info.sessionId &&
        summary.parentToolCallId === link.parentToolCallId,
    );
    const summary: RuntimeSubagentSessionSummary = taskSummary ?? {
      sessionId: target.info.sessionId,
      parentToolCallId: link.parentToolCallId,
      title: link.title,
      status: target.agentWriter?.blocked
        ? "blocked"
        : target.turnActive || target.runtimeResult.runtime.isBusy()
          ? "running"
          : "completed",
      startedAtUnixMs: Date.parse(target.info.createdAt),
      updatedAtUnixMs: Date.now(),
      ...(target.info.worktreePath ? { worktreePath: target.info.worktreePath } : {}),
      ...(target.info.worktreeBranch ? { worktreeBranch: target.info.worktreeBranch } : {}),
    };
    return {
      summary: { ...summary },
      llmHistory: [...target.runtimeResult.runtime.history()],
    };
  }

  private broadcastNativeSubagentEvents(
    target: ServerSession,
    events: RuntimeEvent<JsonValue>[],
  ): void {
    if (events.length === 0) return;
    for (const link of this.nativeSubagentLinksForTarget(target.info.sessionId)) {
      this.callbacks.broadcastSubagentEvents?.(link.parentSessionId, [
        {
          sessionId: target.info.sessionId,
          parentToolCallId: link.parentToolCallId,
          events,
          pendingAux: target.runtimeResult.runtime.pendingAuxState(),
          archive: this.nativeSubagentArchive(target, link),
        },
      ]);
    }
  }

  // ------------------------------------------------- config / hooks / mode

  /** Refresh foreground bindings while live tasks retain their original execution environment. */
  async replaceConfig(sessionId: string, modelRef?: ModelRef): Promise<void> {
    const session = this.requireSession(sessionId);
    session.runtimeResult.runtime.abort();
    await this.serializeSession(session, async () => {
      if (modelRef?.providerId?.trim() && modelRef?.name?.trim()) {
        session.createParams.modelRef = {
          providerId: modelRef.providerId.trim(),
          name: modelRef.name.trim(),
        };
      } else {
        delete session.createParams.modelRef;
      }
      const old = session.runtimeResult;
      const mode = session.createParams.agentMode ?? old.agentModeSnapshot();
      await old.runSessionEnd("switch");
      old.runtime.abort();
      const lastInputTokens = getTransportConfigLastInputTokens(old.transportConfig);

      const fresh = await old.reconfigure({
        workspaceRoot: session.createParams.workspaceRoot,
        spiritDataDir: this.spiritDataDir,
        sessionKey: old.sessionId,
        agentMode: mode,
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
        ...(lastInputTokens !== undefined ? { initialLastInputTokens: lastInputTokens } : {}),
        basicInfoHost: resolveBasicInfoHost(session.createParams),
        onEvent: (event, sequence) => this.handleRuntimeEvent(sessionId, event, sequence),
        onFileChange: (change) => this.callbacks.broadcastFileChange(sessionId, change),
        requestWorkspaceCapabilityTrust: (request) =>
          this.requestWorkspaceCapabilityTrust(sessionId, request),
        ...(this.callbacks.log ? { log: this.callbacks.log } : {}),
      });
      fresh.setLoopEnabled(old.runtime.loopEnabled());
      await fresh.setAgentMode(mode);
      this.attachDesktopMcpUiOpener(sessionId, fresh, session.createParams.hostKind);
      session.runtimeResult = fresh;
      session.info.model = fresh.transportConfig.model;
      await fresh.runSessionStart("resume");
      await fresh.persist();
      session.turnActive = false;
      session.info.isBusy = false;
      session.idleTicksWhileActive = 0;
      this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
      await this.drainQueue(session);
    });
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

  setWebToolExposure(
    sessionId: string,
    exposure: { webSearchEnabled?: boolean; webFetchEnabled?: boolean },
  ): void {
    this.requireSession(sessionId).runtimeResult.setWebToolExposure(exposure);
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
    requestId?: string,
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    if (!session.runtimeResult.runtime.currentPendingApproval(requestId)) {
      const target = [...this.sessions.values()].find(
        (candidate) =>
          candidate.agentWriter?.ownerSessionId === sessionId &&
          candidate.runtimeResult.runtime.currentPendingApproval(requestId),
      );
      if (target) {
        await target.runtimeResult.runtime.continuePendingApproval(decision, requestId);
        this.syncDelegatedInputState(target);
        this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
        return;
      }
    }
    // poll() can await an early-stream approval; its reply must not queue behind that poll.
    await session.runtimeResult.runtime.continuePendingApproval(decision, requestId);
    // approval-resolved mid-broadcast often sees isBusy=false (pending cleared, tool not
    // inFlight yet). Push again after continue so clients see the resumed busy edge —
    // same pattern as replyPendingQuestions.
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
  }

  resolveExtensionUi(sessionId: string, requestId: string, result: unknown): void {
    const pending = this.pendingExtensionUi.get(requestId);
    if (!pending || pending.sessionId !== sessionId) {
      return;
    }
    this.pendingExtensionUi.delete(requestId);
    pending.resolve({ kind: "opened", result });
  }

  pendingExtensionUiSessionId(requestId: string): string | undefined {
    return this.pendingExtensionUi.get(requestId)?.sessionId;
  }

  private attachDesktopMcpUiOpener(
    sessionId: string,
    runtimeResult: ServerRuntimeResult,
    hostKind: ServerClientKind,
  ): void {
    if (hostKind !== "desktop") {
      return;
    }
    runtimeResult.toolExecutor.setMcpUiOpener(this.createExtensionUiOpener(sessionId));
  }

  private createExtensionUiOpener(sessionId: string): McpUiOpener {
    return (request: McpUiOpenRequest) => {
      if (this.noClientsRemaining) {
        return Promise.resolve({ kind: "unavailable" as const, reason: "host-has-no-ui" });
      }
      return new Promise<McpUiOpenResult>((resolve) => {
        const requestId = randomUUID();
        this.pendingExtensionUi.set(requestId, { sessionId, resolve });
        this.callbacks.broadcastExtensionUiRequested?.(sessionId, {
          requestId,
          extensionId: request.extensionId,
          viewId: request.viewId,
          ...(request.params === undefined ? {} : { params: request.params }),
        });
      });
    };
  }

  private settleExtensionUiForSession(sessionId: string, result: McpUiOpenResult): void {
    for (const [requestId, pending] of this.pendingExtensionUi) {
      if (pending.sessionId !== sessionId) {
        continue;
      }
      this.pendingExtensionUi.delete(requestId);
      pending.resolve(result);
    }
  }

  async replyPendingQuestions(
    sessionId: string,
    result: Parameters<ServerRuntimeResult["runtime"]["continuePendingQuestions"]>[0],
    requestId?: string,
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    if (!session.runtimeResult.runtime.currentPendingQuestions(requestId)) {
      const target = [...this.sessions.values()].find(
        (candidate) =>
          candidate.agentWriter?.ownerSessionId === sessionId &&
          candidate.runtimeResult.runtime.currentPendingQuestions(requestId),
      );
      if (target) {
        await target.runtimeResult.runtime.continuePendingQuestions(result, requestId);
        this.syncDelegatedInputState(target);
        this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
        return;
      }
    }
    await session.runtimeResult.runtime.continuePendingQuestions(result, requestId);
    this.callbacks.broadcastSnapshot(sessionId, this.snapshotForSession(session));
  }

  private requestWorkspaceCapabilityTrust(
    sessionId: string,
    request: WorkspaceCapabilityTrustRequestPayload,
  ): Promise<WorkspaceCapabilityTrustDecision> {
    if (this.noClientsRemaining) return Promise.resolve("deny");
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
    this.noClientsRemaining = true;
    for (const session of this.sessions.values()) {
      this.denyUnattendedInputs(session);
    }
    for (const [requestId, pending] of this.pendingTrustRequests) {
      this.pendingTrustRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve("deny");
    }
    for (const [requestId, pending] of this.pendingExtensionUi) {
      this.pendingExtensionUi.delete(requestId);
      pending.resolve({ kind: "unavailable", reason: "host-has-no-ui" });
    }
  }

  private denyUnattendedInputs(session: ServerSession): void {
    const { sessionId } = session.info;
    if (session.closing || this.unattendedInputs.has(sessionId)) return;
    this.unattendedInputs.add(sessionId);
    void (async () => {
      const { runtime } = session.runtimeResult;
      while (this.noClientsRemaining && !session.closing) {
        const approval = runtime.currentPendingApproval();
        if (approval) {
          await this.replyPendingApproval(
            sessionId,
            {
              kind: "deny",
              resultText: "All clients disconnected.",
            },
            approval.requestId,
          );
          continue;
        }
        const questions = runtime.currentPendingQuestions();
        if (questions) {
          await this.replyPendingQuestions(sessionId, { status: "skipped" }, questions.requestId);
          continue;
        }
        break;
      }
    })()
      .catch((error) => {
        this.callbacks.log?.(
          `session ${sessionId}: unattended input failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.unattendedInputs.delete(sessionId));
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
    this.failAgentTurnWaiters(sessionId, new Error("The target session was closed."));
    delete session.agentWriter;
    session.closing = true;
    const conversationKey = session.info.conversationKey?.trim();
    if (conversationKey && this.conversationIndex.get(conversationKey) === sessionId) {
      this.conversationIndex.delete(conversationKey);
    }
    this.attachments.delete(sessionId);
    for (const [requestId, pending] of this.pendingTrustRequests) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingTrustRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve("deny");
    }
    this.settleExtensionUiForSession(sessionId, { kind: "unavailable", reason: "host-has-no-ui" });
    session.turnGeneration += 1;
    session.queue = [];
    clearInterval(session.pump);
    session.runtimeResult.runtime.abort();
    await this.serializeSession(session, () => session.runtimeResult.dispose(), true);
    this.sessions.delete(sessionId);
  }

  /** Aborts every session; called on daemon shutdown. */
  async shutdown(): Promise<void> {
    const disposals: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      session.closing = true;
      session.turnGeneration += 1;
      clearInterval(session.pump);
      session.runtimeResult.runtime.abort();
      disposals.push(this.serializeSession(session, () => session.runtimeResult.dispose(), true));
    }
    this.sessions.clear();
    this.conversationIndex.clear();
    this.attachments.clear();
    for (const [requestId, pending] of this.pendingTrustRequests) {
      this.pendingTrustRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve("deny");
    }
    for (const [requestId, pending] of this.pendingExtensionUi) {
      this.pendingExtensionUi.delete(requestId);
      pending.resolve({ kind: "unavailable", reason: "host-has-no-ui" });
    }
    const settled = await Promise.allSettled(disposals);
    const owner = await Promise.allSettled(
      this.taskOwner ? [this.taskOwner.then((value) => value.close())] : [],
    );
    this.taskOwner = undefined;
    const failures = [...settled, ...owner].flatMap((entry) =>
      entry.status === "rejected" ? [entry.reason] : [],
    );
    if (failures.length) throw new AggregateError(failures, "Daemon session shutdown failed.");
  }
}
