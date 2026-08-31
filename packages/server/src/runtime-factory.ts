import { access, mkdir, rename } from "node:fs/promises";
import { release as osRelease } from "node:os";
import path from "node:path";

import {
  AgentRuntime,
  McpService,
  buildAgentModeSystemMessage,
  buildApplyPatchFileToolsPromptSection,
  buildBasicInfoSystemMessage,
  buildContributedHostToolDefinitions,
  buildDreamCollectorSystemMessage,
  buildDreamHostToolDefinitions,
  buildExtensionsSystemMessage,
  buildLoopModeSystemMessage,
  buildMcpCatalogSystemMessage,
  buildProviderWebSearchPromptSection,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildTodoHostToolDefinitions,
  buildToolAgentHostPrompt,
  createLlmTransport,
  pendingWorkspaceFilesFromInput,
  runSessionEndHook,
  runSessionStartHookAndApply,
  type ContributedHostToolDefinition,
  type GeneratedImageSaveRequest,
  type HostToolDescriptionHint,
  type JsonValue,
  type LlmMessage,
  type LlmTransportConfig,
  isBedrockTransportConfig,
  type RuntimeEvent,
  type AgentMode,
} from "@spiritagent/agent-core";
import {
  appendLlmToolResultMessage,
  appendLlmUserLlmMessage,
  appendLlmUserMessage,
  assistantToolCallMessageFromLlmState,
  continueLlmToolAgentState,
  extractLastLlmAssistantText,
  finalAssistantHistoryMessageFromLlmState,
  rebuildLlmToolAgentStateAfterCompaction,
  startLlmToolAgentState,
  truncateLlmHistoryForCompaction,
  truncateLlmToolAgentStateForContextRetry,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type LlmToolAgentBasicInfo,
  type LlmToolAgentState,
} from "@spiritagent/agent-core";
import {
  HostToolExecutorProxy,
  createCliAutoApprovalReviewer,
  type LocalHostToolService,
  type LspHostBindings,
} from "@spiritagent/agent-core/host-bridge";
import {
  LspService,
  NodeHostToolService,
  appendLspDiagnosticsAfterWriteIfNeeded,
  collectEnabledExtensionInstructionContributions,
  collectHostExtensionContributedTools,
  createHostExtensionManager,
  createHookRunner,
  createNoopMcpAdapter,
  ensureBuiltInExtensions,
  ensureBuiltInSkills,
  ensureTranscriptSessionDir,
  loadHostInstructionMetadata,
  overlayEnabledExtensionRulesAndSkills,
  persistSessionTranscript,
  persistSubagentTranscript,
  persistToolOutputArchive,
  readGitBranchLabelForBasicInfo,
  resolveSubagentTranscriptFilePath,
  resolveTranscriptSessionDir,
  resolveTransportConfig,
  type ApprovalLevel,
  type HostDreamScope,
  type HostDreamSourceSessionRef,
  type ModelRef,
} from "@spiritagent/host-internal";

import { joinHostPromptSections, normalizeHostUiPromptSection } from "./host-ui-prompt.js";
import { createNoopPeer } from "./noop-peer.js";

export type ServerHostRuntime = AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue>;

export type ServerClientKind = "cli" | "desktop" | "web";

export type ServerSessionKind = "default" | "dream-collector";

export interface ServerRuntimeOptions {
  workspaceRoot: string;
  spiritDataDir: string;
  /** Transcript + todo scope key; defaults to the session id. */
  sessionKey: string;
  modelRef?: ModelRef;
  /** Todo store scope override (CLI keys todos by its own chat session id). */
  todoSessionKey?: string;
  /** Shared per-workspace MCP service (daemon registry); defaults to a fresh one. */
  mcpService?: McpService;
  /** Extensions/todo surfaces differ per host; a session inherits its creator's kind. */
  hostKind: "cli" | "desktop";
  approvalLevel: ApprovalLevel;
  sessionKind?: ServerSessionKind;
  dreamScope?: HostDreamScope;
  dreamSourceSession?: HostDreamSourceSessionRef;
  onEvent: (event: RuntimeEvent<JsonValue>) => void;
  /**
   * Workspace capability trust prompt (hooks). The session manager routes this
   * to connected clients; when no client can answer, the caller's fallback
   * applies (Phase 2: deny).
   */
  requestWorkspaceCapabilityTrust?: (request: {
    workspaceRoot: string;
    contentHash: string;
    hashChanged: boolean;
    hooks: Array<{ event: string; command: string; resolvedPath: string }>;
  }) => Promise<"allowOnce" | "deny" | "alwaysTrust">;
  /** Tool-written file changes — broadcast to clients for rewind bookkeeping. */
  onFileChange?: (change: unknown) => void;
  log?: (message: string) => void;
  /**
   * Host UI Markdown / rendering hints from the client (Desktop Mermaid).
   * Appended as a plain system section; CLI / ACP omit this.
   */
  hostUiPromptSection?: string;
  /**
   * Host-contributed, tool-targeted description hints (e.g. Desktop Mermaid on
   * create_plan content). Merged into tool definitions by agent-core.
   */
  hostToolDescriptionHints?: HostToolDescriptionHint[];
  /**
   * Optional `<basic_info>` host override (e.g. Web + page URL).
   * When omitted, derived from the session's ClientKind via the session manager.
   */
  basicInfoHost?: {
    kind: "Desktop" | "CLI" | "Web";
    url?: string;
  };
}

