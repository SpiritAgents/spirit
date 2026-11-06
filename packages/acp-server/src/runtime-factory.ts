import { release as osRelease } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  AgentRuntime,
  SessionTaskManager,
  isBackgroundTaskTerminal,
  type AgentRuntimeOptions,
  createLlmTransport,
  setTransportConfigLastInputTokens,
  pendingWorkspaceFilesFromInput,
  type LlmTransportConfig,
  type LlmMessage,
  type JsonValue,
  type RuntimeEvent,
  type GeneratedImageSaveRequest,
} from "@spiritagent/agent-core";
import {
  startLlmToolAgentState,
  continueLlmToolAgentState,
  appendLlmToolResultMessage,
  appendLlmUserMessage,
  appendLlmUserLlmMessage,
  extractLastLlmAssistantText,
  assistantToolCallMessageFromLlmState,
  finalAssistantHistoryMessageFromLlmState,
  truncateLlmToolAgentStateForContextRetry,
  truncateLlmHistoryForCompaction,
  rebuildLlmToolAgentStateAfterCompaction,
  type LlmToolAgentState,
  type LlmToolAgentBasicInfo,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmPlanMetadata,
} from "@spiritagent/agent-core";
import { buildApplyPatchFileToolsPromptSection } from "@spiritagent/agent-core";
import type { AgentMode } from "@spiritagent/agent-core";
import type { LocalHostToolService } from "@spiritagent/agent-core/host-bridge";
import { HostToolExecutorProxy } from "@spiritagent/agent-core/host-bridge";

import {
  NodeHostToolService,
  createHostExtensionManager,
  createNoopMcpAdapter,
  createHostMcpService,
  ensureBuiltInSkills,
  ensurePersonalMarketplace,
  loadHostInstructionMetadata,
  overlayEnabledExtensionRulesAndSkills,
  ensureTranscriptSessionDir,
  persistSessionTranscript,
  persistSubagentTranscript,
  persistToolOutputArchive,
  readGitBranchLabelForBasicInfo,
  resolveSubagentTranscriptFilePath,
  resolveTranscriptSessionDir,
  createBackgroundTaskOwner,
  type BackgroundTaskOwner,
  FileBackgroundTaskStore,
  isBackgroundTaskOwnerAlive,
  ensureSessionStorageKey,
  readSessionStorageKey,
  RuntimeSessionStore,
  acquireRuntimeSessionLease,
  type RuntimeSessionLease,
  createSubagentWorkspaceBootstrap,
} from "@spiritagent/host-internal";

import { createNoopPeer } from "./noop-peer.js";
import { tryResolveTransportConfig } from "@spiritagent/host-internal";
import type { AcpServerConfig } from "./types.js";

export type AcpHostRuntime = AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue>;

