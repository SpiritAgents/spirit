import assert from "node:assert/strict";
import { test } from "vitest";

import { McpRegistry } from "./registry.js";
import type { McpToolIndexEntry, ResolvedMcpServerConfig } from "./types.js";

test("McpService catalog snapshot truncates tool metadata at 128 entries", async () => {
  const { buildMcpToolCatalogSnapshotForTest } = await import("./service.lazy.test-helpers.js");
  const indexEntries: McpToolIndexEntry[] = [];
  for (let index = 0; index < 130; index += 1) {
    indexEntries.push({
      server: "demo",
      displayName: "Demo",
      toolName: `tool_${index}`,
      description: `Tool ${index}`,
      inputSchema: { type: "object" },
    });
  }

  const registry = new McpRegistry();
  registry.replaceConfig({
    servers: {
      demo: {
        enabled: true,
        transport: { type: "stdio", command: "echo" },
      },
    },
  });
  registry.setServerState("demo", "ready", { cachedTools: 130 });

  const resolved: Record<string, ResolvedMcpServerConfig> = {
    demo: {
      name: "demo",
      displayName: "Demo",
      enabled: true,
      lazyTools: true,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "stdio", command: "echo", args: [], env: {}, stderr: "pipe" },
    },
  };

  const snapshot = buildMcpToolCatalogSnapshotForTest(indexEntries, registry, resolved);
  assert.equal(snapshot.totalToolCount, 130);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.servers[0]?.tools.length, 128);
});

test("McpService toolDefinitionsJson returns gateway tools only when index is non-empty", async () => {
  const { McpService } = await import("./service.js");
  const service = new McpService(process.cwd());
  assert.deepEqual(service.toolDefinitionsJson(), []);

  (service as unknown as { toolIndexStore: McpToolIndexEntry[] }).toolIndexStore = [
    {
      server: "demo",
      displayName: "Demo",
      toolName: "ping",
      description: "Ping",
      inputSchema: { type: "object" },
    },
  ];

  const withTools = service.toolDefinitionsJson();
  assert.equal(withTools.length, 2);
  assert.ok(
    withTools.some(
      (entry) => (entry as { function?: { name?: string } }).function?.name === "tool_describe",
    ),
  );
});

test("McpService lookupToolApprovalAnnotations reads cached index hints", async () => {
  const { McpService } = await import("./service.js");
  const service = new McpService(process.cwd());
  assert.equal(service.lookupToolApprovalAnnotations("demo", "ping"), undefined);

  (service as unknown as { toolIndexStore: McpToolIndexEntry[] }).toolIndexStore = [
    {
      server: "demo",
      displayName: "Demo",
      toolName: "ping",
      description: "Ping",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      server: "demo",
      displayName: "Demo",
      toolName: "search",
      description: "Search",
      inputSchema: { type: "object" },
    },
  ];

  assert.deepEqual(service.lookupToolApprovalAnnotations("demo", "ping"), {
    readOnlyHint: true,
    openWorldHint: false,
  });
  assert.equal(service.lookupToolApprovalAnnotations("demo", "search"), undefined);
  assert.equal(service.lookupToolApprovalAnnotations("demo", "missing"), undefined);
});

test("McpService toolDefinitionsJson returns fetch_mcp_resource when resource index is non-empty", async () => {
  const { McpService } = await import("./service.js");
  const { FETCH_MCP_RESOURCE_TOOL_NAME } = await import("../tool-gateway/fetch-mcp-resource.js");
  const service = new McpService(process.cwd());

  (
    service as unknown as {
      resourceIndexStore: Array<{ server: string; uri: string; name: string }>;
    }
  ).resourceIndexStore = [{ server: "docs", uri: "mcp://readme", name: "readme" }];

  const definitions = service.toolDefinitionsJson();
  assert.equal(definitions.length, 1);
  assert.equal(
    (definitions[0] as { function?: { name?: string } }).function?.name,
    FETCH_MCP_RESOURCE_TOOL_NAME,
  );
});

