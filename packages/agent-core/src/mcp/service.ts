import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { JsonValue } from "../ports.js";
import {
  buildLazyToolGatewayDefinitions,
  buildFetchMcpResourceDefinition,
  createMcpLazyToolGatewayBackend,
  executeFetchMcpResourceCall,
  executeLazyToolGatewayCall,
  isFetchMcpResourceToolName,
  isFetchMcpResourceToolRequest as isFetchMcpResourceToolRequestValue,
  isLazyToolGatewayToolName,
  isLazyToolGatewayToolRequest as isLazyToolGatewayToolRequestValue,
  parseFetchMcpResourceArguments,
} from "../tool-gateway/index.js";
import {
  parseMcpConfigFile,
  resolveEnvRecord,
  mcpUserConfigPath,
  mcpWorkspaceConfigPath,
  mergeMcpConfigFiles,
  mcpServerScopesFromFiles,
  spiritDataDir,
  type McpConfigScope,
  normalizeMcpServerConfig,
} from "./config.js";
import { SdkMcpConnection } from "./client.js";
import {
  aggregateListedResourcesForServer,
  buildMcpToolCatalogSnapshot,
  findResourceIndexEntry,
} from "./catalog-snapshot.js";
import { parseMcpToolApprovalAnnotations } from "./approval-annotations.js";
import { McpConfigError } from "./errors.js";
import { McpRegistry } from "./registry.js";
import {
  SPIRIT_UI_CALL_TOOL_TIMEOUT_MS,
  type ExtensionMcpServerOwnership,
  type McpUiOpener,
} from "./spirit-ui.js";
import type {
  McpCapabilityToggles,
  McpConfigFile,
  McpServerConfig,
  McpServerRuntimeState,
  McpResourceIndexEntry,
  McpToolApprovalAnnotations,
  McpToolIndexEntry,
  ResolvedMcpServerConfig,
  ResolvedMcpTransportConfig,
  ToolAgentMcpToolCatalogSnapshot,
} from "./types.js";
import {
  buildWindowsCommandCandidates,
  isWindowsPlatform,
  splitWindowsPathEntries,
  splitWindowsPathExtEntries,
} from "./windows.js";

const WINDOWS_USER_ENV_REGISTRY_PATH = "HKCU\\Environment";
const WINDOWS_MACHINE_ENV_REGISTRY_PATH =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

interface McpPromptCatalogEntry {
  name: string;
  title?: string;
  description?: string;
  arguments: Array<{
    name: string;
    description?: string;
    required: boolean;
  }>;
}

export interface McpToolRequest {
  [key: string]: JsonValue;
  kind: "mcpTool";
  name: string;
  server: string;
  displayName: string;
  toolName: string;
  arguments: JsonValue;
}

interface LoadedMcpConfig {
  raw: McpConfigFile;
  resolved: Record<string, ResolvedMcpServerConfig>;
  serverScopes: Record<string, McpConfigScope>;
}

type EnvLookupStore = Map<string, string>;

interface UserMcpToolingCacheEntry {
  digest: string;
  indexEntries: McpToolIndexEntry[];
  resourceEntries: McpResourceIndexEntry[];
  prompts: Map<string, McpPromptCatalogEntry[]>;
  serverStates: Map<
    string,
    { state: McpServerRuntimeState; cachedTools: number; lastError?: string }
  >;
}

/** User-scope MCP tooling is shared across workspace McpService instances (desktop session switches). */
let sharedUserMcpToolingCache: UserMcpToolingCacheEntry | undefined;

export function invalidateSharedUserMcpToolingCache(): void {
  sharedUserMcpToolingCache = undefined;
}

export interface McpExtraConfigFile extends McpConfigFile {
  /** Extension MCP ownership; never written to user/workspace mcp.json. */
  extensionServerOwnership?: Record<string, ExtensionMcpServerOwnership>;
}

export type McpExtraConfigProvider = () => McpExtraConfigFile | Promise<McpExtraConfigFile>;

export interface McpCallToolOptions {
  uiOpener?: McpUiOpener;
}

export interface McpServiceOptions {
  extraConfigs?: McpExtraConfigProvider;
}

export class McpService {
  private readonly registry = new McpRegistry();
  private loadedConfigStore: LoadedMcpConfig = {
    raw: { servers: {} },
    resolved: {},
    serverScopes: {},
  };
  private configDigestStore = mcpConfigDigest({ servers: {} });
  private toolIndexStore: McpToolIndexEntry[] = [];
  private resourceIndexStore: McpResourceIndexEntry[] = [];
  private catalogRevisionStore = 0;
  private promptCatalogStore = new Map<string, McpPromptCatalogEntry[]>();
  private loadErrorStore: string | undefined;
  private windowsEnvLookupPromise: Promise<EnvLookupStore> | undefined;
  private toolingRefreshPromise: Promise<void> | undefined;
  private toolingCacheInitialized = false;
  private extensionServerOwnershipStore: Record<string, ExtensionMcpServerOwnership> = {};

  constructor(
    private readonly workspaceRootStore = process.cwd(),
    private readonly includeWorkspaceConfig = true,
    private readonly serviceOptions: McpServiceOptions = {},
  ) {
    this.registry.replaceConfig({ servers: {} });
  }

  toolDefinitionsJson(): JsonValue[] {
    const definitions: JsonValue[] = [];
    if (this.toolIndexStore.length > 0) {
      definitions.push(...buildLazyToolGatewayDefinitions());
    }
    if (this.resourceIndexStore.length > 0) {
      definitions.push(buildFetchMcpResourceDefinition());
    }
    return definitions;
  }

  catalogRevision(): number {
    return this.catalogRevisionStore;
  }

