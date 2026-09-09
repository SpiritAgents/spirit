import {
  type AskQuestionsResult,
  type DreamHostToolName,
  type LlmTransportConfig,
  type OpenAiModelCompatibilityProfile,
  resolveOpenAiModelCompatibilityProfile,
  createLlmImageContentPart,
  createLlmVideoContentPart,
  createLlmTextContentPart,
  buildBuiltinHostToolDefinitions,
  buildDreamHostToolDefinitions,
  buildDreamReadHostToolDefinitions,
  assertAgentModeAllowsHostTool,
  assertFinishTaskToolAllowed,
  filterContributedToolDefinitionsForAgentMode,
  filterHostToolDefinitionsForAgentMode,
  isPlanAgentMode,
  enrichUnknownToolError,
  toolNamesFromDefinitions,
  buildFinishTaskHostToolDefinitions,
  buildPlanModeHostToolDefinitions,
  buildTodoHostToolDefinitions,
  filterLegacyHostFileToolDefinitions,
  isOpenResponsesTransportConfig,
  shouldUseApplyPatchFileTools,
  AuthorizationDecision,
  createToolExecutionTextOutput,
  JsonValue,
  McpService,
  McpStatusSnapshot,
  type McpUiOpener,
  TOOL_CALL_TOOL_NAME,
  isLazyToolGatewayToolName,
  authorizeLazyToolGatewayRequest,
  resolveMcpToolCallApprovalAnnotations,
  buildLazyToolGatewayDefinitions,
  createBuiltInLazyToolGatewayBackendWithCall,
  createCompositeLazyToolGatewayBackend,
  createMcpLazyToolGatewayBackend,
  executeLazyToolGatewayCall,
  LAZY_BUILT_IN_SERVER_DESKTOP,
  LAZY_TOOL_PROVIDER_BUILT_IN,
  mergeLazyToolCatalogSnapshots,
  parseBuiltInLazyToolCallArguments,
  parseLazyToolGatewayArguments,
  type LazyToolGatewayToolRequest,
  type BuiltInLazyToolIndexEntry,
  type McpToolRequest,
  type PermissionMemoryTarget,
  type ToolAgentMcpToolCatalogSnapshot,
  type ToolExecutionOutput,
  ToolRequestExecutionMetadata,
  ToolExecutor,
  buildLspHostToolDefinitions,
  isLspDiagnosticsToolRequest,
  requestFromGetDiagnosticsFunctionCall,
  executeGetDiagnostics,
  shouldUseStepfunWebSearch,
  buildStepfunWebSearchToolDefinition,
  shouldUseKimiCodeWebSearch,
  buildKimiCodeWebSearchToolDefinition,
} from "@spiritagent/agent-core";
import { LspService, appendLspDiagnosticsAfterWriteIfNeeded } from "@spiritagent/host-internal/lsp";
import {
  CREATE_AUTOMATION_CONTRIBUTED_TOOL,
  CREATE_AUTOMATION_TOOL_NAME,
  buildCreateAutomationApprovalPrompt,
  previewCreateAutomationFromArguments,
  toBuiltInLazyToolIndexEntry,
  type HostAutomationCreateDefaults,
  type HostAutomationDefinition,
  type HostDreamScope,
  type HostDreamSourceSessionRef,
  type HostTodoScope,
  type HostExtensionRuntimeBinding,
  type HostFileChangeObserver,
  type HostGeneratedImageFile,
  type HostGeneratedImageSaveRequest,
  type HostGeneratedVideoFile,
  type HostGeneratedVideoSaveRequest,
  type HostBuiltinToolDefinitionEnvironment,
  type HostOperatingSystemInfo,
  type ApprovalLevel,
  NodeHostToolService,
  normalizeApprovalLevel,
  createNoopMcpAdapter,
} from "@spiritagent/host-internal";

import type { AskQuestionsQuestionSpec } from "../types.js";
import { spiritDataDir } from "./storage.js";
import type { DesktopAgentMode } from "../lib/agent-mode.js";
import type { DesktopToolRequest } from "./contracts.js";

type DesktopDreamToolMode = "read-only" | "collector";

const READ_ONLY_DREAM_TOOL_NAMES = new Set<DreamHostToolName>(["dream_list", "dream_read"]);

const DESKTOP_BUILT_IN_LAZY_TOOL_DEFINITIONS = [CREATE_AUTOMATION_CONTRIBUTED_TOOL];

