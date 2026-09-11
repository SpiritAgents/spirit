import { Client } from "@modelcontextprotocol/sdk/client";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Implementation, ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

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

export type McpListToolsResult = Awaited<ReturnType<Client["listTools"]>>;
export type McpListResourcesResult = Awaited<ReturnType<Client["listResources"]>>;
export type McpListResourceTemplatesResult = Awaited<ReturnType<Client["listResourceTemplates"]>>;
export type McpListPromptsResult = Awaited<ReturnType<Client["listPrompts"]>>;
export type McpReadResourceResult = Awaited<ReturnType<Client["readResource"]>>;
export type McpGetPromptResult = Awaited<ReturnType<Client["getPrompt"]>>;
export type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type McpSdkTransport = StdioClientTransport | StreamableHTTPClientTransport;
type McpConnectTransport = Parameters<Client["connect"]>[0];

export function createMcpSdkClient(
  clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO,
  options?: {
    onSpiritUiOpen?: (params: unknown) => Promise<Record<string, unknown>>;
  },
): Client {
  const client = new Client(
    {
      name: clientInfo.name,
      version: clientInfo.version,
    },
    {
      capabilities: {
        experimental: {
          [SPIRIT_UI_EXPERIMENTAL_KEY]: {},
        },
      },
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
  return client;
}

export class SdkMcpConnection {
  private readonly clientStore: Client;
  private transportStore: McpSdkTransport | undefined;
  private serverNameStore: string | undefined;
  private timeoutMsStore: number | undefined;
  private protocolVersionStore = LATEST_PROTOCOL_VERSION;

  constructor(
    clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO,
    private readonly spiritUi: {
      ownership?: ExtensionMcpServerOwnership;
      opener?: McpUiOpener;
    } = {},
  ) {
    this.clientStore = createMcpSdkClient(clientInfo, {
      onSpiritUiOpen: async (params) => {
        const parsed = parseSpiritUiOpenParams(params);
        return resolveSpiritUiOpen({
          ownership: this.spiritUi.ownership,
          opener: this.spiritUi.opener,
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

  async connect(server: ResolvedMcpServerConfig): Promise<void> {
    await this.close();
    const transport = createTransport(server.transport);
    this.timeoutMsStore = server.transport.timeoutMs;

    try {
      await this.clientStore.connect(
        transport as unknown as McpConnectTransport,
        this.requestOptions(),
      );
    } catch (error) {
      await safeCloseTransport(transport);
      throw new McpConnectionError(`MCP server connection failed: ${server.name}`, {
        cause: error,
      });
    }

    this.transportStore = transport;
    this.serverNameStore = server.name;
    this.protocolVersionStore = resolveProtocolVersion(transport);
  }

  async close(): Promise<void> {
    const transport = this.transportStore;
    this.transportStore = undefined;
    this.serverNameStore = undefined;
    this.timeoutMsStore = undefined;
    this.protocolVersionStore = LATEST_PROTOCOL_VERSION;

    if (transport) {
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
      undefined,
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