  catalogSnapshot(): ToolAgentMcpToolCatalogSnapshot {
    return buildMcpToolCatalogSnapshot(
      this.toolIndexStore,
      this.resourceIndexStore,
      this.registry,
      this.loadedConfigStore.resolved,
    );
  }

  async describeTool(
    serverName: string,
    toolName: string,
  ): Promise<{ description: string; inputSchema: JsonValue }> {
    await this.ensureToolingCache();
    const entry = findToolIndexEntry(this.toolIndexStore, serverName, toolName);
    if (!entry) {
      throw new McpConfigError(`Unknown MCP tool: ${serverName}/${toolName}`);
    }

    return {
      description: entry.description,
      inputSchema: entry.inputSchema,
    };
  }

  lookupToolApprovalAnnotations(
    serverName: string,
    toolName: string,
  ): McpToolApprovalAnnotations | undefined {
    return findToolIndexEntry(this.toolIndexStore, serverName, toolName)?.annotations;
  }

  isLazyToolGatewayToolRequest(
    value: JsonValue,
  ): value is import("../tool-gateway/types.js").LazyToolGatewayToolRequest {
    return isLazyToolGatewayToolRequestValue(value);
  }

  async executeLazyToolGatewayToolRequest(
    request: import("../tool-gateway/types.js").LazyToolGatewayToolRequest,
    options?: McpCallToolOptions,
  ): Promise<string> {
    const backend = createMcpLazyToolGatewayBackend(this, options);
    return executeLazyToolGatewayCall(request.name, request.argumentsJson, backend);
  }

  lazyToolGatewayBackgroundStatusText(value: JsonValue): string | undefined {
    // Status is shown on the tool card; do not write it into thinking aux (consistent with host-internal shell/web_fetch).
    void value;
    return undefined;
  }

  isToolRequest(value: JsonValue): value is McpToolRequest {
    return isMcpToolRequest(value);
  }

  backgroundStatusText(value: JsonValue): string | undefined {
    // Status is shown on the tool card; do not write it into thinking aux.
    void value;
    return undefined;
  }

  statusSnapshot(): {
    revision: number;
    state: "idle" | "loading" | "ready" | "error";
    configuredServers: number;
    loadedServers: number;
    cachedTools: number;
    lastError?: string;
  } {
    const snapshot = this.registry.snapshot();
    if (this.loadErrorStore === undefined) {
      return snapshot;
    }

    return {
      ...snapshot,
      state: "error",
      lastError: this.loadErrorStore,
    };
  }

  async ensureToolingCache(): Promise<void> {
    if (this.toolingCacheInitialized) {
      return;
    }

    this.ensureToolingCacheInBackground();
    if (this.toolingRefreshPromise) {
      await this.toolingRefreshPromise;
    }
  }

  ensureToolingCacheInBackground(): void {
    this.launchBackgroundRefresh(false);
  }

  async refreshConfig(): Promise<void> {
    try {
      const extra = await this.loadExtraConfig();
      const { merged, serverScopes, user } = await loadMergedMcpConfigForWorkspace(
        this.workspaceRootStore,
        { includeWorkspace: this.includeWorkspaceConfig },
      );
      const raw = mergeMcpConfigFiles(extra, merged);
      this.extensionServerOwnershipStore = retainUnoverlaidExtensionOwnership(
        extra.extensionServerOwnership,
        extra.servers,
        merged.servers,
      );
      const nextDigest = mcpConfigDigest(raw);
      const nextUserDigest = mcpConfigDigest(user);
      if (sharedUserMcpToolingCache && sharedUserMcpToolingCache.digest !== nextUserDigest) {
        sharedUserMcpToolingCache = undefined;
      }
      const configChanged = nextDigest !== this.configDigestStore;
      if (configChanged) {
        this.registry.replaceConfig(raw);
      }
      const lookup = await this.buildEnvLookupStore();
      const resolvedEntries = await Promise.all(
        Object.entries(raw.servers).map(async ([name, server]) => {
          const resolved = await resolveRuntimeServerConfig(
            name,
            server,
            this.workspaceRootStore,
            lookup,
          );
          return [name, resolved] as const;
        }),
      );

      this.loadedConfigStore = {
        raw,
        resolved: Object.fromEntries(resolvedEntries),
        serverScopes,
      };
      if (configChanged) {
        this.configDigestStore = nextDigest;
        this.toolingCacheInitialized = false;
      }
      this.loadErrorStore = undefined;
    } catch (error) {
      this.loadErrorStore = describeError(error);
      this.toolIndexStore = [];
      this.catalogRevisionStore += 1;
      this.promptCatalogStore = new Map<string, McpPromptCatalogEntry[]>();
      throw error;
    }
  }

  private async loadExtraConfig(): Promise<McpExtraConfigFile> {
    const provider = this.serviceOptions.extraConfigs;
    if (!provider) {
      return { servers: {} };
    }
    try {
      return await provider();
    } catch (error) {
      console.warn("[mcp-service] extraConfigs.failed", { error: describeError(error) });
      return { servers: {} };
    }
  }

  async startBackgroundRefresh(): Promise<void> {
    this.launchBackgroundRefresh(true);
    if (this.toolingRefreshPromise) {
      await this.toolingRefreshPromise;
    }
  }