function isDreamToolRequest(
  request: DesktopToolRequest,
): request is Extract<DesktopToolRequest, { name: DreamHostToolName }> {
  return typeof request?.name === "string" && request.name.startsWith("dream_");
}

function includesLazyToolGatewayDefinitions(definitions: JsonValue[]): boolean {
  return toolNamesFromDefinitions(definitions).some((name) => isLazyToolGatewayToolName(name));
}

export class DesktopToolExecutor implements ToolExecutor<DesktopToolRequest> {
  private readonly tools: NodeHostToolService<AskQuestionsQuestionSpec>;
  private readonly mcp: McpService;
  private readonly lsp: LspService | undefined;
  private readonly dreamToolDefinitions: JsonValue[];
  private readonly todoToolDefinitions: JsonValue[];
  private readonly dreamScope: HostDreamScope | undefined;
  private readonly dreamToolMode: DesktopDreamToolMode | undefined;
  private readonly todoScope: HostTodoScope | undefined;
  private extensionToolDefinitions: JsonValue[];
  private readonly hostContributedToolsEnabled: boolean;
  private loopToolDefinitions: JsonValue[] = [];
  private loopToolExposureEnabled = false;
  private planToolDefinitions: JsonValue[] = [];
  private agentMode: DesktopAgentMode = "agent";
  private activeModelCompatibilityProfile: OpenAiModelCompatibilityProfile | undefined;
  private activeTransportConfig: LlmTransportConfig | undefined;
  private imageGenerationAvailable = false;
  private videoGenerationAvailable = false;
  private approvalLevel: ApprovalLevel = "default";
  private readonly mcpUiOpener: McpUiOpener | undefined;

  constructor(
    private readonly workspaceRoot: string,
    options: {
      mcp?: McpService;
      lsp?: LspService;
      extensionToolDefinitions?: JsonValue[];
      fileChangeObserver?: HostFileChangeObserver;
      extensions?: HostExtensionRuntimeBinding<unknown>;
      dreamScope?: HostDreamScope;
      dreamToolMode?: DesktopDreamToolMode;
      dreamSourceSession?: HostDreamSourceSessionRef;
      todoScope?: HostTodoScope;
      hostContributedToolsEnabled?: boolean;
      getAutomationCreateDefaults?: () => HostAutomationCreateDefaults;
      onAutomationCreated?: (definition: HostAutomationDefinition) => void;
      mcpUiOpener?: McpUiOpener;
    } = {},
  ) {
    this.mcp = options.mcp ?? new McpService(workspaceRoot);
    this.mcpUiOpener = options.mcpUiOpener;
    this.lsp = options.lsp;
    this.extensionToolDefinitions = [...(options.extensionToolDefinitions ?? [])];
    this.hostContributedToolsEnabled = options.hostContributedToolsEnabled === true;
    this.dreamScope = options.dreamScope;
    this.todoScope = options.todoScope;
    this.dreamToolMode = options.dreamScope ? (options.dreamToolMode ?? "collector") : undefined;
    this.dreamToolDefinitions = !options.dreamScope
      ? []
      : this.dreamToolMode === "read-only"
        ? buildDreamReadHostToolDefinitions()
        : buildDreamHostToolDefinitions();
    this.todoToolDefinitions = options.todoScope ? buildTodoHostToolDefinitions() : [];
    this.tools = new NodeHostToolService<AskQuestionsQuestionSpec>(
      {
        workspaceRoot,
        spiritDataDir: spiritDataDir(),
      },
      {
        mcp: createNoopMcpAdapter(),
        getModelCompatibilityProfile: () => this.activeModelCompatibilityProfile,
        getApprovalLevel: () => this.approvalLevel,
        ...(options.fileChangeObserver ? { fileChangeObserver: options.fileChangeObserver } : {}),
        ...(options.extensions ? { extensions: options.extensions } : {}),
        ...(options.dreamScope ? { dreamScope: options.dreamScope } : {}),
        ...(options.dreamSourceSession ? { dreamSourceSession: options.dreamSourceSession } : {}),
        ...(options.todoScope ? { todoScope: options.todoScope } : {}),
        ...(options.getAutomationCreateDefaults
          ? { getAutomationCreateDefaults: options.getAutomationCreateDefaults }
          : {}),
        ...(options.onAutomationCreated
          ? { onAutomationCreated: options.onAutomationCreated }
          : {}),
        availableToolDefinitions: () => this.toolDefinitionsJson(),
      },
    );
  }

