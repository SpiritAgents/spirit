import { release as osRelease } from "node:os";

import {
  AgentRuntime,
  createLlmTransport,
  isBedrockTransportConfig,
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
import { buildProviderWebSearchPromptSection } from "@spiritagent/agent-core";
import type { AgentMode } from "@spiritagent/agent-core";
import type { LocalHostToolService } from "@spiritagent/agent-core/host-bridge";
import { HostToolExecutorProxy } from "@spiritagent/agent-core/host-bridge";

import {
  NodeHostToolService,
  createHostExtensionManager,
  createNoopMcpAdapter,
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
} from "@spiritagent/host-internal";

import { createNoopPeer } from "./noop-peer.js";
import { resolveTransportConfig } from "@spiritagent/host-internal";
import type { AcpServerConfig } from "./types.js";

export type AcpHostRuntime = AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue>;

export interface AcpRuntimeResult {
  runtime: AcpHostRuntime;
  toolExecutor: HostToolExecutorProxy;
  enabledRules: LlmEnabledRule[];
  enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  planMetadata: LlmPlanMetadata | undefined;
  /** Mutable array reference — mutations are seen by state factory closures */
  activeSkills: LlmActiveSkill[];
  /** Switch agent mode: updates tool exposure + planMetadata seen by closures */
  setAgentMode: (mode: AgentMode) => Promise<void>;
}

/**
 * Creates a fully assembled AgentRuntime for ACP server mode.
 *
 * Key differences from the daemon-backed server runtime:
 * - No WebSocket session attach (ACP uses ndJSON on stdio)
 * - host-internal is loaded directly as a dependency (not via env-var dynamic import)
 * - No LSP, extensions, todos, or image/video generation for MVP
 */
function hostPromptProviderId(config: LlmTransportConfig): string | undefined {
  if (isBedrockTransportConfig(config)) {
    return "bedrock";
  }
  return config.llmVendor;
}

export async function createAcpRuntime(
  config: AcpServerConfig,
  onEvent: (event: RuntimeEvent<JsonValue>) => void,
  initialMode: AgentMode = "agent",
  transcriptSessionKey?: string,
): Promise<AcpRuntimeResult> {
  const transportConfig = resolveTransportConfig(config);
  const workspaceRoot = config.workspaceRoot;
  const spiritDataDir = config.spiritDataDir;
  const sessionKey = transcriptSessionKey?.trim() || undefined;
  if (sessionKey) {
    await ensureTranscriptSessionDir(spiritDataDir, sessionKey);
  }

  // 1. Create noop peer + tool executor (ACP doesn't use JSON-RPC peer)
  const noopPeer = createNoopPeer();
  const toolExecutor = new HostToolExecutorProxy(noopPeer);

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
  const providerWebSearchPromptSection = buildProviderWebSearchPromptSection(transportConfig);

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
      providerWebSearchPromptSection,
      false, // loopEnabled
      undefined, // mcpToolCatalog
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
      [], // extensionSystemPrompts
      undefined, // dreamsContextText
      basicInfo,
      applyPatchPromptSection,
      providerWebSearchPromptSection,
      false, // loopEnabled
      undefined, // mcpToolCatalog
      attribution,
      hostPromptProviderId(transportConfig),
    );

  // 8. Create LLM transport
  const llmTransport = createLlmTransport(transportConfig);

  // 9. Assemble AgentRuntime
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
        [], // extensionSystemPrompts
        undefined, // dreamsContextText
        basicInfo,
        applyPatchPromptSection,
        providerWebSearchPromptSection,
        false, // loopEnabled
        undefined, // mcpToolCatalog
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
    onEvent,
  });

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
    runtime,
    toolExecutor,
    enabledRules,
    enabledSkillCatalog,
    planMetadata: currentPlanMetadata,
    activeSkills,
    setAgentMode,
  };
}
