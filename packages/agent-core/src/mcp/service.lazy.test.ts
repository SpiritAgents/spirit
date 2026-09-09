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