  setActiveTransportConfig(config: LlmTransportConfig): void {
    this.activeTransportConfig = config;
    this.activeModelCompatibilityProfile = resolveOpenAiModelCompatibilityProfile(config as any);
    this.imageGenerationAvailable =
      "imageGeneration" in config && config.imageGeneration !== undefined;
    this.videoGenerationAvailable =
      "videoGeneration" in config && config.videoGeneration !== undefined;
  }

  setApprovalLevel(level: ApprovalLevel): void {
    this.approvalLevel = normalizeApprovalLevel(level);
  }

  setLoopToolExposure(loopEnabled: boolean): void {
    this.loopToolExposureEnabled = loopEnabled;
    this.loopToolDefinitions = loopEnabled ? buildFinishTaskHostToolDefinitions() : [];
  }

  setAgentModeToolExposure(agentMode: DesktopAgentMode): void {
    this.agentMode = agentMode;
    this.planToolDefinitions = isPlanAgentMode(agentMode) ? buildPlanModeHostToolDefinitions() : [];
  }

  setPlanModeToolExposure(planMode: boolean): void {
    this.setAgentModeToolExposure(planMode ? "plan" : "agent");
  }

  approvalLevelSnapshot(): ApprovalLevel {
    return this.approvalLevel;
  }

  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment {
    return this.tools.toolDefinitionEnvironment();
  }

  operatingSystemInfo(): HostOperatingSystemInfo {
    return this.tools.operatingSystemInfo();
  }

  matchesDreamAccess(
    dreamScope: HostDreamScope | undefined,
    dreamToolMode: DesktopDreamToolMode | undefined,
  ): boolean {
    return (
      this.dreamToolMode === dreamToolMode &&
      this.dreamScope?.workspaceRoot === dreamScope?.workspaceRoot &&
      this.dreamScope?.gitBranch === dreamScope?.gitBranch
    );
  }

  matchesTodoAccess(todoScope: HostTodoScope | undefined): boolean {
    return this.todoScope?.sessionKey === todoScope?.sessionKey;
  }

  toolDefinitionsJson(): JsonValue {
    let builtinDefinitions = buildBuiltinHostToolDefinitions(
      this.tools.toolDefinitionEnvironment(),
    );
    if (!this.imageGenerationAvailable) {
      builtinDefinitions = builtinDefinitions.filter(
        (definition) => toolDefinitionName(definition) !== "generate_image",
      );
    }
    if (!this.videoGenerationAvailable) {
      builtinDefinitions = builtinDefinitions.filter(
        (definition) => toolDefinitionName(definition) !== "generate_video",
      );
    }

    if (
      this.activeTransportConfig !== undefined &&
      isOpenResponsesTransportConfig(this.activeTransportConfig) &&
      shouldUseApplyPatchFileTools(this.activeTransportConfig, { agentMode: this.agentMode })
    ) {
      builtinDefinitions = filterLegacyHostFileToolDefinitions(builtinDefinitions);
    }

    const mergedHostDefinitions = filterHostToolDefinitionsForAgentMode(
      [
        ...builtinDefinitions,
        ...this.loopToolDefinitions,
        ...this.planToolDefinitions,
        ...this.dreamToolDefinitions,
        ...this.todoToolDefinitions,
        ...(this.activeTransportConfig !== undefined &&
        shouldUseStepfunWebSearch(this.activeTransportConfig)
          ? [buildStepfunWebSearchToolDefinition()]
          : []),
        ...(this.activeTransportConfig !== undefined &&
        shouldUseKimiCodeWebSearch(this.activeTransportConfig)
          ? [buildKimiCodeWebSearchToolDefinition()]
          : []),
      ],
      this.agentMode,
    );
    const hostDefinitionItems = Array.isArray(mergedHostDefinitions) ? mergedHostDefinitions : [];
    const mcpDefinitions = this.mcp.toolDefinitionsJson();
    const builtInLazyGatewayDefinitions =
      this.builtInLazyToolIndex().length > 0 && !includesLazyToolGatewayDefinitions(mcpDefinitions)
        ? buildLazyToolGatewayDefinitions()
        : [];

    return mergeToolDefinitions(
      ...hostDefinitionItems,
      ...builtInLazyGatewayDefinitions,
      ...this.extensionToolDefinitions,
      ...mcpDefinitions,
      ...(this.lsp?.enabled
        ? buildLspHostToolDefinitions(this.lsp.readyProvidersForToolDefinitions())
        : []),
    );
  }

