import { randomUUID } from "node:crypto";

import type {
  ChatArchive,
  JsonValue,
  LlmActiveSkill,
  LlmMessage,
  PendingAssistantAux,
  PendingMcpResource,
  PendingWorkspaceFile,
  RuntimeApprovalDecision,
  RuntimeEvent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
  RuntimeSubagentSessionArchiveEntry,
  RuntimeSubagentSessionSummary,
  RuntimeTurnResult,
} from "@spiritagent/agent-core";
import type { AskQuestionsResult } from "@spiritagent/agent-core";
import type { BridgeRuntimeSnapshot } from "@spiritagent/agent-core/host-bridge";
import type {
  WorkspaceCapabilityTrustDecision,
  WorkspaceCapabilityTrustRequest,
} from "@spiritagent/host-internal";
import type {
  ModelRef,
  HostDreamScope,
  HostDreamSourceSessionRef,
} from "@spiritagent/host-internal";
import { loadModelProfile } from "@spiritagent/host-internal";
import {
  connectOrSpawnServer,
  type ServerNotificationListener,
  type ServerRpcClient,
} from "@spiritagent/server/client";

import {
  parsePendingSubagentStatusText,
  stripSubagentSpinnerPrefix,
} from "../lib/subagent-display.js";
import type { DesktopToolRequest } from "./contracts.js";
import type { PersistedDesktopTimelineTurnSnapshot } from "./chat-schema.js";
import {
  buildDesktopToolDescriptionHints,
  buildDesktopUiMarkdownPromptSection,
} from "./desktop-ui-markdown-prompt.js";
import { sameWorkspaceRoot } from "./service-utils.js";

interface RemoteDesktopRuntimeInput {
  dataDir: string;
  workspaceRoot: string;
  modelRef: ModelRef;
  agentMode: "agent" | "plan" | "ask" | "debug";
  archive: ChatArchive;
  approvalLevel: "default" | "auto-approval" | "bypass-approval";
  todoSessionKey?: string;
  /** Resolved chat file path for multi-host session identity. */
  conversationKey?: string;
  sessionKind?: "default" | "dream-collector";
  dreamScope?: HostDreamScope;
  dreamSourceSession?: HostDreamSourceSessionRef;
  /** Desktop Web: `<basic_info>` host override with page URL. */
  basicInfoHost?: { kind: "Web"; url: string };
  onActivity?: () => void;
  onWorkspaceCapabilityTrustRequested?: (
    requestId: string,
    request: WorkspaceCapabilityTrustRequest,
  ) => void;
  onExtensionUiRequested?: (request: {
    requestId: string;
    extensionId: string;
    viewId: string;
    params?: unknown;
  }) => void;
  onRemoteUserTurnSubmitted?: (input: {
    text: string;
    explicitWorkspaceFiles: PendingWorkspaceFile[];
  }) => void;
  onFileChange?: (change: unknown) => void;
  onSessionTitleUpdated?: (sessionId: string, title: string) => void;
}

interface SessionCreateResult {
  sessionId: string;
}

interface SessionAttachResult {
  session: { sessionId: string; workspaceRoot: string; model: string };
  snapshot: BridgeRuntimeSnapshot;
}

interface SessionPollResult {
  snapshot: BridgeRuntimeSnapshot;
}

interface SessionTurnFinishedNotification {
  sessionId: string;
  stopReason: "completed" | "failed" | "cancelled";
  result?:
    | { kind: "completed"; assistantText: string; toolExecutions: unknown[] }
    | { kind: "failed"; error: string; toolExecutions: unknown[] };
}

const EMPTY_SNAPSHOT: BridgeRuntimeSnapshot = {
  pendingImagePaths: [],
  pendingMcpResources: [],
  hasPendingApproval: false,
  hasPendingManualApproval: false,
  hasPendingQuestions: false,
  childSessions: [],
  isBusy: false,
  loopEnabled: false,
  approvalLevel: "default",
};

let sharedClientPromise: Promise<ServerRpcClient> | undefined;

async function sharedDesktopServerClient(dataDir: string): Promise<ServerRpcClient> {
  if (!sharedClientPromise) {
    const connecting = connectOrSpawnServer({
      dataDir,
      forwardStderr: Boolean(process.env.VITE_DEV_SERVER_URL?.trim()),
    })
      .then(async ({ client }) => {
        await client.call("server.initialize", {
          clientKind: "desktop",
          clientId: `desktop-${process.pid}`,
        });
        client.onDisconnect(() => {
          if (sharedClientPromise === connecting) {
            sharedClientPromise = undefined;
          }
        });
        return client;
      })
      .catch((error) => {
        sharedClientPromise = undefined;
        throw error;
      });
    sharedClientPromise = connecting;
  }
  return sharedClientPromise;
}