export interface AcpRuntimeResult {
  runtime: AcpHostRuntime;
  toolExecutor: HostToolExecutorProxy;
  sessionKind?: "default" | "dream-collector" | "subagent";
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
  enabledRules: LlmEnabledRule[];
  enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  planMetadata: LlmPlanMetadata | undefined;
  /** Mutable array reference — mutations are seen by state factory closures */
  activeSkills: LlmActiveSkill[];
  /** Switch agent mode: updates tool exposure + planMetadata seen by closures */
  setAgentMode: (mode: AgentMode) => Promise<void>;
  agentModeSnapshot(): AgentMode;
  tasks: SessionTaskManager;
  storageSessionKey: string;
  restoredFromDisk: boolean;
  persist(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createAcpRuntime(
  config: AcpServerConfig,
  onEvent: (event: RuntimeEvent<JsonValue>) => void,
  initialMode: AgentMode = "agent",
  transcriptSessionKey = `acp_${randomUUID()}`,
  options: {
    taskOwner?: BackgroundTaskOwner;
    requireExisting?: boolean;
    sessionKind?: "default" | "dream-collector" | "subagent";
    subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
  } = {},
): Promise<AcpRuntimeResult> {
  const storageKey = options.requireExisting
    ? readSessionStorageKey(config.spiritDataDir, transcriptSessionKey)
    : await ensureSessionStorageKey(config.spiritDataDir, transcriptSessionKey);
  if (!storageKey) throw new Error("Stored ACP session not found.");
  const sessionStore = new RuntimeSessionStore(config.spiritDataDir, storageKey);
  const owner = options.taskOwner ?? (await createBackgroundTaskOwner(config.spiritDataDir));
  let result: AcpRuntimeResult | undefined;
  let lease: RuntimeSessionLease | undefined;
  try {
    const sessionLease = await acquireRuntimeSessionLease(
      config.spiritDataDir,
      storageKey,
      owner.owner,
    );
    lease = sessionLease;
    const saved = await sessionStore.read();
    if (options.requireExisting && !saved) throw new Error("Stored ACP session not found.");
    if (saved && path.resolve(saved.workspaceRoot) !== path.resolve(config.workspaceRoot)) {
      throw new Error("The stored session belongs to a different workspace.");
    }
    let closed = false;
    const report = (error: unknown, taskId?: string) =>
      onEvent({
        kind: "background-task-error",
        error: error instanceof Error ? error.message : String(error),
        ...(taskId ? { taskId } : {}),
      });
    const persist = async () => {
      if (!result) throw new Error("ACP runtime is not initialized.");
      await sessionStore.save({
        version: 1,
        sessionKey: storageKey,
        workspaceRoot: config.workspaceRoot,
        agentMode: result.agentModeSnapshot(),
        ...(sessionKind ? { sessionKind } : {}),
        ...(subagentOrigin ? { subagentOrigin } : {}),
        initialized: true,
        archive: result.runtime.toArchive([], []),
      });
    };
    const store = new FileBackgroundTaskStore({
      spiritDataDir: config.spiritDataDir,
      sessionKey: storageKey,
      owner: owner.owner,
    });
    await store.recoverInterrupted((identity) =>
      isBackgroundTaskOwnerAlive(config.spiritDataDir, identity),
    );
    if ((await store.list()).some((task) => !isBackgroundTaskTerminal(task.status))) {
      throw new Error("This session has active tasks in another runtime. Reconnect to that host.");
    }
    const tasks = new SessionTaskManager({
      sessionKey: storageKey,
      store,
      onError: report,
      onOutput: (task, chunk) => {
        if (task.background) onEvent({ kind: "background-task-output", task, chunk });
      },
      onChanged: (task) => {
        onEvent({ kind: "background-task-changed", task });
        void persist().catch((error: unknown) => report(error, task.id));
      },
    });
    const sessionKind = options.sessionKind ?? saved?.sessionKind;
    const subagentOrigin = options.subagentOrigin ?? saved?.subagentOrigin;
    const prepared = await prepareAcpRuntime(
      config,
      onEvent,
      saved?.agentMode ?? initialMode,
      storageKey,
    );
    prepared.runtimeOptions.backgroundTasks = {
      manager: tasks,
      scope: { runtimeId: "main" },
      persistHistory: persist,
    };
    const runtime = new AgentRuntime(prepared.runtimeOptions);
    result = {
      ...prepared,
      ...(sessionKind ? { sessionKind } : {}),
      ...(subagentOrigin ? { subagentOrigin } : {}),
      runtime,
      tasks,
      storageSessionKey: storageKey,
      restoredFromDisk: Boolean(saved),
      persist,
      setAgentMode: async (mode) => {
        await prepared.setAgentMode(mode);
        await persist();
      },
      dispose: async () => {
        if (closed) return;
        closed = true;
        const stopped = await Promise.allSettled([runtime.shutdown()]);
        const persisted = await Promise.allSettled([persist()]);
        const owners = await Promise.allSettled([
          sessionLease.release(),
          ...(options.taskOwner ? [] : [owner.close()]),
        ]);
        const errors = [...stopped, ...persisted, ...owners].flatMap((entry) =>
          entry.status === "rejected" ? [entry.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, "ACP session shutdown failed.");
      },
    };
    await tasks.restore();
    if (saved) runtime.replaceFromArchive(saved.archive);
    await runtime.restoreBackgroundTaskNotifications();
    await persist();
    return result;
  } catch (error) {
    const cleanup = await Promise.allSettled(
      result
        ? [result.dispose()]
        : [...(lease ? [lease.release()] : []), ...(options.taskOwner ? [] : [owner.close()])],
    );
    const errors = cleanup.flatMap((entry) => (entry.status === "rejected" ? [entry.reason] : []));
    if (errors.length)
      throw new AggregateError([error, ...errors], "ACP initialization and cleanup failed.");
    throw error;
  }
}

interface PreparedAcpRuntime extends Pick<
  AcpRuntimeResult,
  | "toolExecutor"
  | "enabledRules"
  | "enabledSkillCatalog"
  | "planMetadata"
  | "activeSkills"
  | "setAgentMode"
  | "agentModeSnapshot"
> {
  runtimeOptions: AgentRuntimeOptions<LlmTransportConfig, LlmToolAgentState, JsonValue>;
}

/**
 * Creates a fully assembled AgentRuntime for ACP server mode.
 *
 * Key differences from the daemon-backed server runtime:
 * - No WebSocket session attach (ACP uses ndJSON on stdio)
 * - host-internal is loaded directly as a dependency (not via env-var dynamic import)
 * - No LSP, extensions, todos, or image/video generation
 */
async function prepareAcpRuntime(
  config: AcpServerConfig,
  onEvent: (event: RuntimeEvent<JsonValue>) => void,
  initialMode: AgentMode,
  transcriptSessionKey: string,
  inheritedTransport?: { config: LlmTransportConfig; providerId?: string },
): Promise<PreparedAcpRuntime> {
  const resolvedTransport = inheritedTransport
    ? { ok: true as const, ...inheritedTransport }
    : tryResolveTransportConfig(config);
  if (!resolvedTransport.ok) {
    throw new Error(resolvedTransport.error);
  }
  const transportConfig = resolvedTransport.config;
  const hostPromptProviderId = resolvedTransport.providerId;
  const workspaceRoot = config.workspaceRoot;
  const spiritDataDir = config.spiritDataDir;
  const sessionKey = transcriptSessionKey?.trim() || undefined;
  if (sessionKey) {
    await ensureTranscriptSessionDir(spiritDataDir, sessionKey);
  }

  // 1. Create noop peer + tool executor (ACP doesn't use JSON-RPC peer)
  const noopPeer = createNoopPeer();
  const toolExecutor = new HostToolExecutorProxy(
    noopPeer,
    createHostMcpService(workspaceRoot, spiritDataDir),
  );

  // 2. Create NodeHostToolService with noop MCP adapter
  await ensureBuiltInSkills(spiritDataDir);
  await ensurePersonalMarketplace(spiritDataDir);
  const service = new NodeHostToolService(
    { workspaceRoot, spiritDataDir },
    {
      mcp: createNoopMcpAdapter(),
    },
  );
  toolExecutor.setLocalHostService(service as unknown as LocalHostToolService);
  toolExecutor.setBackgroundTaskExposure(true);
  toolExecutor.setTransportConfigForToolDefinitions(transportConfig);
  await toolExecutor.refreshCaches();

  // 3. Load rules/skills via host-internal discovery
  const metadata = await loadHostInstructionMetadata(
    { workspaceRoot, spiritDataDir },
    { planMode: initialMode === "plan", agentMode: initialMode },
  );
  const enabledRules: LlmEnabledRule[] = [...metadata.rules.enabledRules];
  const enabledSkillCatalog: LlmEnabledSkillCatalogEntry[] = [
    ...metadata.skills.enabledSkillCatalog,
  ];
  try {
    const extensionManager = createHostExtensionManager({ spiritDataDir, hostKind: "cli" });
    const overlay = await overlayEnabledExtensionRulesAndSkills(
      await extensionManager.list(),
      enabledRules,
      enabledSkillCatalog,
    );
    enabledRules.length = 0;
    enabledRules.push(...overlay.rules);
    enabledSkillCatalog.length = 0;
    enabledSkillCatalog.push(...overlay.skills);
  } catch (error) {
    console.warn("[acp] failed to overlay extension skills and rules", error);
  }
  // Mutable: closures capture the binding, setAgentMode() reassigns it
  let currentPlanMetadata: LlmPlanMetadata | undefined = metadata.planMetadata;

  // 4. Set mode tool exposure
  toolExecutor.setAgentModeToolExposure(initialMode);

  // 5. Build runtime basic info
  const shell = service.toolDefinitionEnvironment();
  const sessionTranscript = sessionKey?.trim()
    ? resolveTranscriptSessionDir(spiritDataDir, sessionKey.trim())
    : undefined;
  const basicInfo: LlmToolAgentBasicInfo = {
    workspaceRoot,
    ...(shell?.shellDisplayName ? { terminal: shell.shellDisplayName } : {}),
    gitBranch: await readGitBranchLabelForBasicInfo(workspaceRoot),
    ...(sessionTranscript ? { sessionTranscript } : {}),
    system: service.operatingSystemInfo?.() ?? {
      name:
        process.platform === "win32"
          ? "Windows"
          : process.platform === "darwin"
            ? "macOS"
            : process.platform === "linux"
              ? "Linux"
              : process.platform,
      version: osRelease(),
    },
    host: { kind: "ACP Server" },
  };

  // 6. Build prompt sections
  const applyPatchPromptSection =
    transportConfig.transportKind === "open-responses"
      ? buildApplyPatchFileToolsPromptSection()
      : undefined;

  // 7. Mutable active skills array — session bookkeeping for slash activation
  const activeSkills: LlmActiveSkill[] = [];

  // 8. State factory functions
  const attribution = { commitEnabled: false, prEnabled: false };

  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startLlmToolAgentState(
      messages,
      userInput,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      transportConfig.model,
      currentPlanMetadata,
      [], // extensionSystemPrompts
      undefined, // dreamsContextText
      basicInfo,
      applyPatchPromptSection,
      undefined,
      false, // loopEnabled
      undefined, // mcpToolCatalog
      attribution,
      hostPromptProviderId,
    );

  const createContinuationState = (messages: LlmMessage[]) =>
    continueLlmToolAgentState(
      messages,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      transportConfig.model,
      currentPlanMetadata,
      [], // extensionSystemPrompts
      undefined, // dreamsContextText
      basicInfo,
      applyPatchPromptSection,
      undefined,
      false, // loopEnabled
      undefined, // mcpToolCatalog
      attribution,
      hostPromptProviderId,
    );

  // 8. Create LLM transport
  const llmTransport = createLlmTransport(transportConfig);

  // 9. Assemble AgentRuntime
  const runtimeOptions: AgentRuntimeOptions<LlmTransportConfig, LlmToolAgentState, JsonValue> = {
    config: transportConfig,
    llmTransport,
    toolExecutor,
    createToolAgentState,
    createContinuationState,
    appendToolResultMessage: appendLlmToolResultMessage,
    assistantToolCallMessageFromState: assistantToolCallMessageFromLlmState,
    finalAssistantHistoryMessageFromState: finalAssistantHistoryMessageFromLlmState,
    appendUserMessage: appendLlmUserMessage,
    appendUserLlmMessage: (state, message) =>
      appendLlmUserLlmMessage(state, message, workspaceRoot),
    extractAssistantText: extractLastLlmAssistantText,
    truncateStateForContextRetry: truncateLlmToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (messages, userInput, retryState) =>
      rebuildLlmToolAgentStateAfterCompaction(
        messages,
        userInput,
        retryState,
        workspaceRoot,
        enabledRules,
        enabledSkillCatalog,
        transportConfig.model,
        currentPlanMetadata,
        [], // extensionSystemPrompts
        undefined, // dreamsContextText
        basicInfo,
        applyPatchPromptSection,
        undefined,
        false, // loopEnabled
        undefined, // mcpToolCatalog
        attribution,
        hostPromptProviderId,
      ),
    generateImage: (request) =>
      llmTransport.generateImage(
        transportConfig,
        request,
        async (saveRequest: GeneratedImageSaveRequest) => {
          const saveGeneratedImage = service.saveGeneratedImage;
          if (!saveGeneratedImage) {
            throw new Error("ACP host: image generation not supported");
          }
          return saveGeneratedImage.call(service, saveRequest);
        },
      ),
    generateVideo: (request) =>
      llmTransport.generateVideo(transportConfig, request, async (saveRequest) => {
        const saveGeneratedVideo = service.saveGeneratedVideo;
        if (!saveGeneratedVideo) {
          throw new Error("ACP host: video generation not supported");
        }
        return saveGeneratedVideo.call(service, saveRequest);
      }),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    // Pre-existing gap: ACP wires no hookRunner, so the hookSessionContext
    // below is inert and session/tool hooks never fire in ACP mode.
    ...(sessionKey
      ? {
          hookSessionContext: {
            sessionId: sessionKey,
            conversationPath: null,
            workspaceRoot,
            model: transportConfig.model,
          },
        }
      : {}),
    syncSessionTranscript: async ({ transcript, sessionKey: key }) => {
      const resolvedKey = key ?? sessionKey;
      return persistSessionTranscript(
        spiritDataDir,
        transcript,
        resolvedKey !== undefined ? { sessionKey: resolvedKey } : {},
      );
    },
    syncSubagentTranscript: async ({ transcript, sessionKey: key, subagentSessionId }) => {
      const resolvedKey = key ?? sessionKey;
      await persistSubagentTranscript(spiritDataDir, transcript, {
        subagentSessionId,
        ...(resolvedKey !== undefined ? { sessionKey: resolvedKey } : {}),
      });
    },
    resolveSubagentTranscriptPath: ({ sessionKey: key, subagentSessionId }) =>
      resolveSubagentTranscriptFilePath(spiritDataDir, key ?? sessionKey, subagentSessionId),
    persistToolOutputArchive: async (input) => persistToolOutputArchive(spiritDataDir, input),
    bootstrapSubagentWorkspace: createSubagentWorkspaceBootstrap({
      parentWorkspaceRoot: workspaceRoot,
      buildScopedRuntime: async (scopedRoot) => {
        const child = await prepareAcpRuntime(
          { ...config, workspaceRoot: scopedRoot },
          onEvent,
          currentPlanMetadata?.agentMode ?? initialMode,
          transcriptSessionKey,
          {
            config: { ...transportConfig, workspaceRoot: scopedRoot },
            ...(hostPromptProviderId ? { providerId: hostPromptProviderId } : {}),
          },
        );
        return { toolExecutor: child.toolExecutor, runtimeOptions: child.runtimeOptions };
      },
    }),
    onEvent: (event) => {
      if (event.kind === "context-usage-updated") {
        setTransportConfigLastInputTokens(transportConfig, event.usage.inputTokens);
      }
      onEvent(event);
    },
  };

  // 10. Mode switching: update planMetadata binding seen by closures + tool exposure
  const setAgentMode = async (mode: AgentMode): Promise<void> => {
    toolExecutor.setAgentModeToolExposure(mode);
    const refreshed = await loadHostInstructionMetadata(
      { workspaceRoot, spiritDataDir },
      { planMode: mode === "plan", agentMode: mode },
    );
    currentPlanMetadata = refreshed.planMetadata;
  };

  return {
    runtimeOptions,
    toolExecutor,
    enabledRules,
    enabledSkillCatalog,
    planMetadata: currentPlanMetadata,
    activeSkills,
    setAgentMode,
    agentModeSnapshot: () => currentPlanMetadata?.agentMode ?? initialMode,
  };
}