  lspServiceSnapshot(): LspService | undefined {
    return this.lsp?.enabled ? this.lsp : undefined;
  }

  setExtensionToolDefinitions(definitions: JsonValue[] | undefined): void {
    this.extensionToolDefinitions = Array.isArray(definitions) ? [...definitions] : [];
  }

  async parseCommand(_message: string): Promise<DesktopToolRequest> {
    throw new Error("The current desktop host does not implement manual tool command parsing.");
  }

  async requestFromFunctionCall(name: string, argumentsJson: string): Promise<DesktopToolRequest> {
    const availableDefinitions = this.toolDefinitionsJson();
    assertFinishTaskToolAllowed(name, this.loopToolExposureEnabled, availableDefinitions);
    assertAgentModeAllowsHostTool(name, this.agentMode, availableDefinitions);
    try {
      const localMcpRequest = await this.mcp.requestFromFunctionCall(name, argumentsJson);
      if (localMcpRequest) {
        return localMcpRequest as unknown as DesktopToolRequest;
      }
      const lspRequest = requestFromGetDiagnosticsFunctionCall(name, argumentsJson);
      if (lspRequest) {
        return lspRequest as unknown as DesktopToolRequest;
      }
      const request = await this.tools.requestFromFunctionCall(name, argumentsJson);
      this.assertAllowedDreamToolRequest(request);
      return request;
    } catch (error) {
      throw enrichUnknownToolError(error, name, toolNamesFromDefinitions(availableDefinitions));
    }
  }

  async authorize(request: DesktopToolRequest): Promise<AuthorizationDecision> {
    if (this.mcp.isFetchMcpResourceToolRequest(request as JsonValue)) {
      return { kind: "allowed" };
    }
    if (this.mcp.isLazyToolGatewayToolRequest(request as JsonValue)) {
      return this.authorizeLazyToolGateway(request as unknown as LazyToolGatewayToolRequest);
    }
    if (this.mcp.isToolRequest(request as JsonValue)) {
      await this.mcp.authorizeToolRequest(request as unknown as McpToolRequest);
      return { kind: "allowed" };
    }
    if (isLspDiagnosticsToolRequest(request as JsonValue)) {
      return { kind: "allowed" };
    }
    this.assertAllowedDreamToolRequest(request);
    return this.tools.authorize(request);
  }

  async rememberApproval(
    target: PermissionMemoryTarget,
    scope: "session" | "config",
  ): Promise<void> {
    await this.tools.rememberApproval(target, scope);
  }

  async execute(request: DesktopToolRequest): Promise<ToolExecutionOutput> {
    if (this.mcp.isFetchMcpResourceToolRequest(request as JsonValue)) {
      return createToolExecutionTextOutput(
        await this.mcp.executeFetchMcpResourceToolRequest(
          request as unknown as {
            kind: "fetchMcpResource";
            server: string;
            uri: string;
          },
        ),
      );
    }
    if (this.mcp.isLazyToolGatewayToolRequest(request as JsonValue)) {
      return createToolExecutionTextOutput(
        await executeLazyToolGatewayCall(
          (request as unknown as LazyToolGatewayToolRequest).name,
          (request as unknown as LazyToolGatewayToolRequest).argumentsJson,
          this.lazyToolGatewayBackend(),
        ),
      );
    }
    if (this.mcp.isToolRequest(request as JsonValue)) {
      return createToolExecutionTextOutput(
        await this.mcp.executeToolRequest(
          request as unknown as McpToolRequest,
          this.mcpUiOpener ? { uiOpener: this.mcpUiOpener } : undefined,
        ),
      );
    }

    const jsonRequest = request as JsonValue;
    if (isLspDiagnosticsToolRequest(jsonRequest)) {
      if (!this.lsp?.enabled) {
        throw new Error(
          "get_diagnostics is not available because no language server is installed for this workspace",
        );
      }
      const result = await executeGetDiagnostics(this.lsp, jsonRequest.paths);
      return createToolExecutionTextOutput(result);
    }

    this.assertAllowedDreamToolRequest(request);
    const output = await this.tools.execute(request);
    const normalized =
      typeof output === "string"
        ? createToolExecutionTextOutput(output)
        : {
            summaryText: output.summaryText,
            content: output.content.map((part) => {
              if (part.type === "text") {
                return createLlmTextContentPart(part.text);
              }
              if (part.type === "video") {
                return createLlmVideoContentPart(part.path);
              }
              return createLlmImageContentPart(part.path);
            }),
          };
    const withLsp = await appendLspDiagnosticsAfterWriteIfNeeded(
      this.lsp,
      request as JsonValue,
      normalized,
    );
    return withLsp;
  }

