import {
  Client,
  LATEST_PROTOCOL_VERSION,
  StreamableHTTPClientTransport,
  type ClientCapabilities,
  type Implementation,
  type ServerCapabilities,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";

import { DEFAULT_MCP_CLIENT_INFO } from "./config.js";
import { McpConnectionError } from "./errors.js";
import {
  parseSpiritUiOpenParams,
  resolveSpiritUiOpen,
  SPIRIT_UI_EXPERIMENTAL_KEY,
  SPIRIT_UI_OPEN_METHOD,
  type ExtensionMcpServerOwnership,
  type McpUiOpener,
} from "./spirit-ui.js";
import type {
  McpClientInfo,
  ResolvedMcpHttpTransportConfig,
  ResolvedMcpServerConfig,
  ResolvedMcpStdioTransportConfig,
  ResolvedMcpTransportConfig,
} from "./types.js";

export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_APPS_RESOURCE_MIME_TYPE = RESOURCE_MIME_TYPE;

export type McpListToolsResult = Awaited<ReturnType<Client["listTools"]>>;
export type McpListResourcesResult = Awaited<ReturnType<Client["listResources"]>>;
export type McpListResourceTemplatesResult = Awaited<ReturnType<Client["listResourceTemplates"]>>;
export type McpListPromptsResult = Awaited<ReturnType<Client["listPrompts"]>>;
export type McpReadResourceResult = Awaited<ReturnType<Client["readResource"]>>;
export type McpGetPromptResult = Awaited<ReturnType<Client["getPrompt"]>>;
export type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type McpSdkTransport = StdioClientTransport | StreamableHTTPClientTransport;
type McpConnectTransport = Parameters<Client["connect"]>[0];

export interface CreateMcpSdkClientOptions {
  onSpiritUiOpen?: (params: unknown) => Promise<Record<string, unknown>>;
  onToolsListChanged?: () => void;
  onResourcesListChanged?: () => void;
  mcpAppsUi?: boolean;
}

export function createMcpSdkClient(
  clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO,
  options?: CreateMcpSdkClientOptions,
): Client {
  const capabilities: ClientCapabilities = {
    experimental: {
      [SPIRIT_UI_EXPERIMENTAL_KEY]: {},
    },
    ...(options?.mcpAppsUi
      ? {
          extensions: {
            [MCP_APPS_EXTENSION_ID]: {
              mimeTypes: [MCP_APPS_RESOURCE_MIME_TYPE],
            },
          },
        }
      : {}),
  };
  const client = new Client(
    {
      name: clientInfo.name,
      version: clientInfo.version,
    },
    {
      capabilities,
    },
  );
  // Protocol option, not Client constructor — set after construct so spirit/ui/open
  // does not need a zod request schema from this isolated package.
  client.fallbackRequestHandler = async (request) => {
    if (request.method !== SPIRIT_UI_OPEN_METHOD) {
      throw new Error(`Unsupported MCP request: ${request.method}`);
    }
    if (!options?.onSpiritUiOpen) {
      return { kind: "unavailable", reason: "host-has-no-ui" };
    }
    return options.onSpiritUiOpen(request.params);
  };
  client.fallbackNotificationHandler = async (notification) => {
    if (notification.method === "notifications/tools/list_changed") {
      options?.onToolsListChanged?.();
    } else if (notification.method === "notifications/resources/list_changed") {
      options?.onResourcesListChanged?.();
    }
  };
  return client;
}

export interface SdkMcpConnectionSpiritUi {
  ownership?: ExtensionMcpServerOwnership;
  opener?: McpUiOpener;
}

export interface SdkMcpConnectionOptions extends SdkMcpConnectionSpiritUi {
  mcpAppsUi?: boolean;
  onUnexpectedClose?: () => void;
  onToolsListChanged?: () => void;
  onResourcesListChanged?: () => void;
}

export class SdkMcpConnection {
  private readonly clientStore: Client;
  private transportStore: McpSdkTransport | undefined;
  private serverNameStore: string | undefined;
  private timeoutMsStore: number | undefined;
  private protocolVersionStore = LATEST_PROTOCOL_VERSION;
  private spiritUiStore: SdkMcpConnectionSpiritUi;
  private connectionGeneration = 0;
  private broken = false;
  private readonly onUnexpectedCloseCallback: (() => void) | undefined;

  constructor(
    clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO,
    options: SdkMcpConnectionOptions = {},
  ) {
    this.spiritUiStore = {
      ...(options.ownership ? { ownership: options.ownership } : {}),
      ...(options.opener ? { opener: options.opener } : {}),
    };
    this.onUnexpectedCloseCallback = options.onUnexpectedClose;
    this.clientStore = createMcpSdkClient(clientInfo, {
      mcpAppsUi: options.mcpAppsUi === true,
      ...(options.onToolsListChanged ? { onToolsListChanged: options.onToolsListChanged } : {}),
      ...(options.onResourcesListChanged
        ? { onResourcesListChanged: options.onResourcesListChanged }
        : {}),
      onSpiritUiOpen: async (params) => {
        const parsed = parseSpiritUiOpenParams(params);
        return resolveSpiritUiOpen({
          ownership: this.spiritUiStore.ownership,
          opener: this.spiritUiStore.opener,
          viewId: parsed.viewId,
          ...(parsed.params === undefined ? {} : { params: parsed.params }),
        });
      },
    });
  }

  get client(): Client {
    return this.clientStore;
  }

  get connectedServer(): string | undefined {
    return this.serverNameStore;
  }

  get isConnected(): boolean {
    return this.transportStore !== undefined && !this.broken;
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this.clientStore.getServerCapabilities();
  }

  get serverVersion(): Implementation | undefined {
    return this.clientStore.getServerVersion();
  }

  get instructions(): string | undefined {
    return this.clientStore.getInstructions();
  }

  get protocolVersion(): string {
    return this.protocolVersionStore;
  }

  setSpiritUi(spiritUi: SdkMcpConnectionSpiritUi): void {
    this.spiritUiStore = {
      ...(spiritUi.ownership ? { ownership: spiritUi.ownership } : {}),
      ...(spiritUi.opener ? { opener: spiritUi.opener } : {}),
    };
  }

  async connect(server: ResolvedMcpServerConfig): Promise<void> {
    await this.close();
    this.broken = false;
    const generation = ++this.connectionGeneration;
    const transport = createTransport(server.transport);
    this.timeoutMsStore = server.transport.timeoutMs;
    let handshakeCompleted = false;
    let closedDuringConnect = false;
    this.clientStore.onclose = () => {
      if (this.connectionGeneration !== generation) {
        return;
      }
      if (!handshakeCompleted) {
        closedDuringConnect = true;
        return;
      }
      if (this.transportStore !== transport) {
        return;
      }
      this.broken = true;
      this.transportStore = undefined;
      this.onUnexpectedCloseCallback?.();
    };

    try {
      await this.clientStore.connect(
        transport as unknown as McpConnectTransport,
        this.requestOptions(),
      );
    } catch (error) {
      this.connectionGeneration += 1;
      await safeCloseTransport(transport);
      this.broken = true;
      throw new McpConnectionError(`MCP server connection failed: ${server.name}`, {
        cause: error,
      });
    }

    if (this.connectionGeneration !== generation || closedDuringConnect) {
      this.connectionGeneration += 1;
      await safeCloseTransport(transport);
      this.broken = true;
      throw new McpConnectionError(`MCP server connection closed during handshake: ${server.name}`);
    }

    handshakeCompleted = true;
    this.transportStore = transport;
    this.serverNameStore = server.name;
    this.protocolVersionStore =
      this.clientStore.getNegotiatedProtocolVersion() ?? resolveProtocolVersion(transport);
  }

  async close(): Promise<void> {
    const transport = this.transportStore;
    // Advance generation before closing so any late SDK/stdio onclose callback
    // from this transport is ignored even after close() resolves or connect() starts.
    this.connectionGeneration += 1;
    this.transportStore = undefined;
    this.serverNameStore = undefined;
    this.timeoutMsStore = undefined;
    this.protocolVersionStore = LATEST_PROTOCOL_VERSION;
    this.broken = false;

    if (transport) {
      // Detach transport callbacks before closing so a late child-process exit from
      // this transport cannot invoke Client._onclose() after a subsequent reconnect.
      delete transport.onclose;
      delete transport.onerror;
      await transport.close();
    }
  }

  async listTools(): Promise<McpListToolsResult> {
    return this.clientStore.listTools(undefined, this.requestOptions());
  }

  async listResources(): Promise<McpListResourcesResult> {
    return this.clientStore.listResources(undefined, this.requestOptions());
  }

  async listResourceTemplates(): Promise<McpListResourceTemplatesResult> {
    return this.clientStore.listResourceTemplates(undefined, this.requestOptions());
  }

  async listPrompts(): Promise<McpListPromptsResult> {
    return this.clientStore.listPrompts(undefined, this.requestOptions());
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    return this.clientStore.readResource({ uri }, this.requestOptions());
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult> {
    return this.clientStore.getPrompt(
      {
        name,
        ...(args === undefined ? {} : { arguments: args }),
      },
      this.requestOptions(),
    );
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<McpCallToolResult> {
    return this.clientStore.callTool(
      {
        name,
        ...(args === undefined ? {} : { arguments: args }),
      },
      this.requestOptions(options?.timeoutMs),
    );
  }

  private requestOptions(timeoutMs = this.timeoutMsStore): { timeout: number } | undefined {
    return timeoutMs === undefined ? undefined : { timeout: timeoutMs };
  }
}

export function createTransport(config: ResolvedMcpTransportConfig): McpSdkTransport {
  switch (config.type) {
    case "stdio":
      return new StdioClientTransport(buildStdioServerParameters(config));
    case "http":
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        Object.keys(config.headers).length > 0
          ? {
              requestInit: {
                headers: config.headers,
              },
            }
          : {},
      );
  }
}

function buildStdioServerParameters(
  config: ResolvedMcpStdioTransportConfig,
): StdioServerParameters {
  return {
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: config.stderr,
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
  };
}

async function safeCloseTransport(transport: McpSdkTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    return;
  }
}

export function isHttpTransport(
  config: ResolvedMcpTransportConfig,
): config is ResolvedMcpHttpTransportConfig {
  return config.type === "http";
}

function resolveProtocolVersion(transport: McpSdkTransport): string {
  if (transport instanceof StreamableHTTPClientTransport) {
    return transport.protocolVersion ?? LATEST_PROTOCOL_VERSION;
  }

  return LATEST_PROTOCOL_VERSION;
}