export interface ServerRuntimeResult {
  runtime: ServerHostRuntime;
  toolExecutor: HostToolExecutorProxy;
  mcpService: McpService;
  transportConfig: LlmTransportConfig;
  enabledRules: LlmEnabledRule[];
  enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  /** Mutable array reference — turn handlers read it, slash activation mutates it. */
  activeSkills: LlmActiveSkill[];
  setAgentMode: (mode: AgentMode) => Promise<void>;
  setApprovalLevel: (level: ApprovalLevel) => void;
  approvalLevelSnapshot: () => ApprovalLevel;
  setLoopEnabled: (enabled: boolean) => void;
  /** Re-read installed extensions and refresh tool defs + system prompts. */
  refreshExtensions: () => Promise<void>;
  /** sessionStart hook (startup/resume/open), applying context messages. */
  runSessionStart: (source: "startup" | "resume" | "open") => Promise<void>;
  /** sessionEnd hook (switch/close). */
  runSessionEnd: (reason: "abort" | "switch" | "close") => Promise<void>;
  /** Re-run rules/skills/plan discovery (mode switch or file changes). */
  reloadHostMetadata: (mode: AgentMode) => Promise<void>;
  /** Export api messages + request trace + assembled system prompts. */
  exportState: () => Promise<unknown>;
  /** Attribution toggles captured by state factory closures. */
  setAttribution: (
    attribution: { commitEnabled?: boolean; prEnabled?: boolean } | undefined,
  ) => void;
  /** Re-scope the todo store (CLI keys todos by its own chat session id). */
  setTodoSessionKey: (sessionKey: string) => void;
  /**
   * Re-key transcript persistence after provisional → stable chat promote.
   * Moves the on-disk transcript dir when present and updates hook sessionId.
   */
  setTranscriptSessionKey: (nextSessionKey: string) => Promise<void>;
  /** Abort a running shell process owned by this session. */
  abortShell: (toolCallId: string) => boolean;
}

/**
 * Assembles a fully-wired AgentRuntime inside the daemon. Supersedes legacy
 * in-host assembly (Desktop in-process runtime, CLI host-bridge sidecar,
 * acp-server local factory). First-party clients attach via WebSocket instead
 * of spawning a sidecar. Tools run in-process via NodeHostToolService, with a
 * real per-session McpService, LSP bindings, extensions, todos, hooks, and
 * transcript persistence.
 */
function hostPromptProviderId(config: LlmTransportConfig): string | undefined {
  if (isBedrockTransportConfig(config)) {
    return "bedrock";
  }
  return config.llmVendor;
}