  async saveGeneratedImage(
    request: HostGeneratedImageSaveRequest,
  ): Promise<HostGeneratedImageFile> {
    return this.tools.saveGeneratedImage(request);
  }

  async saveGeneratedVideo(
    request: HostGeneratedVideoSaveRequest,
  ): Promise<HostGeneratedVideoFile> {
    return this.tools.saveGeneratedVideo(request);
  }

  attachRequestMetadata(
    request: DesktopToolRequest,
    metadata: ToolRequestExecutionMetadata,
  ): DesktopToolRequest {
    return this.tools.attachRequestMetadata(request, metadata);
  }

  async continueAfterQuestions(
    request: DesktopToolRequest,
    result: AskQuestionsResult,
  ): Promise<DesktopToolRequest | undefined> {
    if (!isExtensionToolRequest(request)) {
      return undefined;
    }

    request.questions_result = result as JsonValue;
    return request;
  }

  shouldExecuteInBackground(request: DesktopToolRequest): boolean {
    const jsonRequest = request as JsonValue;
    if (this.mcp.isFetchMcpResourceToolRequest(jsonRequest)) {
      return true;
    }
    if (this.mcp.isLazyToolGatewayToolRequest(jsonRequest)) {
      return jsonRequest.name === TOOL_CALL_TOOL_NAME;
    }
    if (this.mcp.isToolRequest(jsonRequest)) {
      return true;
    }

    return this.tools.shouldExecuteInBackground?.(request) ?? false;
  }

  backgroundStatusText(request: DesktopToolRequest): string | undefined {
    const jsonRequest = request as JsonValue;
    if (this.mcp.isFetchMcpResourceToolRequest(jsonRequest)) {
      return this.mcp.fetchMcpResourceBackgroundStatusText(jsonRequest);
    }
    if (this.mcp.isLazyToolGatewayToolRequest(jsonRequest)) {
      return this.mcp.lazyToolGatewayBackgroundStatusText(jsonRequest);
    }
    if (this.mcp.isToolRequest(jsonRequest)) {
      return this.mcp.backgroundStatusText(request as unknown as McpToolRequest);
    }

    return this.tools.backgroundStatusText?.(request);
  }

  abortRunningShell(): void {
    this.tools.abortRunningShell();
  }

  abortShell(toolCallId: string): boolean {
    return this.tools.abortShell(toolCallId);
  }

  startMcpBackgroundRefresh(): void {
    this.mcp.startBackgroundRefreshInBackground(true);
  }