test("McpService exposes eager server tools directly without lazy gateway and routes calls", async () => {
  const { McpService } = await import("./service.js");
  const service = new McpService(process.cwd());
  const internal = service as unknown as {
    toolIndexStore: McpToolIndexEntry[];
    loadedConfigStore: { resolved: Record<string, ResolvedMcpServerConfig> };
  };
  internal.loadedConfigStore.resolved = {
    edge: {
      name: "edge",
      displayName: "Edge",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/mcp", headers: {} },
    },
  };
  internal.toolIndexStore = [
    {
      server: "edge",
      displayName: "Edge",
      toolName: "search",
      description: "Search documentation.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
    {
      server: "edge",
      displayName: "Edge",
      toolName: "execute",
      description: "Execute script.",
      inputSchema: { type: "object", properties: { code: { type: "string" } } },
    },
  ];

  const definitions = service.toolDefinitionsJson() as Array<{
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }>;
  assert.deepEqual(
    definitions.map((entry) => entry.function.name),
    ["mcp__edge__search", "mcp__edge__execute"],
  );
  assert.equal(definitions[0]?.function.description, "Search documentation.");
  assert.deepEqual(definitions[0]?.function.parameters, {
    type: "object",
    properties: { query: { type: "string" } },
  });

  const routed = await service.requestFromFunctionCall(
    "mcp__edge__search",
    JSON.stringify({ query: "zones" }),
  );
  assert.deepEqual(routed, {
    kind: "mcpTool",
    name: "edge/search",
    server: "edge",
    displayName: "Edge",
    toolName: "search",
    arguments: { query: "zones" },
  });
});

test("McpService combines lazy gateway with eager direct definitions when both exist", async () => {
  const { McpService } = await import("./service.js");
  const service = new McpService(process.cwd());
  const internal = service as unknown as {
    toolIndexStore: McpToolIndexEntry[];
    loadedConfigStore: { resolved: Record<string, ResolvedMcpServerConfig> };
  };
  internal.loadedConfigStore.resolved = {
    eager: {
      name: "eager",
      displayName: "Eager",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/eager", headers: {} },
    },
    lazy: {
      name: "lazy",
      displayName: "Lazy",
      enabled: true,
      lazyTools: true,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/lazy", headers: {} },
    },
  };
  internal.toolIndexStore = [
    {
      server: "eager",
      displayName: "Eager",
      toolName: "ping",
      description: "Ping",
      inputSchema: { type: "object" },
    },
    {
      server: "lazy",
      displayName: "Lazy",
      toolName: "list",
      description: "List",
      inputSchema: { type: "object" },
    },
  ];

  const names = (service.toolDefinitionsJson() as Array<{ function?: { name?: string } }>).map(
    (entry) => entry.function?.name,
  );
  assert.deepEqual(names, ["tool_describe", "tool_call", "mcp__eager__ping"]);
});

test("buildEagerMcpToolEntries bounds names to 64 chars and resolves sanitization collisions", async () => {
  const { buildEagerMcpToolEntries } = await import("./service.js");
  const resolved: Record<string, ResolvedMcpServerConfig> = {
    "my.server": {
      name: "my.server",
      displayName: "My Dot Server",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/a", headers: {} },
    },
    my_server: {
      name: "my_server",
      displayName: "My Underscore Server",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/b", headers: {} },
    },
    long_server_identifier_for_truncation_check: {
      name: "long_server_identifier_for_truncation_check",
      displayName: "Long",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/c", headers: {} },
    },
  };

  const mapped = buildEagerMcpToolEntries(
    [
      {
        server: "my.server",
        displayName: "My Dot Server",
        toolName: "run",
        description: "Run A",
        inputSchema: { type: "object" },
      },
      {
        server: "my_server",
        displayName: "My Underscore Server",
        toolName: "run",
        description: "Run B",
        inputSchema: { type: "object" },
      },
      {
        server: "long_server_identifier_for_truncation_check",
        displayName: "Long",
        toolName: "extremely_verbose_operation_name_that_exceeds_sixty_four_chars",
        description: "Long tool",
        inputSchema: { type: "object" },
      },
    ],
    resolved,
  );

  assert.equal(mapped.length, 3);
  const uniqueNames = new Set(mapped.map((item) => item.name));
  assert.equal(uniqueNames.size, 3);
  for (const item of mapped) {
    assert.ok(item.name.length <= 64, `${item.name} exceeds 64 chars`);
    assert.match(item.name, /^[a-zA-Z0-9_-]+$/u);
  }
});

test("McpService refreshConfig prunes stale eager server tools instead of falling back to lazy", async () => {
  const { McpService } = await import("./service.js");
  let includeEdge = true;
  const service = new McpService(process.cwd(), false, {
    configSource: {
      scopeKey: "prune-stale-test",
      read: () => ({
        user: {
          servers: includeEdge
            ? {
                edge: {
                  displayName: "Edge",
                  lazyTools: false,
                  transport: { type: "http", url: "https://example.invalid/edge" },
                },
              }
            : {},
        },
        workspace: { servers: {} },
      }),
    },
  });
  await service.refreshConfig();
  (service as unknown as { toolIndexStore: McpToolIndexEntry[] }).toolIndexStore = [
    {
      server: "edge",
      displayName: "Edge",
      toolName: "search",
      description: "Search",
      inputSchema: { type: "object" },
    },
  ];
  assert.equal(service.toolDefinitionsJson().length, 1);

  includeEdge = false;
  await service.refreshConfig();
  assert.deepEqual(service.toolDefinitionsJson(), []);
  assert.equal(service.catalogSnapshot().totalToolCount, 0);
});