/** Ask the daemon to re-read extension MCP into every live session. */
export async function notifyDesktopServerRefreshExtensions(dataDir: string): Promise<void> {
  try {
    const client = await sharedDesktopServerClient(dataDir);
    await client.call("host.refreshExtensions", {});
  } catch (error) {
    // Local extension mutation already succeeded; a down or unreachable daemon
    // must not fail install/enable/remove or skip the remaining local refresh.
    console.warn("[desktop-host] notifyDesktopServerRefreshExtensions failed", error);
  }
}

/** Close the process-wide daemon WebSocket so the server can idle-exit. */
export async function closeSharedDesktopServerClient(): Promise<void> {
  const pending = sharedClientPromise;
  sharedClientPromise = undefined;
  if (!pending) {
    return;
  }
  try {
    const client = await pending;
    client.close();
  } catch {
    // Connect/init may have failed; nothing left to close.
  }
}

function isConversationKeyAttachMiss(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no live session for conversationKey");
}

function isStaleDaemonWorkspaceAttach(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("stale daemon workspace for conversationKey")
  );
}

function isOpenRemoteAttachFallback(error: unknown): boolean {
  return isConversationKeyAttachMiss(error) || isStaleDaemonWorkspaceAttach(error);
}

function buildRemoteDesktopRuntime(
  client: ServerRpcClient,
  sessionId: string,
  input: Pick<
    RemoteDesktopRuntimeInput,
    | "archive"
    | "onActivity"
    | "onWorkspaceCapabilityTrustRequested"
    | "onExtensionUiRequested"
    | "onRemoteUserTurnSubmitted"
    | "onFileChange"
    | "onSessionTitleUpdated"
  >,
): RemoteDesktopRuntime {
  return new RemoteDesktopRuntime(
    client,
    sessionId,
    input.archive,
    input.onActivity,
    input.onWorkspaceCapabilityTrustRequested,
    input.onExtensionUiRequested,
    input.onRemoteUserTurnSubmitted,
    input.onFileChange,
    input.onSessionTitleUpdated,
  );
}

async function applyRemoteSessionPreferences(
  runtime: RemoteDesktopRuntime,
  input: Pick<
    RemoteDesktopRuntimeInput,
    "approvalLevel" | "todoSessionKey" | "archive" | "agentMode"
  >,
): Promise<void> {
  await runtime.clientCall("session.setApprovalLevel", { approvalLevel: input.approvalLevel });
  // When Attach reuses an existing daemon session, the mode must be re-synced; otherwise the UI/host config
  // has switched to Plan while the daemon still keeps the Agent from creation (no create_plan / system still says You are in Agent mode).
  await runtime.clientCall("session.setMode", { mode: input.agentMode });
  if (input.todoSessionKey?.trim()) {
    await runtime.clientCall("session.setTodoSessionKey", {
      sessionKey: input.todoSessionKey.trim(),
    });
  }
  if (typeof input.archive.loopEnabled === "boolean") {
    runtime.setLoopEnabled(input.archive.loopEnabled);
  }
}

function daemonSessionModelDiffersFromRef(
  spiritDataDir: string,
  requested: ModelRef,
  daemonModel: string,
): boolean {
  const profile = loadModelProfile(spiritDataDir, requested);
  if (!profile) {
    return true;
  }
  return profile.name !== daemonModel;
}

async function syncDaemonSessionModelIfNeeded(
  client: Awaited<ReturnType<typeof sharedDesktopServerClient>>,
  input: Pick<RemoteDesktopRuntimeInput, "dataDir" | "modelRef">,
  attached: SessionAttachResult,
): Promise<SessionAttachResult> {
  if (!daemonSessionModelDiffersFromRef(input.dataDir, input.modelRef, attached.session.model)) {
    return attached;
  }
  await client.call("session.replaceConfig", {
    sessionId: attached.session.sessionId,
    modelRef: input.modelRef,
  });
  const polled = await client.call<SessionPollResult>("session.poll", {
    sessionId: attached.session.sessionId,
  });
  const profile = loadModelProfile(input.dataDir, input.modelRef);
  return {
    session: {
      ...attached.session,
      model: profile?.name ?? attached.session.model,
    },
    snapshot: polled.snapshot,
  };
}