  startBackgroundRefreshInBackground(force = true): void {
    this.launchBackgroundRefresh(force);
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<
    | {
        kind: "lazyToolGateway";
        name: string;
        argumentsJson: string;
      }
    | {
        kind: "fetchMcpResource";
        server: string;
        uri: string;
      }
    | undefined
  > {
    if (isFetchMcpResourceToolName(name)) {
      const parsed = parseFetchMcpResourceArguments(argumentsJson);
      return {
        kind: "fetchMcpResource",
        server: parsed.server,
        uri: parsed.uri,
      };
    }

    if (!isLazyToolGatewayToolName(name)) {
      return undefined;
    }

    return {
      kind: "lazyToolGateway",
      name,
      argumentsJson,
    };
  }

  isFetchMcpResourceToolRequest(
    value: JsonValue,
  ): value is import("../tool-gateway/fetch-mcp-resource.js").FetchMcpResourceToolRequest {
    return isFetchMcpResourceToolRequestValue(value);
  }

  async executeFetchMcpResourceToolRequest(
    request: import("../tool-gateway/fetch-mcp-resource.js").FetchMcpResourceToolRequest,
  ): Promise<string> {
    return executeFetchMcpResourceCall({ server: request.server, uri: request.uri }, this);
  }

  fetchMcpResourceBackgroundStatusText(value: JsonValue): string | undefined {
    // Status is shown on the tool card; do not write it into thinking aux.
    void value;
    return undefined;
  }

  async assertResourceReadable(server: string, uri: string): Promise<void> {
    await this.ensureToolingCache();
    const snapshot = this.catalogSnapshot();
    if (snapshot.resourcesTruncated) {
      return;
    }

    if (!findResourceIndexEntry(this.resourceIndexStore, server, uri)) {
      throw new McpConfigError(`Unknown MCP resource: ${server}/${uri}`);
    }
  }

  async createToolRequest(
    serverName: string,
    toolName: string,
    argsJson?: string,
  ): Promise<McpToolRequest> {
    await this.refreshConfig();

    const server = this.loadedConfigStore.resolved[serverName];
    if (!server) {
      throw new McpConfigError(`Unknown MCP server: ${serverName}`);
    }

    return {
      kind: "mcpTool",
      name: `${server.name}/${toolName}`,
      server: server.name,
      displayName: server.displayName,
      toolName,
      arguments: parseOptionalJsonValue(argsJson),
    };
  }

  async authorizeToolRequest(request: McpToolRequest): Promise<void> {
    const server = await this.requireConnectableServer(request.server);
    if (!server.capabilities.tools) {
      throw new McpConfigError(`MCP server ${server.name} does not have tools capability enabled`);
    }
  }

  async callTool(
    serverName: string,
    toolName: string,
    argsJson?: string,
    options?: McpCallToolOptions,
  ): Promise<JsonValue> {
    const request = await this.createToolRequest(serverName, toolName, argsJson);
    return this.callToolRequest(request, options);
  }

  async executeToolRequest(request: McpToolRequest, options?: McpCallToolOptions): Promise<string> {
    const result = await this.callToolRequest(request, options);
    return JSON.stringify(result, null, 2);
  }

  lookupExtensionServerOwnership(serverName: string): ExtensionMcpServerOwnership | undefined {
    return this.extensionServerOwnershipStore[serverName];
  }

  async callToolRequest(request: McpToolRequest, options?: McpCallToolOptions): Promise<JsonValue> {
    const server = await this.requireConnectableServer(request.server);

    return this.withConnection(
      server,
      async (connection) => {
        const capabilities = connection.serverCapabilities;
        assertToolCapability(server, capabilities);
        const argumentsValue = request.arguments;
        let args: Record<string, unknown> | undefined;
        if (isJsonRecord(argumentsValue)) {
          args = argumentsValue;
        } else if (argumentsValue !== null) {
          throw new McpConfigError("MCP tool arguments must be a JSON object");
        }

        const result = await connection.callTool(
          request.toolName,
          args,
          options?.uiOpener ? { timeoutMs: SPIRIT_UI_CALL_TOOL_TIMEOUT_MS } : undefined,
        );
        this.registry.clearServerError(server.name);
        this.registry.setServerState(server.name, "ready", {
          cachedTools: this.registry.get(server.name)?.cachedTools ?? 0,
        });
        return result as JsonValue;
      },
      options,
    );
  }

  async listServers(): Promise<JsonValue[]> {
    try {
      await this.refreshConfig();
    } catch (error) {
      if (Object.keys(this.loadedConfigStore.raw.servers).length === 0) {
        throw error;
      }
    }

    return Object.entries(this.loadedConfigStore.raw.servers)
      .filter(([name]) => {
        const scope = this.loadedConfigStore.serverScopes[name];
        return scope === "user" || scope === "workspace";
      })
      .map(([name, server]) =>
        buildManagedServerForRust(
          name,
          server,
          this.loadedConfigStore.resolved[name],
          this.loadedConfigStore.serverScopes[name],
        ),
      );
  }

  /** When startup refreshToolingCaches already populated registry / promptCatalog, the settings page does not need to reconnect MCP. */
  private inspectFromCache(name: string): JsonValue | null {
    const server = this.loadedConfigStore.resolved[name];
    if (!server?.enabled) {
      return null;
    }

    const status = this.registry.get(name);
    if (status?.state !== "ready" || !this.toolingCacheInitialized) {
      return null;
    }

    return {
      name: server.name,
      displayName: server.displayName,
      supportsTools: server.capabilities.tools,
      supportsResources: server.capabilities.resources,
      supportsPrompts: server.capabilities.prompts,
      toolsCount: status.cachedTools,
      resourcesCount: this.resourceIndexStore.filter((entry) => entry.server === name).length,
      promptsCount: (this.promptCatalogStore.get(name) ?? []).length,
    };
  }

  async inspectServer(name: string): Promise<JsonValue> {
    await this.ensureToolingCache();
    const cached = this.inspectFromCache(name);
    if (cached) {
      return cached;
    }

    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      const serverVersion = connection.serverVersion;
      const supportsTools = server.capabilities.tools && capabilities?.tools !== undefined;
      const supportsResources =
        server.capabilities.resources && capabilities?.resources !== undefined;
      const supportsPrompts = server.capabilities.prompts && capabilities?.prompts !== undefined;
      const toolsResult = supportsTools ? await connection.listTools() : { tools: [] };
      const resourcesResult = supportsResources
        ? await connection.listResources()
        : { resources: [] };
      const resourceTemplatesResult = supportsResources
        ? await connection.listResourceTemplates()
        : { resourceTemplates: [] };
      const promptsResult = supportsPrompts ? await connection.listPrompts() : { prompts: [] };

      this.registry.setServerState(server.name, "ready", {
        cachedTools: toolsResult.tools.length,
      });

      return {
        name: server.name,
        displayName: server.displayName,
        protocolVersion: connection.protocolVersion,
        serverName: serverVersion?.name ?? server.name,
        ...(serverVersion?.title === undefined ? {} : { serverTitle: serverVersion.title }),
        serverVersion: serverVersion?.version ?? "unknown",
        ...(serverVersion?.description === undefined
          ? {}
          : { serverDescription: serverVersion.description }),
        ...(connection.instructions === undefined ? {} : { instructions: connection.instructions }),
        supportsTools,
        supportsResources,
        supportsPrompts,
        supportsLogging: capabilities?.logging !== undefined,
        supportsCompletions: capabilities?.completions !== undefined,
        toolsListChanged: capabilities?.tools?.listChanged ?? false,
        resourcesListChanged: capabilities?.resources?.listChanged ?? false,
        promptsListChanged: capabilities?.prompts?.listChanged ?? false,
        toolsCount: toolsResult.tools.length,
        resourcesCount: resourcesResult.resources.length,
        resourceTemplatesCount: resourceTemplatesResult.resourceTemplates.length,
        promptsCount: promptsResult.prompts.length,
      };
    });
  }

  async listTools(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.tools && capabilities?.tools !== undefined)) {
        this.registry.setServerState(server.name, "ready", { cachedTools: 0 });
        return [];
      }

      const result = await connection.listTools();
      const tools = result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema as unknown as JsonValue,
      }));
      this.registry.setServerState(server.name, "ready", { cachedTools: tools.length });
      return tools;
    });
  }

  async listResources(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.resources && capabilities?.resources !== undefined)) {
        this.registry.setServerState(server.name, "ready");
        return [];
      }

      const result = await connection.listResources();
      this.registry.setServerState(server.name, "ready");
      return result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.title === undefined ? {} : { title: resource.title }),
        ...(resource.description === undefined ? {} : { description: resource.description }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
        ...(resource.size === undefined ? {} : { size: resource.size }),
      }));
    });
  }

  async readResource(name: string, uri: string): Promise<JsonValue> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      assertResourceCapability(server, capabilities);
      const result = await connection.readResource(uri);
      this.registry.setServerState(server.name, "ready");
      return result as JsonValue;
    });
  }

  async listPrompts(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.prompts && capabilities?.prompts !== undefined)) {
        this.registry.setServerState(server.name, "ready");
        return [];
      }

      const result = await connection.listPrompts();
      this.registry.setServerState(server.name, "ready");
      return result.prompts.map((prompt) => ({
        name: prompt.name,
        ...(prompt.title === undefined ? {} : { title: prompt.title }),
        ...(prompt.description === undefined ? {} : { description: prompt.description }),
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          ...(argument.description === undefined ? {} : { description: argument.description }),
          required: argument.required ?? false,
        })),
      }));
    });
  }

  async listCachedPrompts(name: string): Promise<JsonValue[]> {
    this.ensureToolingCacheInBackground();

    if (Object.keys(this.loadedConfigStore.raw.servers).length === 0) {
      this.primeRegistryFromDisk();
    }

    const server = this.loadedConfigStore.raw.servers[name];
    if (!server || server.enabled === false || server.capabilities?.prompts === false) {
      return [];
    }

    return (this.promptCatalogStore.get(name) ?? []).map((prompt) => ({
      name: prompt.name,
      ...(prompt.title === undefined ? {} : { title: prompt.title }),
      ...(prompt.description === undefined ? {} : { description: prompt.description }),
      arguments: prompt.arguments.map((argument) => ({
        name: argument.name,
        ...(argument.description === undefined ? {} : { description: argument.description }),
        required: argument.required,
      })),
    }));
  }

  async getPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue> {
    const server = await this.requireConnectableServer(name);
    const args = parsePromptArguments(argsJson);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      assertPromptCapability(server, capabilities);
      const result = await connection.getPrompt(prompt, args);
      this.registry.setServerState(server.name, "ready");
      return result as JsonValue;
    });
  }

  private async requireConnectableServer(name: string): Promise<ResolvedMcpServerConfig> {
    await this.refreshConfig();
    const server = this.loadedConfigStore.resolved[name];
    if (!server) {
      throw new McpConfigError(`Unknown MCP server: ${name}`);
    }
    if (!server.enabled) {
      throw new McpConfigError(`MCP server ${name} is disabled; enable it first.`);
    }
    return server;
  }

  private async withConnection<T>(
    server: ResolvedMcpServerConfig,
    operation: (connection: SdkMcpConnection) => Promise<T>,
    options?: McpCallToolOptions,
  ): Promise<T> {
    this.registry.setServerState(server.name, "loading");
    const connection = new SdkMcpConnection(undefined, {
      ...(this.extensionServerOwnershipStore[server.name]
        ? { ownership: this.extensionServerOwnershipStore[server.name] }
        : {}),
      ...(options?.uiOpener ? { opener: options.uiOpener } : {}),
    });

    try {
      await connection.connect(server);
      return await operation(connection);
    } catch (error) {
      this.registry.setServerState(server.name, "error", {
        lastError: describeError(error),
      });
      throw error;
    } finally {
      await closeConnectionQuietly(connection, `withConnection:${server.name}`);
    }
  }

  private async buildEnvLookupStore(): Promise<EnvLookupStore> {
    const lookup = new Map<string, string>();
    const processKeys = new Set<string>();

    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value !== "string") {
        continue;
      }

      const normalized = normalizeEnvKey(key);
      processKeys.add(normalized);
      lookup.set(normalized, value);
    }

    if (!isWindowsPlatform()) {
      return lookup;
    }

    const persisted = await this.loadWindowsEnvLookupStore();
    for (const [key, value] of persisted) {
      if (processKeys.has(key)) {
        continue;
      }

      lookup.set(key, value);
    }

    return lookup;
  }

  private async loadWindowsEnvLookupStore(): Promise<EnvLookupStore> {
    if (this.windowsEnvLookupPromise) {
      return this.windowsEnvLookupPromise;
    }

    this.windowsEnvLookupPromise = (async () => {
      const lookup = new Map<string, string>();
      const machine = await queryWindowsRegistryEnvironment(WINDOWS_MACHINE_ENV_REGISTRY_PATH);
      const user = await queryWindowsRegistryEnvironment(WINDOWS_USER_ENV_REGISTRY_PATH);

      for (const [key, value] of Object.entries(machine)) {
        lookup.set(normalizeEnvKey(key), value);
      }
      for (const [key, value] of Object.entries(user)) {
        lookup.set(normalizeEnvKey(key), value);
      }

      return lookup;
    })();

    return this.windowsEnvLookupPromise;
  }

  private async refreshToolingCaches(): Promise<void> {
    await this.refreshConfig();
    const userServers: ResolvedMcpServerConfig[] = [];
    const workspaceServers: ResolvedMcpServerConfig[] = [];
    for (const server of Object.values(this.loadedConfigStore.resolved)) {
      if (!server.enabled) {
        continue;
      }
      const scope = this.loadedConfigStore.serverScopes[server.name] ?? "workspace";
      if (scope === "user") {
        userServers.push(server);
      } else {
        workspaceServers.push(server);
      }
    }

    const indexEntries: McpToolIndexEntry[] = [];
    const resourceEntries: McpResourceIndexEntry[] = [];
    const prompts = new Map<string, McpPromptCatalogEntry[]>();

    const { user: userConfigFile } = await loadMergedMcpConfigForWorkspace(
      this.workspaceRootStore,
      { includeWorkspace: this.includeWorkspaceConfig },
    );
    const currentUserDigest = mcpConfigDigest(userConfigFile);

    let userCacheHit = false;
    if (
      userServers.length > 0 &&
      sharedUserMcpToolingCache &&
      sharedUserMcpToolingCache.digest === currentUserDigest
    ) {
      const cached = sharedUserMcpToolingCache;
      if (!Array.isArray(cached.resourceEntries)) {
        // After an in-process hot update the old cache has no resourceEntries; discard it and rediscover below
        sharedUserMcpToolingCache = undefined;
      } else {
        userCacheHit = true;
        indexEntries.push(...cached.indexEntries);
        resourceEntries.push(...cached.resourceEntries);
        for (const [serverName, entries] of cached.prompts) {
          prompts.set(serverName, entries);
        }
        for (const [serverName, status] of cached.serverStates) {
          this.registry.setServerState(serverName, status.state, {
            cachedTools: status.cachedTools,
            ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
          });
        }
      }
    }
    if (!userCacheHit && userServers.length > 0) {
      const userIndexEntries: McpToolIndexEntry[] = [];
      const userResourceEntries: McpResourceIndexEntry[] = [];
      const userPrompts = new Map<string, McpPromptCatalogEntry[]>();
      const userServerStates = new Map<
        string,
        { state: McpServerRuntimeState; cachedTools: number; lastError?: string }
      >();
      for (const server of userServers) {
        const status = await this.discoverServerTooling(
          server,
          userIndexEntries,
          userResourceEntries,
          userPrompts,
        );
        userServerStates.set(server.name, status);
      }
      sharedUserMcpToolingCache = {
        digest: currentUserDigest,
        indexEntries: [...userIndexEntries],
        resourceEntries: [...userResourceEntries],
        prompts: new Map(userPrompts),
        serverStates: new Map(userServerStates),
      };
      indexEntries.push(...userIndexEntries);
      resourceEntries.push(...userResourceEntries);
      for (const [serverName, entries] of userPrompts) {
        prompts.set(serverName, entries);
      }
    }

    console.error("[mcp-service] refreshToolingCaches.start", {
      servers: userServers.length + workspaceServers.length,
      userCacheHit,
      userServers: userServers.length,
      workspaceServers: workspaceServers.length,
    });

    for (const server of workspaceServers) {
      await this.discoverServerTooling(server, indexEntries, resourceEntries, prompts);
    }

    this.toolIndexStore = indexEntries;
    this.resourceIndexStore = resourceEntries;
    this.catalogRevisionStore += 1;
    this.promptCatalogStore = prompts;
    this.toolingCacheInitialized = true;
    console.error("[mcp-service] refreshToolingCaches.done", {
      indexedTools: indexEntries.length,
      indexedResources: resourceEntries.length,
      promptServers: prompts.size,
      userCacheHit,
    });
  }

  private async discoverServerTooling(
    server: ResolvedMcpServerConfig,
    indexEntries: McpToolIndexEntry[],
    resourceEntries: McpResourceIndexEntry[],
    prompts: Map<string, McpPromptCatalogEntry[]>,
  ): Promise<{ state: McpServerRuntimeState; cachedTools: number; lastError?: string }> {
    this.registry.setServerState(server.name, "loading", { cachedTools: 0 });
    const connection = new SdkMcpConnection();
    try {
      await connection.connect(server);
      const capabilities = connection.serverCapabilities;
      const discoveredTools =
        server.capabilities.tools && capabilities?.tools !== undefined
          ? (await connection.listTools()).tools
          : [];
      const discoveredResources =
        server.capabilities.resources && capabilities?.resources !== undefined
          ? (await connection.listResources()).resources
          : [];
      const discoveredPrompts =
        server.capabilities.prompts && capabilities?.prompts !== undefined
          ? (await connection.listPrompts()).prompts
          : [];

      for (const tool of discoveredTools) {
        const description =
          tool.description ?? `MCP tool ${tool.name} from server ${server.displayName}.`;
        const inputSchema = isJsonRecord(tool.inputSchema)
          ? (tool.inputSchema as JsonValue)
          : {
              type: "object",
              additionalProperties: true,
            };
        const annotations = parseMcpToolApprovalAnnotations(tool.annotations);

        indexEntries.push({
          server: server.name,
          displayName: server.displayName,
          toolName: tool.name,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        });
      }

      resourceEntries.push(
        ...aggregateListedResourcesForServer(
          server.name,
          discoveredResources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            ...(resource.description === undefined ? {} : { description: resource.description }),
            ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
          })),
        ),
      );

      prompts.set(
        server.name,
        discoveredPrompts.map((prompt) => ({
          name: prompt.name,
          ...(prompt.title === undefined ? {} : { title: prompt.title }),
          ...(prompt.description === undefined ? {} : { description: prompt.description }),
          arguments: (prompt.arguments ?? []).map((argument) => ({
            name: argument.name,
            ...(argument.description === undefined ? {} : { description: argument.description }),
            required: argument.required ?? false,
          })),
        })),
      );

      this.registry.clearServerError(server.name);
      this.registry.setServerState(server.name, "ready", {
        cachedTools: discoveredTools.length,
      });
      return { state: "ready", cachedTools: discoveredTools.length };
    } catch (error) {
      const lastError = describeError(error);
      this.registry.setServerState(server.name, "error", {
        cachedTools: 0,
        lastError,
      });
      return { state: "error", cachedTools: 0, lastError };
    } finally {
      await closeConnectionQuietly(connection, `refreshToolingCaches:${server.name}`);
    }
  }

  private launchBackgroundRefresh(force: boolean): void {
    if (this.toolingRefreshPromise) {
      return;
    }

    if (!force && this.toolingCacheInitialized) {
      return;
    }

    this.toolingCacheInitialized = false;
    this.primeRegistryFromDisk();
    const refreshPromise = this.refreshToolingCaches();
    const settledPromise = refreshPromise.finally(() => {
      if (this.toolingRefreshPromise === refreshPromise) {
        this.toolingRefreshPromise = undefined;
      }
    });
    void settledPromise.catch((error) => {
      console.error("[mcp-service] refreshToolingCaches.failed", {
        error: describeError(error),
      });
    });
    this.toolingRefreshPromise = refreshPromise;
  }

  private primeRegistryFromDisk(): void {
    try {
      const { merged, serverScopes } = loadMergedMcpConfigForWorkspaceSync(
        this.workspaceRootStore,
        { includeWorkspace: this.includeWorkspaceConfig },
      );
      const raw = merged;
      const nextDigest = mcpConfigDigest(raw);
      this.loadedConfigStore = {
        raw,
        resolved: {},
        serverScopes,
      };
      if (nextDigest !== this.configDigestStore) {
        this.registry.replaceConfig(raw);
        this.configDigestStore = nextDigest;
      }
      this.loadErrorStore = undefined;
    } catch (error) {
      this.loadedConfigStore = {
        raw: { servers: {} },
        resolved: {},
        serverScopes: {},
      };
      this.registry.replaceConfig({ servers: {} });
      this.configDigestStore = mcpConfigDigest({ servers: {} });
      this.loadErrorStore = describeError(error);
    }
  }
}