  /** Await MCP tool catalog before the first LLM round (background refresh alone is too late). */
  async ensureMcpToolingReady(): Promise<void> {
    if (this.mcp.statusSnapshot().configuredServers === 0) {
      return;
    }
    await this.mcp.ensureToolingCache();
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  mcpToolCatalogSnapshot(): ToolAgentMcpToolCatalogSnapshot {
    return mergeLazyToolCatalogSnapshots(this.mcp.catalogSnapshot(), this.builtInLazyToolIndex());
  }

  mcpCatalogRevision(): number {
    return this.mcp.catalogRevision();
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    return this.tools.addMcpServer(name, config);
  }

  async listMcpServers(): Promise<unknown[]> {
    return this.mcp.listServers();
  }

  async inspectMcpServer(name: string): Promise<unknown> {
    return this.mcp.inspectServer(name);
  }

  async listMcpTools(name: string): Promise<unknown[]> {
    return this.mcp.listTools(name);
  }

  async listMcpResources(name: string): Promise<unknown[]> {
    return this.mcp.listResources(name);
  }

  private builtInLazyToolIndex(): BuiltInLazyToolIndexEntry[] {
    if (!this.hostContributedToolsEnabled) {
      return [];
    }

    return filterContributedToolDefinitionsForAgentMode(
      DESKTOP_BUILT_IN_LAZY_TOOL_DEFINITIONS,
      this.agentMode,
    ).map((definition) => toBuiltInLazyToolIndexEntry(definition));
  }

  private lazyToolGatewayBackend() {
    return createCompositeLazyToolGatewayBackend({
      mcp: createMcpLazyToolGatewayBackend(
        this.mcp,
        this.mcpUiOpener ? { uiOpener: this.mcpUiOpener } : undefined,
      ),
      builtIn: createBuiltInLazyToolGatewayBackendWithCall(
        this.builtInLazyToolIndex(),
        async (callRequest) => {
          if (
            callRequest.provider !== LAZY_TOOL_PROVIDER_BUILT_IN ||
            callRequest.server !== LAZY_BUILT_IN_SERVER_DESKTOP ||
            callRequest.tool !== CREATE_AUTOMATION_TOOL_NAME
          ) {
            throw new Error(`Unknown built-in tool: ${callRequest.server}/${callRequest.tool}`);
          }

          const args = parseBuiltInLazyToolCallArguments(callRequest);
          const hostRequest = await this.tools.requestFromFunctionCall(
            CREATE_AUTOMATION_TOOL_NAME,
            JSON.stringify(args),
          );
          const output = await this.tools.execute(hostRequest);
          return typeof output === "string" ? output : output.summaryText;
        },
      ),
    });
  }

  private authorizeLazyToolGateway(request: LazyToolGatewayToolRequest): AuthorizationDecision {
    if (request.name === TOOL_CALL_TOOL_NAME && this.approvalLevel !== "bypass-approval") {
      const parsed = parseLazyToolGatewayArguments(request.name, request.argumentsJson);
      if (
        parsed.provider === LAZY_TOOL_PROVIDER_BUILT_IN &&
        parsed.server === LAZY_BUILT_IN_SERVER_DESKTOP &&
        parsed.tool === CREATE_AUTOMATION_TOOL_NAME &&
        "arguments" in parsed
      ) {
        try {
          const preview = previewCreateAutomationFromArguments(
            parseBuiltInLazyToolCallArguments(parsed),
          );
          return {
            kind: "need-approval",
            prompt: buildCreateAutomationApprovalPrompt(preview),
          };
        } catch {
          // Fall through to generic lazy gateway authorization.
        }
      }
    }

    return authorizeLazyToolGatewayRequest(
      request,
      this.approvalLevel,
      resolveMcpToolCallApprovalAnnotations(request, (server, tool) =>
        this.mcp.lookupToolApprovalAnnotations(server, tool),
      ),
    );
  }

  private assertAllowedDreamToolRequest(request: DesktopToolRequest): void {
    if (!isDreamToolRequest(request)) {
      return;
    }
    if (!this.dreamToolMode) {
      throw new Error(`Dream tools are not enabled for this runtime: ${request.name}`);
    }
    if (this.dreamToolMode === "read-only" && !READ_ONLY_DREAM_TOOL_NAMES.has(request.name)) {
      throw new Error(`Dream tool is not available in read-only mode: ${request.name}`);
    }
  }

  async readMcpResource(name: string, uri: string): Promise<JsonValue> {
    return this.mcp.readResource(name, uri);
  }

  async listCachedMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listCachedPrompts(name);
  }

  async listMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listPrompts(name);
  }

  async getMcpPrompt(name: string, prompt: string, _argsJson?: string): Promise<JsonValue> {
    return this.mcp.getPrompt(name, prompt, _argsJson);
  }
}

function isExtensionToolRequest(
  request: DesktopToolRequest,
): request is Extract<DesktopToolRequest, { name: "extension_tool" }> {
  return typeof request === "object" && request !== null && request.name === "extension_tool";
}

function mergeToolDefinitions(...definitions: JsonValue[]): JsonValue {
  const seenNames = new Set<string>();

  return definitions.filter((definition) => {
    const name = toolDefinitionName(definition);
    if (!name) {
      return true;
    }
    if (seenNames.has(name)) {
      console.warn(`[desktop-host] duplicate tool definition dropped: ${name}`);
      return false;
    }
    seenNames.add(name);
    return true;
  });
}

function toolDefinitionName(value: JsonValue): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidateFunction = "function" in value ? value.function : undefined;
  if (
    typeof candidateFunction !== "object" ||
    candidateFunction === null ||
    Array.isArray(candidateFunction)
  ) {
    return undefined;
  }

  return typeof candidateFunction.name === "string" ? candidateFunction.name : undefined;
}