export async function attachRemoteDesktopRuntime(
  input: RemoteDesktopRuntimeInput & { conversationKey: string },
): Promise<RemoteDesktopRuntime> {
  const client = await sharedDesktopServerClient(input.dataDir);
  const attached = await client.call<SessionAttachResult>("session.attach", {
    conversationKey: input.conversationKey,
  });
  const synced = await syncDaemonSessionModelIfNeeded(client, input, attached);
  const daemonWorkspaceRoot = synced.session.workspaceRoot?.trim();
  if (daemonWorkspaceRoot && !sameWorkspaceRoot(daemonWorkspaceRoot, input.workspaceRoot)) {
    await client.call("session.close", { sessionId: synced.session.sessionId });
    throw new Error(`stale daemon workspace for conversationKey: ${input.conversationKey}`);
  }
  const runtime = buildRemoteDesktopRuntime(client, synced.session.sessionId, input);
  try {
    await runtime.initializeFromSnapshot(synced.snapshot);
    await applyRemoteSessionPreferences(runtime, input);
    return runtime;
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

export async function createRemoteDesktopRuntime(
  input: RemoteDesktopRuntimeInput,
): Promise<RemoteDesktopRuntime> {
  const client = await sharedDesktopServerClient(input.dataDir);
  const created = await client.call<SessionCreateResult>("session.create", {
    workspaceRoot: input.workspaceRoot,
    modelRef: input.modelRef,
    agentMode: input.agentMode,
    approvalLevel: input.approvalLevel,
    ...(input.todoSessionKey ? { todoSessionKey: input.todoSessionKey } : {}),
    ...(input.conversationKey ? { conversationKey: input.conversationKey } : {}),
    ...(input.sessionKind === "dream-collector" ? { sessionKind: "dream-collector" } : {}),
    ...(input.dreamScope ? { dreamScope: input.dreamScope } : {}),
    ...(input.dreamSourceSession ? { dreamSourceSession: input.dreamSourceSession } : {}),
    ...(input.sessionKind === "dream-collector"
      ? {}
      : {
          hostUiPromptSection: buildDesktopUiMarkdownPromptSection(),
          hostToolDescriptionHints: buildDesktopToolDescriptionHints(),
        }),
    ...(input.basicInfoHost ? { basicInfoHost: input.basicInfoHost } : {}),
  });
  await client.call("session.attach", { sessionId: created.sessionId });
  const runtime = buildRemoteDesktopRuntime(client, created.sessionId, input);
  try {
    await runtime.initialize();
    return runtime;
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

/** Attach an existing live session, or create and hydrate when none is registered. */
export async function openRemoteDesktopRuntime(
  input: RemoteDesktopRuntimeInput & { conversationKey: string },
): Promise<RemoteDesktopRuntime> {
  try {
    return await attachRemoteDesktopRuntime(input);
  } catch (error) {
    if (!isOpenRemoteAttachFallback(error)) {
      throw error;
    }
  }
  return createRemoteDesktopRuntime(input);
}

export class RemoteDesktopRuntime {
  private snapshot: BridgeRuntimeSnapshot = { ...EMPTY_SNAPSHOT };
  private archive: ChatArchive;
  private events: RuntimeEvent<DesktopToolRequest>[] = [];
  private completedTurnResult: RuntimeTurnResult<unknown, DesktopToolRequest> | undefined;
  private pendingAssistantTextStore = "";
  private thinkingTextStore = "";
  private compactionTextStore = "";
  private pendingStartedAtStore: number | undefined;
  private pendingLastEventAtStore: number | undefined;
  private streamChunkCounterStore = 0;
  /** True after begin-assistant-response until remove-pending / turn completed. */
  private liveReasoningAwaitingDetail = false;
  private thinkingSpinnerIndexStore = 0;
  private archiveMessages: ChatArchive["messages"];
  private archiveAssistantAux: ChatArchive["assistantAux"];
  private childEventDrains: Array<{
    sessionId: string;
    parentToolCallId: string;
    events: RuntimeEvent<DesktopToolRequest>[];
  }> = [];
  private readonly childPendingAux = new Map<string, PendingAssistantAux>();
  private archiveRefreshPromise: Promise<void> | undefined;
  private readonly unsubscribe: () => void;
  private notificationListenerDropped = false;
  private readonly pendingLocalClientTurnIds = new Set<string>();
  private mutationTail: Promise<void> = Promise.resolve();
  private mutationError: unknown;
  /** Serializes timeline pushes; failures are logged and never poison the chain. */
  private timelinePushTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: ServerRpcClient,
    readonly sessionId: string,
    archive: ChatArchive,
    private readonly onActivity?: () => void,
    private readonly onWorkspaceCapabilityTrustRequested?: (
      requestId: string,
      request: WorkspaceCapabilityTrustRequest,
    ) => void,
    private readonly onExtensionUiRequested?: (request: {
      requestId: string;
      extensionId: string;
      viewId: string;
      params?: unknown;
    }) => void,
    private readonly onRemoteUserTurnSubmitted?: (input: {
      text: string;
      explicitWorkspaceFiles: PendingWorkspaceFile[];
    }) => void,
    private readonly onFileChange?: (change: unknown) => void,
    private readonly onSessionTitleUpdated?: (sessionId: string, title: string) => void,
  ) {
    this.archive = structuredClone(archive);
    this.archiveMessages = structuredClone(archive.messages);
    this.archiveAssistantAux = structuredClone(archive.assistantAux);
    const listener: ServerNotificationListener = (notification) => {
      this.handleNotification(notification.method, notification.params);
    };
    this.unsubscribe = client.onNotification(listener);
  }

  async initialize(): Promise<void> {
    if (this.archive.llmHistory.length > 0 || (this.archive.subagentSessions?.length ?? 0) > 0) {
      await this.client.call("session.replaceFromArchive", {
        sessionId: this.sessionId,
        archive: this.archive,
      });
    }
    const result = await this.client.call<SessionPollResult>("session.poll", {
      sessionId: this.sessionId,
    });
    await this.initializeFromSnapshot(result.snapshot);
  }

  async initializeFromSnapshot(snapshot: BridgeRuntimeSnapshot): Promise<void> {
    this.snapshot = snapshot;
    await this.refreshArchive();
  }

  private dropNotificationListener(): void {
    if (this.notificationListenerDropped) {
      return;
    }
    this.notificationListenerDropped = true;
    this.unsubscribe();
  }

  /** Drop notification subscription only; keeps daemon attachment (wrapper swap). */
  async dispose(): Promise<void> {
    this.dropNotificationListener();
    await this.awaitMutations();
    await this.timelinePushTail;
  }

  async close(): Promise<void> {
    this.dropNotificationListener();
    await this.awaitMutations();
    await this.timelinePushTail;
    await this.client.call("session.detach", { sessionId: this.sessionId });
  }

  /**
   * Best-effort push of the authoritative desktop timeline snapshot. Pushes
   * stay ordered per session; a failed push is logged and dropped (the next
   * persist boundary re-pushes a full snapshot, so nothing needs a retry).
   */
  pushDesktopTimeline(timeline: PersistedDesktopTimelineTurnSnapshot[]): void {
    this.timelinePushTail = this.timelinePushTail.then(async () => {
      try {
        await this.client.call("session.pushDesktopTimeline", {
          sessionId: this.sessionId,
          timeline,
        });
      } catch (error) {
        console.warn("[desktop-host] pushDesktopTimeline failed", error);
      }
    });
  }

  async clientCall(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.client.call(method, { sessionId: this.sessionId, ...params });
  }

  needsProjection(): boolean {
    return this.events.length > 0 || this.completedTurnResult !== undefined;
  }

  async startUserTurnStreaming(
    text: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
    activeSkills: LlmActiveSkill[] = [],
  ): Promise<void> {
    await this.awaitMutations();
    this.snapshot = { ...this.snapshot, isBusy: true };
    this.pendingStartedAtStore = Date.now();
    const clientTurnId = randomUUID();
    this.pendingLocalClientTurnIds.add(clientTurnId);
    try {
      await this.client.call("session.submitUserTurn", {
        sessionId: this.sessionId,
        clientTurnId,
        text,
        explicitImages,
        explicitWorkspaceFiles,
        activeSkills,
      });
    } catch (error) {
      this.pendingLocalClientTurnIds.delete(clientTurnId);
      throw error;
    }
  }

  async continueAssistantCompletionStreaming(): Promise<void> {
    await this.awaitMutations();
    this.snapshot = { ...this.snapshot, isBusy: true };
    await this.client.call("session.continueAssistantCompletion", { sessionId: this.sessionId });
  }

  async startManualHistoryCompaction(): Promise<void> {
    await this.awaitMutations();
    this.snapshot = { ...this.snapshot, isBusy: true };
    await this.client.call("session.compactHistory", { sessionId: this.sessionId });
  }

  async continuePendingApproval(decision: RuntimeApprovalDecision): Promise<void> {
    await this.awaitMutations();
    await this.client.call("session.replyPendingApproval", {
      sessionId: this.sessionId,
      decision,
    });
  }

  async continuePendingQuestions(result: AskQuestionsResult): Promise<void> {
    await this.awaitMutations();
    await this.client.call("session.replyPendingQuestions", {
      sessionId: this.sessionId,
      result,
    });
  }

  async poll(): Promise<void> {
    await this.awaitMutations();
    await this.archiveRefreshPromise;
  }

  abort(): void {
    this.snapshot = { ...this.snapshot, isBusy: false };
    this.enqueueMutation("session.abort", {});
  }

  replaceFromArchive(archive: ChatArchive): void {
    this.archive = structuredClone(archive);
    this.archiveMessages = structuredClone(archive.messages);
    this.archiveAssistantAux = structuredClone(archive.assistantAux);
    this.enqueueMutation("session.replaceFromArchive", {
      archive,
    });
  }

  replaceHistory(history: ChatArchive["llmHistory"]): void {
    this.replaceFromArchive({ ...this.archive, llmHistory: structuredClone(history) });
  }

  toArchive(
    messages: ChatArchive["messages"],
    assistantAux: ChatArchive["assistantAux"],
  ): ChatArchive {
    this.archiveMessages = structuredClone(messages);
    this.archiveAssistantAux = structuredClone(assistantAux);
    return {
      ...structuredClone(this.archive),
      messages: structuredClone(messages),
      assistantAux: structuredClone(assistantAux),
      loopEnabled: this.snapshot.loopEnabled,
    };
  }

  history(): readonly LlmMessage[] {
    return this.archive.llmHistory as readonly LlmMessage[];
  }

  requestTrace(): readonly JsonValue[] {
    return [];
  }

  drainEvents(): RuntimeEvent<DesktopToolRequest>[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  takeCompletedTurnResult(): RuntimeTurnResult<unknown, DesktopToolRequest> | undefined {
    const result = this.completedTurnResult;
    this.completedTurnResult = undefined;
    return result;
  }

  takeCompletedManualHistoryCompactionResult(): undefined {
    return undefined;
  }

  tickThinkingSpinner(): void {
    if (this.snapshot.isBusy) {
      this.thinkingSpinnerIndexStore = (this.thinkingSpinnerIndexStore + 1) % 4;
      return;
    }
    this.thinkingSpinnerIndexStore = 0;
  }

  isBusy(): boolean {
    return this.snapshot.isBusy;
  }

  loopEnabled(): boolean {
    return this.snapshot.loopEnabled;
  }

  setLoopEnabled(enabled: boolean): void {
    this.snapshot = { ...this.snapshot, loopEnabled: enabled };
    this.archive = { ...this.archive, loopEnabled: enabled };
    this.enqueueMutation("session.setLoopEnabled", { enabled });
  }

  hasPendingApproval(): boolean {
    return this.snapshot.hasPendingApproval;
  }

  hasPendingQuestions(): boolean {
    return this.snapshot.hasPendingQuestions;
  }

  currentPendingApproval(): RuntimePendingApproval<DesktopToolRequest> | undefined {
    return this.snapshot.currentPendingApproval as
      | RuntimePendingApproval<DesktopToolRequest>
      | undefined;
  }

  currentPendingQuestions(): RuntimePendingQuestions<DesktopToolRequest> | undefined {
    return this.snapshot.currentPendingQuestions as
      | RuntimePendingQuestions<DesktopToolRequest>
      | undefined;
  }

  pendingUserTurn(): string | undefined {
    return this.snapshot.pendingUserTurn;
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

  expectLiveReasoningPlaceholder(): void {
    if (
      this.snapshot.isBusy &&
      !this.snapshot.hasPendingApproval &&
      !this.snapshot.hasPendingQuestions
    ) {
      this.liveReasoningAwaitingDetail = true;
    }
  }

  pendingAuxState(): PendingAssistantAux | undefined {
    const snapshotAux = this.snapshot.pendingAuxState;
    if (snapshotAux && parsePendingSubagentStatusText(snapshotAux.statusText)) {
      const status = stripSubagentSpinnerPrefix(snapshotAux.statusText);
      return {
        ...snapshotAux,
        statusText: `${this.thinkingSpinnerFrame()} ${status}`,
      };
    }
    return this.synthesizeLocalPendingAux(snapshotAux) ?? snapshotAux;
  }

  private thinkingSpinnerFrame(): string {
    return ["|", "/", "-", "\\"][this.thinkingSpinnerIndexStore] ?? "|";
  }

  /**
   * Daemon pushes session.snapshot only at approval/turn boundaries, not on
   * begin-assistant-response. Synthesize the live Thinking… aux locally so
   * empty pending assistant rows stay visible until thinking chunks arrive.
   */
  private synthesizeLocalPendingAux(
    snapshotAux: PendingAssistantAux | undefined,
  ): PendingAssistantAux | undefined {
    if (!this.snapshot.isBusy) {
      return undefined;
    }
    if (this.snapshot.hasPendingApproval || this.snapshot.hasPendingQuestions) {
      return undefined;
    }

    const frame = this.thinkingSpinnerFrame();
    const compaction = this.compactionTextStore.trim();
    if (compaction) {
      return {
        kind: "compacting",
        statusText: `${frame} Compacting…`,
        detailText: compaction,
      };
    }

    const thinking = this.thinkingTextStore.trim();
    if (thinking) {
      return {
        kind: "thinking",
        statusText: `${frame} Thinking…`,
        detailText: thinking,
      };
    }

    if (!this.liveReasoningAwaitingDetail) {
      return undefined;
    }

    const kind = snapshotAux?.kind === "compacting" ? "compacting" : "thinking";
    return {
      kind,
      statusText: kind === "thinking" ? `${frame} Thinking…` : `${frame} Compacting…`,
    };
  }

  pendingImagePaths(): readonly string[] {
    return this.snapshot.pendingImagePaths;
  }

  pendingMcpResources(): readonly PendingMcpResource[] {
    return this.snapshot.pendingMcpResources;
  }

  backgroundToolStatus(): string | undefined {
    return this.snapshot.backgroundToolStatus;
  }

  childSessions(): readonly RuntimeSubagentSessionSummary[] {
    return this.snapshot.childSessions;
  }

  childSessionArchives(): readonly RuntimeSubagentSessionArchiveEntry[] {
    return (this.archive.subagentSessions ?? []) as RuntimeSubagentSessionArchiveEntry[];
  }

  childSessionArchive(sessionId: string): RuntimeSubagentSessionArchiveEntry | undefined {
    return this.childSessionArchives().find((entry) => entry.summary.sessionId === sessionId);
  }

  childSessionPendingAuxState(sessionId: string): PendingAssistantAux | undefined {
    return this.childPendingAux.get(sessionId);
  }

  drainActiveChildSessionEvents(): Array<{
    sessionId: string;
    parentToolCallId: string;
    events: RuntimeEvent<DesktopToolRequest>[];
  }> {
    const drains = this.childEventDrains;
    this.childEventDrains = [];
    return drains;
  }

  private handleNotification(method: string, rawParams: unknown): void {
    if (!rawParams || typeof rawParams !== "object") {
      return;
    }
    const params = rawParams as Record<string, unknown>;
    if (params["sessionId"] !== this.sessionId) {
      return;
    }
    if (method === "runtime.event") {
      const event = params["event"] as RuntimeEvent<DesktopToolRequest>;
      if (event) {
        this.applyRuntimeEvent(event);
        this.events.push(event);
        this.onActivity?.();
      }
      return;
    }
    if (method === "session.userTurnSubmitted" && typeof params["text"] === "string") {
      const clientTurnId =
        typeof params["clientTurnId"] === "string" ? params["clientTurnId"] : undefined;
      this.archive.llmHistory.push({
        role: "user",
        content: params["text"],
        imagePaths: [],
      });
      if (clientTurnId && this.pendingLocalClientTurnIds.delete(clientTurnId)) {
        return;
      }
      this.onRemoteUserTurnSubmitted?.({
        text: params["text"],
        explicitWorkspaceFiles: Array.isArray(params["explicitWorkspaceFiles"])
          ? (params["explicitWorkspaceFiles"] as PendingWorkspaceFile[])
          : [],
      });
      this.onActivity?.();
      return;
    }
    if (method === "session.snapshot" && params["snapshot"]) {
      const incoming = params["snapshot"] as BridgeRuntimeSnapshot;
      this.snapshot = { ...incoming };
      this.onActivity?.();
      return;
    }
    if (method === "session.turnFinished") {
      this.applyTurnFinished(params as unknown as SessionTurnFinishedNotification);
      this.onActivity?.();
      return;
    }
    if (method === "session.fileChanged") {
      this.onFileChange?.(params["change"]);
      return;
    }
    if (method === "session.titleUpdated" && typeof params["title"] === "string") {
      this.onSessionTitleUpdated?.(this.sessionId, params["title"]);
      this.onActivity?.();
      return;
    }
    if (method === "session.subagentEvents" && Array.isArray(params["drains"])) {
      let archivesChanged = false;
      for (const rawDrain of params["drains"]) {
        if (!rawDrain || typeof rawDrain !== "object") {
          continue;
        }
        const drain = rawDrain as Record<string, unknown>;
        const childSessionId = typeof drain["sessionId"] === "string" ? drain["sessionId"] : "";
        const parentToolCallId =
          typeof drain["parentToolCallId"] === "string" ? drain["parentToolCallId"] : "";
        if (!childSessionId || !parentToolCallId) {
          continue;
        }
        if (drain["pendingAux"]) {
          this.childPendingAux.set(childSessionId, drain["pendingAux"] as PendingAssistantAux);
        } else {
          this.childPendingAux.delete(childSessionId);
        }
        if (drain["archive"] && typeof drain["archive"] === "object") {
          archivesChanged =
            this.upsertChildSessionArchive(
              drain["archive"] as RuntimeSubagentSessionArchiveEntry,
            ) || archivesChanged;
        }
        const events = Array.isArray(drain["events"])
          ? (drain["events"] as RuntimeEvent<DesktopToolRequest>[])
          : [];
        if (events.length > 0) {
          this.childEventDrains.push({ sessionId: childSessionId, parentToolCallId, events });
        }
      }
      if (archivesChanged) {
        this.syncChildSessionSummariesFromArchives();
      }
      this.onActivity?.();
      return;
    }
    if (
      method === "workspace.trustRequested" &&
      typeof params["requestId"] === "string" &&
      params["request"]
    ) {
      this.onWorkspaceCapabilityTrustRequested?.(
        params["requestId"],
        params["request"] as WorkspaceCapabilityTrustRequest,
      );
      this.onActivity?.();
      return;
    }
    if (
      method === "session.extensionUiRequested" &&
      typeof params["requestId"] === "string" &&
      typeof params["extensionId"] === "string" &&
      typeof params["viewId"] === "string"
    ) {
      this.onExtensionUiRequested?.({
        requestId: params["requestId"],
        extensionId: params["extensionId"],
        viewId: params["viewId"],
        ...(params["params"] === undefined ? {} : { params: params["params"] }),
      });
      this.onActivity?.();
    }
  }

  private applyRuntimeEvent(event: RuntimeEvent<DesktopToolRequest>): void {
    this.pendingLastEventAtStore = Date.now();
    switch (event.kind) {
      case "begin-assistant-response":
        this.pendingAssistantTextStore = "";
        this.thinkingTextStore = "";
        this.compactionTextStore = "";
        this.streamChunkCounterStore = 0;
        this.liveReasoningAwaitingDetail = true;
        break;
      case "assistant-chunk":
        this.pendingAssistantTextStore += event.text;
        this.streamChunkCounterStore += 1;
        break;
      case "replace-pending-assistant":
        this.pendingAssistantTextStore = event.text;
        break;
      case "update-pending-assistant-thinking":
        this.thinkingTextStore = event.text;
        break;
      case "assistant-thinking-segment-finalized":
        // Align with the embedded runtime (agent-core runtime/streaming.ts): clear the staging buffer as
        // soon as thinking finalizes, otherwise synthesizeLocalPendingAux reuses the previous thinking segment as the next placeholder detailText.
        this.thinkingTextStore = "";
        break;
      case "remove-pending-assistant":
        this.liveReasoningAwaitingDetail = false;
        break;
      case "assistant-response-completed":
        this.liveReasoningAwaitingDetail = false;
        break;
      case "update-pending-assistant-compaction":
        this.compactionTextStore = event.text;
        break;
      case "approval-requested":
        this.snapshot = {
          ...this.snapshot,
          hasPendingApproval: true,
          currentPendingApproval: event.approval as never,
        };
        break;
      case "questions-requested":
        this.snapshot = {
          ...this.snapshot,
          hasPendingQuestions: true,
          currentPendingQuestions: event.questions as never,
        };
        break;
      case "approval-resolved":
        this.snapshot = {
          ...this.snapshot,
          hasPendingApproval: false,
          currentPendingApproval: undefined,
        };
        break;
      default:
        break;
    }
  }

  private applyTurnFinished(params: SessionTurnFinishedNotification): void {
    this.liveReasoningAwaitingDetail = false;
    this.snapshot = { ...this.snapshot, isBusy: false };
    const result = params.result;
    if (result?.kind === "completed") {
      this.completedTurnResult = {
        kind: "completed",
        assistantText: result.assistantText,
        state: undefined,
        requestTrace: [],
        toolExecutions: result.toolExecutions as never,
        compactions: [],
      };
    } else if (result?.kind === "failed") {
      this.completedTurnResult = {
        kind: "failed",
        error: result.error,
        requestTrace: [],
        toolExecutions: result.toolExecutions as never,
        compactions: [],
      };
    }
    this.archiveRefreshPromise = this.refreshArchive().finally(() => {
      this.archiveRefreshPromise = undefined;
    });
  }

  private async refreshArchive(): Promise<void> {
    this.archive = await this.client.call<ChatArchive>("session.exportArchive", {
      sessionId: this.sessionId,
      messages: this.archiveMessages,
      assistantAux: this.archiveAssistantAux,
    });
    this.syncChildSessionSummariesFromArchives();
  }

  /**
   * Busy turns do not push full archives via session.snapshot; Desktop opens the
   * SubAgent viewer from childSessionArchives(). Call before setSubagentViewerTarget
   * so mid-turn clicks can resolve the child session.
   */
  async ensureChildSessionArchivesFresh(): Promise<void> {
    await this.awaitMutations();
    if (this.archiveRefreshPromise) {
      await this.archiveRefreshPromise;
      return;
    }
    this.archiveRefreshPromise = this.refreshArchive().finally(() => {
      this.archiveRefreshPromise = undefined;
    });
    await this.archiveRefreshPromise;
  }

  private upsertChildSessionArchive(entry: RuntimeSubagentSessionArchiveEntry): boolean {
    const sessionId = entry.summary?.sessionId?.trim();
    if (!sessionId) {
      return false;
    }
    const sessions = [
      ...(this.archive.subagentSessions ?? []),
    ] as RuntimeSubagentSessionArchiveEntry[];
    const index = sessions.findIndex((session) => session.summary.sessionId === sessionId);
    if (index >= 0) {
      sessions[index] = structuredClone(entry);
    } else {
      sessions.push(structuredClone(entry));
    }
    this.archive = {
      ...this.archive,
      subagentSessions: sessions as ChatArchive["subagentSessions"],
    };
    return true;
  }

  private syncChildSessionSummariesFromArchives(): void {
    const sessions = (this.archive.subagentSessions ?? []) as RuntimeSubagentSessionArchiveEntry[];
    this.snapshot = {
      ...this.snapshot,
      childSessions: sessions.map((entry) => ({ ...entry.summary })),
    };
  }

  private enqueueMutation(method: string, params: Record<string, unknown>): void {
    const operation = this.mutationTail.then(async () => {
      await this.clientCall(method, params);
    });
    this.mutationTail = operation.catch((error) => {
      this.mutationError = error;
    });
  }

  private async awaitMutations(): Promise<void> {
    await this.mutationTail;
    if (this.mutationError !== undefined) {
      const error = this.mutationError;
      this.mutationError = undefined;
      throw error;
    }
  }
}

export function remoteDesktopSessionId(runtime: unknown): string | undefined {
  if (!runtime || typeof runtime !== "object") {
    return undefined;
  }
  const sessionId = (runtime as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" ? sessionId : undefined;
}

export async function migrateRemoteConversationKey(
  runtime: unknown,
  nextConversationKey: string,
): Promise<void> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return;
  }
  await runtime.clientCall("session.migrateConversationKey", {
    conversationKey: nextConversationKey,
  });
}

export async function disposeRemoteDesktopRuntime(runtime: unknown): Promise<void> {
  if (runtime instanceof RemoteDesktopRuntime) {
    await runtime.dispose();
  }
}

export async function closeRemoteDesktopRuntime(runtime: unknown): Promise<void> {
  if (runtime instanceof RemoteDesktopRuntime) {
    await runtime.close();
  }
}

export function remoteDesktopRuntimeNeedsProjection(runtime: unknown): boolean {
  return runtime instanceof RemoteDesktopRuntime && runtime.needsProjection();
}

export async function ensureRemoteChildSessionArchivesFresh(runtime: unknown): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.ensureChildSessionArchivesFresh();
  return true;
}

export async function abortRemoteDesktopShell(
  runtime: unknown,
  toolCallId: string,
): Promise<boolean | undefined> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return undefined;
  }
  const result = (await runtime.clientCall("session.abortShell", { toolCallId })) as {
    aborted?: boolean;
  };
  return result.aborted === true;
}

export async function exportRemoteDesktopState(runtime: unknown): Promise<
  | {
      apiMessages: unknown[];
      requestTrace: unknown[];
      systemPrompts: Record<string, unknown>;
    }
  | undefined
> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return undefined;
  }
  return runtime.clientCall("session.exportState", {}) as Promise<{
    apiMessages: unknown[];
    requestTrace: unknown[];
    systemPrompts: Record<string, unknown>;
  }>;
}

export async function setRemoteDesktopApprovalLevel(
  runtime: unknown,
  approvalLevel: "default" | "auto-approval" | "bypass-approval",
): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.clientCall("session.setApprovalLevel", { approvalLevel });
  return true;
}

export async function runRemoteDesktopSessionStart(
  runtime: unknown,
  source: "startup" | "resume" | "open",
): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.clientCall("session.runSessionStart", { source });
  return true;
}

export async function runRemoteDesktopSessionEnd(
  runtime: unknown,
  reason: "abort" | "close" | "switch",
): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.clientCall("session.runSessionEnd", { reason });
  return true;
}

export async function replyRemoteExtensionUi(
  runtime: unknown,
  requestId: string,
  result: unknown,
): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.clientCall("session.resolveExtensionUi", { requestId, result });
  return true;
}

export async function replyRemoteWorkspaceCapabilityTrust(
  runtime: unknown,
  requestId: string,
  decision: WorkspaceCapabilityTrustDecision,
): Promise<boolean> {
  if (!(runtime instanceof RemoteDesktopRuntime)) {
    return false;
  }
  await runtime.clientCall("session.replyWorkspaceCapabilityTrust", { requestId, decision });
  return true;
}