function retainUnoverlaidExtensionOwnership(
  ownership: Record<string, ExtensionMcpServerOwnership> | undefined,
  extraServers: Record<string, McpServerConfig>,
  overlaidServers: Record<string, McpServerConfig>,
): Record<string, ExtensionMcpServerOwnership> {
  const retained: Record<string, ExtensionMcpServerOwnership> = {};
  for (const [name, entry] of Object.entries(ownership ?? {})) {
    if (name in extraServers && !(name in overlaidServers)) {
      retained[name] = entry;
    }
  }
  return retained;
}

function mcpConfigDigest(config: McpConfigFile): string {
  return createHash("sha1").update(JSON.stringify(config)).digest("hex");
}

function resolveMcpConfigPaths(workspaceRoot: string): { userPath: string; workspacePath: string } {
  return {
    userPath: mcpUserConfigPath(spiritDataDir()),
    workspacePath: mcpWorkspaceConfigPath(workspaceRoot),
  };
}

type LoadMergedMcpConfigOptions = {
  includeWorkspace?: boolean;
};

async function loadMergedMcpConfigForWorkspace(
  workspaceRoot: string,
  options: LoadMergedMcpConfigOptions = {},
): Promise<{
  merged: McpConfigFile;
  serverScopes: Record<string, McpConfigScope>;
  user: McpConfigFile;
}> {
  const includeWorkspace = options.includeWorkspace !== false;
  const { userPath, workspacePath } = resolveMcpConfigPaths(workspaceRoot);
  const user = await loadMcpConfigFile(userPath);
  const workspace = includeWorkspace ? await loadMcpConfigFile(workspacePath) : { servers: {} };
  return {
    merged: mergeMcpConfigFiles(user, workspace),
    serverScopes: mcpServerScopesFromFiles(user, workspace),
    user,
  };
}