export async function createServerRuntime(
  options: ServerRuntimeOptions,
): Promise<ServerRuntimeResult> {
  const { workspaceRoot, spiritDataDir, hostKind, onEvent } = options;
  // Mutable: provisional → stable promote re-keys transcript persistence in place.
  let sessionKey = options.sessionKey;
  const log = options.log ?? (() => {});
  const approvalLevel = options.approvalLevel;
  const isDreamCollector = options.sessionKind === "dream-collector";
  if (isDreamCollector && !options.dreamScope) {
    throw new Error("dream-collector session requires dreamScope");
  }

  const transportConfig = resolveTransportConfig({
    workspaceRoot,
    spiritDataDir,
    ...(options.modelRef ? { modelRef: options.modelRef } : {}),
  });
  await ensureTranscriptSessionDir(spiritDataDir, sessionKey);

  // 1. Tool executor: noop peer (no stdio peer in the daemon) + per-session MCP.
  const mcpService = isDreamCollector
    ? new McpService(workspaceRoot, true)
    : (options.mcpService ?? new McpService(workspaceRoot, true));
  const toolExecutor = new HostToolExecutorProxy(createNoopPeer(), mcpService);
  if (!isDreamCollector) {
    mcpService.startBackgroundRefreshInBackground(false);
  }

  // 2. Local tool service: real shell/file/web execution, noop management MCP
  //    adapter (MCP tool execution lives on the executor's McpService, same
  //    split as Desktop), extensions, todos, approval level.
  let extensionManager: ReturnType<typeof createHostExtensionManager> | undefined;
  const extensionSystemPrompts: LlmExtensionSystemPrompt[] = [];
  if (!isDreamCollector) {
    await ensureBuiltInSkills(spiritDataDir);
    extensionManager = createHostExtensionManager({ spiritDataDir, hostKind });
    await ensureBuiltInExtensions({
      spiritDataDir,
      hostKind,
      manager: extensionManager,
    });
  }
  let currentApprovalLevel = approvalLevel;
  const service = new NodeHostToolService(
    { workspaceRoot, spiritDataDir },
    {
      mcp: createNoopMcpAdapter(),
      ...(isDreamCollector
        ? {
            dreamScope: options.dreamScope!,
            ...(options.dreamSourceSession
              ? { dreamSourceSession: options.dreamSourceSession }
              : {}),
          }
        : {
            extensions: {
              manager: extensionManager!,
              getHost: () => ({}),
              logger: console,
            },
            fileChangeObserver: {
              async recordFileChange(change: unknown): Promise<void> {
                await toolExecutor.lspServiceSnapshot()?.syncFromRecordedChange(change);
                options.onFileChange?.(change);
              },
            },
            todoScope: { sessionKey: options.todoSessionKey?.trim() || sessionKey },
          }),
      getApprovalLevel: () => currentApprovalLevel,
    },
  );
  toolExecutor.setLocalHostService(service as unknown as LocalHostToolService);
  toolExecutor.setTransportConfigForToolDefinitions(transportConfig);
  if (options.hostToolDescriptionHints) {
    toolExecutor.setHostToolDescriptionHints(options.hostToolDescriptionHints);
  }
  toolExecutor.setApprovalLevel(currentApprovalLevel);
  if (isDreamCollector) {
    toolExecutor.setDreamToolDefinitions(buildDreamHostToolDefinitions());
    toolExecutor.setDreamOnlyToolSurface(true);
    toolExecutor.setExtensionToolDefinitions([]);
    toolExecutor.setTodoToolDefinitions([]);
  } else {
    toolExecutor.setTodoToolDefinitions(buildTodoHostToolDefinitions());
    // The bridge passes these via a loosely-typed dynamic import; with static
    // imports the nominal types diverge slightly (structurally compatible).
    toolExecutor.setLspHostBindings({
      LspService,
      appendLspDiagnosticsAfterWriteIfNeeded,
    } as unknown as LspHostBindings);
    await toolExecutor.setLspWorkspaceRoot(workspaceRoot);

    // Extension-contributed tools + system prompts (host-scoped).
    const installedExtensions = await extensionManager!.list();
    toolExecutor.setExtensionToolDefinitions(
      buildContributedHostToolDefinitions(
        collectHostExtensionContributedTools(
          installedExtensions,
        ) as unknown as ContributedHostToolDefinition[],
      ),
    );
    extensionSystemPrompts.push(
      ...(
        await extensionManager!.collectSystemPromptContributions({ host: {}, logger: console })
      ).map((entry) => ({
        extensionId: entry.extensionId,
        extensionName: entry.extensionName,
        content: entry.content,
      })),
    );
  }

  if (isDreamCollector) {
    extensionSystemPrompts.push({
      extensionId: "dream-collector",
      extensionName: "Dream Collector",
      content: buildDreamCollectorSystemMessage(),
    });
  }

  await toolExecutor.refreshCaches();

  // 3. Rules / skills / plan metadata.
  const enabledRules: LlmEnabledRule[] = [];
  const enabledSkillCatalog: LlmEnabledSkillCatalogEntry[] = [];
  let baseEnabledRules: LlmEnabledRule[] = [];
  let baseEnabledSkillCatalog: LlmEnabledSkillCatalogEntry[] = [];
  let currentPlanMetadata: LlmPlanMetadata | undefined;

  const applyExtensionInstructionOverlay = async (): Promise<void> => {
    if (!extensionManager) {
      enabledRules.length = 0;
      enabledRules.push(...baseEnabledRules);
      enabledSkillCatalog.length = 0;
      enabledSkillCatalog.push(...baseEnabledSkillCatalog);
      return;
    }
    const overlay = await overlayEnabledExtensionRulesAndSkills(
      await extensionManager.list(),
      baseEnabledRules,
      baseEnabledSkillCatalog,
      (message: string) => log(message),
    );
    enabledRules.length = 0;
    enabledRules.push(...overlay.rules);
    enabledSkillCatalog.length = 0;
    enabledSkillCatalog.push(...overlay.skills);
  };

  if (isDreamCollector) {
    currentPlanMetadata = {
      path: "",
      exists: false,
      agentMode: "agent",
      planMode: false,
    };
    toolExecutor.setAgentModeToolExposure("agent");
  } else {
    const metadata = await loadHostInstructionMetadata(
      { workspaceRoot, spiritDataDir },
      { planMode: false, agentMode: "agent" },
    );
    baseEnabledRules = [...metadata.rules.enabledRules];
    baseEnabledSkillCatalog = [...metadata.skills.enabledSkillCatalog];
    await applyExtensionInstructionOverlay();
    currentPlanMetadata = metadata.planMetadata;
    toolExecutor.setAgentModeToolExposure("agent");
  }

  // 4. Basic info block.
  const shell = service.toolDefinitionEnvironment();
  const basicInfoHost = options.basicInfoHost
    ? {
        kind: options.basicInfoHost.kind,
        ...(options.basicInfoHost.url?.trim() ? { url: options.basicInfoHost.url.trim() } : {}),
      }
    : undefined;
  const basicInfo: LlmToolAgentBasicInfo = {
    workspaceRoot,
    ...(shell?.shellDisplayName ? { terminal: shell.shellDisplayName } : {}),
    gitBranch:
      isDreamCollector && options.dreamScope
        ? options.dreamScope.gitBranch
        : await readGitBranchLabelForBasicInfo(workspaceRoot),
    sessionTranscript: resolveTranscriptSessionDir(spiritDataDir, sessionKey),
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
    ...(basicInfoHost ? { host: basicInfoHost } : {}),
  };
  const hookSessionContext = {
    sessionId: sessionKey,
    conversationPath: null as string | null,
    workspaceRoot,
    model: transportConfig.model,
  };

  // 5. Prompt sections.
  const applyPatchPromptSection =
    transportConfig.transportKind === "open-responses"
      ? buildApplyPatchFileToolsPromptSection()
      : undefined;
  const providerWebSearchPromptSection = buildProviderWebSearchPromptSection(transportConfig);
  const hostUiPromptSection = normalizeHostUiPromptSection(options.hostUiPromptSection);
  // apply_patch + optional host UI Markdown (Desktop Mermaid) share the trailing plain slot.
  const trailingHostPromptSection = joinHostPromptSections(
    applyPatchPromptSection,
    hostUiPromptSection,
  );

  const activeSkills: LlmActiveSkill[] = [];
  // Mutable: state factory closures capture the binding; setLoopEnabled updates it.
  let loopEnabled = false;
  let attribution: { commitEnabled?: boolean; prEnabled?: boolean } | undefined;

  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startLlmToolAgentState(
      messages,
      userInput,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      transportConfig.model,
      currentPlanMetadata,
      extensionSystemPrompts,
      undefined, // dreamsContextText — Desktop-only product surface, wired in a later phase
      basicInfo,
      trailingHostPromptSection,
      providerWebSearchPromptSection,
      loopEnabled,
      toolExecutor.mcpToolCatalogSnapshot(),
      attribution,
      hostPromptProviderId(transportConfig),
    );

  const createContinuationState = (messages: LlmMessage[]) =>
    continueLlmToolAgentState(
      messages,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      transportConfig.model,
      currentPlanMetadata,
      extensionSystemPrompts,
      undefined,
      basicInfo,
      trailingHostPromptSection,
      providerWebSearchPromptSection,
      loopEnabled,
      toolExecutor.mcpToolCatalogSnapshot(),
      attribution,
      hostPromptProviderId(transportConfig),
    );

  const llmTransport = createLlmTransport(transportConfig);

  // 6. Hooks: workspace capability trust routes to clients when available.
  const hookRunner = createHookRunner({
    spiritDataDir,
    workspaceRoot,
    logger: (message) => log(`[hooks] ${message}`),
    requestWorkspaceCapabilityTrust: async (request) => {
      if (options.requestWorkspaceCapabilityTrust) {
        return options.requestWorkspaceCapabilityTrust(request);
      }
      return "deny";
    },
    loadExtensionHooks: async (event) => {
      if (!extensionManager) {
        return [];
      }
      const contributions = await collectEnabledExtensionInstructionContributions(
        await extensionManager.list(),
        (message: string) => log(message),
      );
      return contributions.hooks.filter((hook) => hook.event === event);
    },
  });

  const runtime = new AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue>({
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
        extensionSystemPrompts,
        undefined,
        basicInfo,
        trailingHostPromptSection,
        providerWebSearchPromptSection,
        loopEnabled,
        toolExecutor.mcpToolCatalogSnapshot(),
        attribution,
        hostPromptProviderId(transportConfig),
      ),
    generateImage: (request) =>
      llmTransport.generateImage(
        transportConfig,
        request,
        async (saveRequest: GeneratedImageSaveRequest) => {
          const saveGeneratedImage = service.saveGeneratedImage;
          if (!saveGeneratedImage) {
            throw new Error("server host: image generation not supported");
          }
          return saveGeneratedImage.call(service, saveRequest);
        },
      ),
    generateVideo: (request) =>
      llmTransport.generateVideo(transportConfig, request, async (saveRequest) => {
        const saveGeneratedVideo = service.saveGeneratedVideo;
        if (!saveGeneratedVideo) {
          throw new Error("server host: video generation not supported");
        }
        return saveGeneratedVideo.call(service, saveRequest);
      }),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    hookRunner,
    hookSessionContext,
    syncSessionTranscript: async ({ transcript, sessionKey: key }) =>
      persistSessionTranscript(spiritDataDir, transcript, {
        sessionKey: key ?? sessionKey,
      }),
    syncSubagentTranscript: async ({ transcript, sessionKey: key, subagentSessionId }) => {
      await persistSubagentTranscript(spiritDataDir, transcript, {
        subagentSessionId,
        sessionKey: key ?? sessionKey,
      });
    },
    resolveSubagentTranscriptPath: ({ sessionKey: key, subagentSessionId }) =>
      resolveSubagentTranscriptFilePath(spiritDataDir, key ?? sessionKey, subagentSessionId),
    persistToolOutputArchive: async (input) => persistToolOutputArchive(spiritDataDir, input),
    getApprovalLevel: () => currentApprovalLevel,
    reviewToolApproval: createCliAutoApprovalReviewer(transportConfig),
    onEvent,
  });

  const setAgentMode = async (mode: AgentMode): Promise<void> => {
    if (isDreamCollector) {
      return;
    }
    toolExecutor.setAgentModeToolExposure(mode);
    const refreshed = await loadHostInstructionMetadata(
      { workspaceRoot, spiritDataDir },
      { planMode: mode === "plan", agentMode: mode },
    );
    currentPlanMetadata = refreshed.planMetadata;
  };

  const setApprovalLevel = (level: ApprovalLevel): void => {
    currentApprovalLevel = level;
    toolExecutor.setApprovalLevel(level);
  };

  const setLoopEnabled = (enabled: boolean): void => {
    loopEnabled = enabled;
    runtime.setLoopEnabled(enabled);
    toolExecutor.setLoopToolExposure(enabled);
  };

  const refreshExtensions = async (): Promise<void> => {
    if (isDreamCollector || !extensionManager) {
      return;
    }
    const installed = await extensionManager.list();
    toolExecutor.setExtensionToolDefinitions(
      buildContributedHostToolDefinitions(
        collectHostExtensionContributedTools(
          installed,
        ) as unknown as ContributedHostToolDefinition[],
      ),
    );
    const collected = await extensionManager.collectSystemPromptContributions({
      host: {},
      logger: console,
    });
    extensionSystemPrompts.length = 0;
    extensionSystemPrompts.push(
      ...collected.map((entry) => ({
        extensionId: entry.extensionId,
        extensionName: entry.extensionName,
        content: entry.content,
      })),
    );
    await applyExtensionInstructionOverlay();
  };

  return {
    runtime,
    toolExecutor,
    mcpService,
    transportConfig,
    enabledRules,
    enabledSkillCatalog,
    activeSkills,
    setAgentMode,
    setApprovalLevel,
    approvalLevelSnapshot: () => currentApprovalLevel,
    setLoopEnabled,
    refreshExtensions,
    runSessionStart: async (source) => {
      await runSessionStartHookAndApply(
        hookRunner,
        (role, content) => runtime.recordContextMessage(role, content),
        { ...hookSessionContext },
        source,
      );
    },
    runSessionEnd: async (reason) => {
      await runSessionEndHook(hookRunner, { ...hookSessionContext }, reason);
    },
    reloadHostMetadata: async (mode) => {
      if (isDreamCollector) {
        return;
      }
      const refreshed = await loadHostInstructionMetadata(
        { workspaceRoot, spiritDataDir },
        { planMode: mode === "plan", agentMode: mode },
      );
      baseEnabledRules = [...refreshed.rules.enabledRules];
      baseEnabledSkillCatalog = [...refreshed.skills.enabledSkillCatalog];
      await applyExtensionInstructionOverlay();
      currentPlanMetadata = refreshed.planMetadata;
    },
    exportState: async () => {
      const exportTransport = createLlmTransport(transportConfig);
      const baseSystemPrompts = exportTransport.llmSystemPromptsForExport() as Record<
        string,
        JsonValue
      >;
      const rulesSystemPrompt = buildRulesSystemMessage(enabledRules);
      const skillsCatalogSystemPrompt = buildSkillsCatalogSystemMessage(enabledSkillCatalog);
      const mcpCatalogSystemPrompt = buildMcpCatalogSystemMessage(
        toolExecutor.mcpToolCatalogSnapshot(),
      );
      const agentModeSystemPrompt = buildAgentModeSystemMessage(currentPlanMetadata);
      const loopModeSystemPrompt = buildLoopModeSystemMessage(runtime.loopEnabled());
      const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
      const basicInfoSystemPrompt = buildBasicInfoSystemMessage(basicInfo);
      return {
        apiMessages: exportTransport.llmHistoryAsApiMessages([...runtime.history()]),
        requestTrace: [...runtime.requestTrace()],
        systemPrompts: {
          ...baseSystemPrompts,
          tool_agent: buildToolAgentHostPrompt(
            transportConfig.model,
            hostPromptProviderId(transportConfig),
          ),
          ...(rulesSystemPrompt === undefined ? {} : { rules: rulesSystemPrompt }),
          ...(skillsCatalogSystemPrompt === undefined
            ? {}
            : { skillsCatalog: skillsCatalogSystemPrompt }),
          ...(mcpCatalogSystemPrompt === undefined ? {} : { mcpCatalog: mcpCatalogSystemPrompt }),
          agentMode: agentModeSystemPrompt,
          ...(loopModeSystemPrompt === undefined ? {} : { loopMode: loopModeSystemPrompt }),
          ...(extensionsSystemPrompt === undefined ? {} : { extensions: extensionsSystemPrompt }),
          ...(basicInfoSystemPrompt === undefined ? {} : { basicInfo: basicInfoSystemPrompt }),
          ...(hostUiPromptSection === undefined ? {} : { hostUi: hostUiPromptSection }),
          ...(applyPatchPromptSection === undefined
            ? {}
            : { applyPatchFileTools: applyPatchPromptSection }),
        },
      };
    },
    setAttribution: (next) => {
      attribution = next;
    },
    setTodoSessionKey: (key) => {
      service.setTodoScope?.({ sessionKey: key });
    },
    setTranscriptSessionKey: async (nextSessionKey) => {
      const trimmed = nextSessionKey.trim();
      if (!trimmed || trimmed === sessionKey) {
        return;
      }
      const previousKey = sessionKey;
      const fromDir = resolveTranscriptSessionDir(spiritDataDir, previousKey);
      const toDir = resolveTranscriptSessionDir(spiritDataDir, trimmed);
      if (fromDir !== toDir) {
        let sourceExists = false;
        try {
          await access(fromDir);
          sourceExists = true;
        } catch {
          sourceExists = false;
        }
        let targetExists = false;
        try {
          await access(toDir);
          targetExists = true;
        } catch {
          targetExists = false;
        }
        if (sourceExists && !targetExists) {
          await mkdir(path.dirname(toDir), { recursive: true });
          await rename(fromDir, toDir);
        } else if (!targetExists) {
          await ensureTranscriptSessionDir(spiritDataDir, trimmed);
        }
      }
      sessionKey = trimmed;
      hookSessionContext.sessionId = trimmed;
      basicInfo.sessionTranscript = resolveTranscriptSessionDir(spiritDataDir, trimmed);
    },
    abortShell: (toolCallId) => service.abortShell(toolCallId),
  };
}