function loadMergedMcpConfigForWorkspaceSync(
  workspaceRoot: string,
  options: LoadMergedMcpConfigOptions = {},
): {
  merged: McpConfigFile;
  serverScopes: Record<string, McpConfigScope>;
} {
  const includeWorkspace = options.includeWorkspace !== false;
  const { userPath, workspacePath } = resolveMcpConfigPaths(workspaceRoot);
  const user = loadMcpConfigFileSync(userPath);
  const workspace = includeWorkspace ? loadMcpConfigFileSync(workspacePath) : { servers: {} };
  return {
    merged: mergeMcpConfigFiles(user, workspace),
    serverScopes: mcpServerScopesFromFiles(user, workspace),
  };
}

async function loadMcpConfigFile(path: string): Promise<McpConfigFile> {
  try {
    const content = await readFile(path, "utf8");
    return parseMcpConfigFile(JSON.parse(content) as unknown);
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return { servers: {} };
    }

    if (error instanceof SyntaxError) {
      throw new McpConfigError(`Failed to parse MCP config: ${path}`, { cause: error });
    }

    throw new McpConfigError(`Failed to read MCP config: ${path}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function loadMcpConfigFileSync(path: string): McpConfigFile {
  try {
    const content = readFileSync(path, "utf8");
    return parseMcpConfigFile(JSON.parse(content) as unknown);
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return { servers: {} };
    }

    if (error instanceof SyntaxError) {
      throw new McpConfigError(`Failed to parse MCP config: ${path}`, { cause: error });
    }

    throw new McpConfigError(`Failed to read MCP config: ${path}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function resolveRuntimeServerConfig(
  name: string,
  server: McpServerConfig,
  workspaceRoot: string,
  lookup: EnvLookupStore,
): Promise<ResolvedMcpServerConfig> {
  const normalized = normalizeMcpServerConfig(name, server);

  return {
    ...normalized,
    transport: await resolveRuntimeTransportConfig(normalized.transport, workspaceRoot, lookup),
  };
}

async function resolveRuntimeTransportConfig(
  transport: ResolvedMcpTransportConfig,
  workspaceRoot: string,
  lookup: EnvLookupStore,
): Promise<ResolvedMcpTransportConfig> {
  switch (transport.type) {
    case "stdio": {
      const inheritedEnv = inheritedProcessEnvironment(lookup);
      const resolvedOverrides = resolveEnvRecord(transport.env, (name) =>
        lookupEnvValue(lookup, name),
      );
      const env = {
        ...inheritedEnv,
        ...resolvedOverrides,
      };

      const requestedCwd =
        transport.cwd === undefined ? undefined : resolveStdioCwd(workspaceRoot, transport.cwd);
      const cwd = await firstExistingDirectory([requestedCwd, workspaceRoot]);
      const args = await resolveStdioArgsAgainstCwd(transport.args, requestedCwd ?? cwd);
      if (requestedCwd && requestedCwd !== cwd) {
        console.error("[mcp-service] stdio.cwd.missing", {
          requested: requestedCwd,
          used: cwd,
        });
      }

      return {
        ...transport,
        command: await resolveStdioCommand(transport.command, env),
        env,
        args,
        ...(cwd === undefined ? {} : { cwd }),
      };
    }
    case "http":
      return {
        ...transport,
        headers: resolveEnvRecord(transport.headers, (name) => lookupEnvValue(lookup, name)),
      };
  }
}

async function resolveStdioCommand(command: string, env: Record<string, string>): Promise<string> {
  const trimmed = command.trim();
  const hasDirectorySeparator = trimmed.includes("\\") || trimmed.includes("/");
  if (isAbsolute(trimmed) || hasDirectorySeparator) {
    const resolved = await resolveCommandCandidate(trimmed);
    if (!resolved) {
      throw new McpConfigError(`MCP executable not found: ${trimmed}`);
    }

    return resolved;
  }

  if (!isWindowsPlatform()) {
    return trimmed;
  }

  const pathEntries = splitWindowsPathEntries(env.PATH ?? process.env.PATH);
  const pathExtEntries = splitWindowsPathExtEntries(env.PATHEXT ?? process.env.PATHEXT);
  for (const candidate of buildWindowsCommandCandidates(trimmed, pathEntries, pathExtEntries)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return trimmed;
}

async function resolveCommandCandidate(path: string): Promise<string | undefined> {
  if (isWindowsPlatform() && !/\.[^\\/.]+$/u.test(path)) {
    const extensions = splitWindowsPathExtEntries(process.env.PATHEXT);
    for (const extension of extensions) {
      const candidate = `${path}${extension}`;
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return (await pathExists(path)) ? path : undefined;
}

function resolveStdioCwd(workspaceRoot: string, cwd: string): string {
  return isAbsolute(cwd) ? cwd : join(workspaceRoot, cwd);
}

async function firstExistingDirectory(
  candidates: Array<string | undefined>,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function resolveStdioArgsAgainstCwd(
  args: string[],
  cwd: string | undefined,
): Promise<string[]> {
  if (!cwd) {
    return args;
  }

  const resolved: string[] = [];
  for (const arg of args) {
    if (!arg || arg.startsWith("-") || isAbsolute(arg)) {
      resolved.push(arg);
      continue;
    }
    const candidate = join(cwd, arg);
    resolved.push((await pathExists(candidate)) ? candidate : arg);
  }
  return resolved;
}

function inheritedProcessEnvironment(lookup: EnvLookupStore): Record<string, string> {
  const env: Record<string, string> = {};
  const processKeys = new Set<string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") {
      continue;
    }

    env[key] = value;
    processKeys.add(normalizeEnvKey(key));
  }

  for (const [key, value] of lookup) {
    if (processKeys.has(key)) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

function buildManagedServerForRust(
  name: string,
  server: McpServerConfig,
  resolved: ResolvedMcpServerConfig | undefined,
  scope: McpConfigScope | undefined,
): JsonValue {
  const enabled = server.enabled ?? true;
  const normalizedName = resolved?.name ?? (name.trim() || name);

  return {
    name: normalizedName,
    displayName: server.displayName?.trim() || resolved?.displayName || normalizedName,
    enabled,
    capabilities: capabilityTogglesFromConfig(server.capabilities),
    transport: transportConfigForRust(server.transport),
    state: enabled ? "ready" : "disabled",
    ...(scope ? { scope } : {}),
  };
}

function capabilityTogglesFromConfig(
  capabilities: Partial<McpCapabilityToggles> | undefined,
): JsonValue {
  return {
    tools: capabilities?.tools ?? true,
    resources: capabilities?.resources ?? true,
    prompts: capabilities?.prompts ?? true,
  };
}

function transportConfigForRust(transport: McpServerConfig["transport"]): JsonValue {
  switch (transport.type) {
    case "stdio":
      return {
        type: "stdio",
        command: transport.command,
        ...(transport.args === undefined ? {} : { args: transport.args }),
        ...(transport.env === undefined ? {} : { env: transport.env }),
        ...(transport.cwd === undefined ? {} : { cwd: transport.cwd }),
        ...(transport.timeoutMs === undefined ? {} : { timeout_ms: transport.timeoutMs }),
      };
    case "http":
      return {
        type: "http",
        url: transport.url,
        ...(transport.headers === undefined ? {} : { headers: transport.headers }),
        ...(transport.timeoutMs === undefined ? {} : { timeout_ms: transport.timeoutMs }),
      };
  }
}

function assertToolCapability(
  server: ResolvedMcpServerConfig,
  capabilities: SdkMcpConnection["serverCapabilities"],
): void {
  if (!server.capabilities.tools) {
    throw new McpConfigError(`MCP server ${server.name} does not have tools capability enabled`);
  }
  if (capabilities?.tools === undefined) {
    throw new McpConfigError(`MCP server ${server.name} does not support tools capability`);
  }
}

function assertResourceCapability(
  server: ResolvedMcpServerConfig,
  capabilities: SdkMcpConnection["serverCapabilities"],
): void {
  if (!server.capabilities.resources) {
    throw new McpConfigError(
      `MCP server ${server.name} does not have resources capability enabled`,
    );
  }
  if (capabilities?.resources === undefined) {
    throw new McpConfigError(`MCP server ${server.name} does not support resources capability`);
  }
}

function assertPromptCapability(
  server: ResolvedMcpServerConfig,
  capabilities: SdkMcpConnection["serverCapabilities"],
): void {
  if (!server.capabilities.prompts) {
    throw new McpConfigError(`MCP server ${server.name} does not have prompts capability enabled`);
  }
  if (capabilities?.prompts === undefined) {
    throw new McpConfigError(`MCP server ${server.name} does not support prompts capability`);
  }
}

function parsePromptArguments(argsJson: string | undefined): Record<string, string> | undefined {
  if (!argsJson?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch (error) {
    throw new McpConfigError("MCP prompt arguments must be valid JSON", {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new McpConfigError("MCP prompt arguments must be a JSON object");
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = stringifyPromptArgumentValue(value);
  }

  return result;
}

function stringifyPromptArgumentValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function lookupEnvValue(lookup: EnvLookupStore, name: string): string | undefined {
  return lookup.get(normalizeEnvKey(name));
}

function normalizeEnvKey(name: string): string {
  return isWindowsPlatform() ? name.toUpperCase() : name;
}

async function queryWindowsRegistryEnvironment(path: string): Promise<Record<string, string>> {
  if (!isWindowsPlatform()) {
    return {};
  }

  const output = await execRegistryQuery(path);
  return parseWindowsRegistryEnvironment(output);
}

function execRegistryQuery(path: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", path],
      {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }

        resolve(String(stdout));
      },
    );
  });
}

function parseWindowsRegistryEnvironment(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("HKEY_")) {
      continue;
    }

    const parts = trimmed.split(/\s{2,}/u);
    if (parts.length < 3) {
      continue;
    }

    const [name, type, ...valueParts] = parts;
    if (name === undefined || type === undefined || !type.startsWith("REG_")) {
      continue;
    }

    values[name] = valueParts.join("  ").trim();
  }

  return values;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function closeConnectionQuietly(
  connection: SdkMcpConnection,
  context: string,
): Promise<void> {
  try {
    await connection.close();
  } catch (error) {
    console.error("[mcp-service] connection.close failed", {
      context,
      error: describeError(error),
    });
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}

function parseOptionalJsonValue(argsJson: string | undefined): JsonValue {
  if (!argsJson?.trim()) {
    return null;
  }

  try {
    return JSON.parse(argsJson) as JsonValue;
  } catch (error) {
    throw new McpConfigError("MCP tool arguments must be valid JSON", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpToolRequest(value: JsonValue): value is McpToolRequest {
  return (
    isJsonRecord(value) &&
    value.kind === "mcpTool" &&
    typeof value.name === "string" &&
    typeof value.server === "string" &&
    typeof value.displayName === "string" &&
    typeof value.toolName === "string" &&
    "arguments" in value
  );
}

function findToolIndexEntry(
  entries: McpToolIndexEntry[],
  serverName: string,
  toolName: string,
): McpToolIndexEntry | undefined {
  return entries.find((entry) => entry.server === serverName && entry.toolName === toolName);
}
