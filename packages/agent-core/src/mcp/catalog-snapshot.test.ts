import assert from "node:assert/strict";
import { test } from "vitest";

import {
  aggregateListedResourcesForServer,
  buildMcpToolCatalogSnapshot,
  MCP_CATALOG_RESOURCE_LIMIT,
} from "./catalog-snapshot.js";
import { McpRegistry } from "./registry.js";
import type { ResolvedMcpServerConfig } from "./types.js";

test("aggregateListedResourcesForServer merges mimeTypes by uri", () => {
  const entries = aggregateListedResourcesForServer("demo", [
    { uri: "mcp://doc", name: "doc", mimeType: "text/plain" },
    { uri: "mcp://doc", name: "doc", mimeType: "application/json" },
  ]);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0]?.mimeTypes, ["application/json", "text/plain"]);
});

test("buildMcpToolCatalogSnapshot truncates resources independently", () => {
  const registry = new McpRegistry();
  registry.replaceConfig({
    servers: {
      demo: {
        enabled: true,
        transport: { type: "stdio", command: "demo" },
      },
    },
  });
  registry.setServerState("demo", "ready", { cachedTools: 0 });

  const resolved: Record<string, ResolvedMcpServerConfig> = {
    demo: {
      name: "demo",
      displayName: "Demo",
      enabled: true,
      lazyTools: true,
      capabilities: { tools: true, resources: true, prompts: true },
      transport: { type: "stdio", command: "demo", args: [], env: {}, stderr: "pipe" },
    },
  };

  const resourceEntries = Array.from({ length: MCP_CATALOG_RESOURCE_LIMIT + 2 }, (_, index) => ({
    server: "demo",
    uri: `mcp://demo/r${index}`,
    name: `r${index}`,
  }));

  const snapshot = buildMcpToolCatalogSnapshot([], resourceEntries, registry, resolved);
  assert.equal(snapshot.resourcesTruncated, true);
  assert.equal(snapshot.totalResourceCount, MCP_CATALOG_RESOURCE_LIMIT + 2);
  assert.equal(snapshot.servers[0]?.resources.length, MCP_CATALOG_RESOURCE_LIMIT);
});

test("buildMcpToolCatalogSnapshot includes servers with resources only", () => {
  const registry = new McpRegistry();
  registry.replaceConfig({
    servers: {
      docs: {
        enabled: true,
        transport: { type: "stdio", command: "docs" },
      },
    },
  });
  registry.setServerState("docs", "ready", { cachedTools: 0 });

  const resolved: Record<string, ResolvedMcpServerConfig> = {
    docs: {
      name: "docs",
      displayName: "Docs",
      enabled: true,
      lazyTools: true,
      capabilities: { tools: false, resources: true, prompts: false },
      transport: { type: "stdio", command: "docs", args: [], env: {}, stderr: "pipe" },
    },
  };

  const snapshot = buildMcpToolCatalogSnapshot(
    [],
    [{ server: "docs", uri: "mcp://readme", name: "readme", mimeTypes: ["text/markdown"] }],
    registry,
    resolved,
  );

  assert.equal(snapshot.servers.length, 1);
  assert.deepEqual(snapshot.servers[0]?.resources[0], {
    uri: "mcp://readme",
    name: "readme",
    mimeTypes: ["text/markdown"],
  });
});

test("buildMcpToolCatalogSnapshot excludes eager server tools while keeping resources and errors", () => {
  const registry = new McpRegistry();
  registry.replaceConfig({
    servers: {
      eagerOnly: {
        enabled: true,
        lazyTools: false,
        transport: { type: "http", url: "https://example.invalid/eager" },
      },
      eagerWithResource: {
        enabled: true,
        lazyTools: false,
        transport: { type: "http", url: "https://example.invalid/resource" },
      },
      eagerErrored: {
        enabled: true,
        lazyTools: false,
        transport: { type: "http", url: "https://example.invalid/error" },
      },
      lazyServer: {
        enabled: true,
        lazyTools: true,
        transport: { type: "http", url: "https://example.invalid/lazy" },
      },
    },
  });
  registry.setServerState("eagerOnly", "ready", { cachedTools: 1 });
  registry.setServerState("eagerWithResource", "ready", { cachedTools: 1 });
  registry.setServerState("eagerErrored", "error", { cachedTools: 0, lastError: "unauthorized" });
  registry.setServerState("lazyServer", "ready", { cachedTools: 1 });

  const resolved: Record<string, ResolvedMcpServerConfig> = {
    eagerOnly: {
      name: "eagerOnly",
      displayName: "Eager Only",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/eager", headers: {} },
    },
    eagerWithResource: {
      name: "eagerWithResource",
      displayName: "Eager Resource",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: true, prompts: false },
      transport: { type: "http", url: "https://example.invalid/resource", headers: {} },
    },
    eagerErrored: {
      name: "eagerErrored",
      displayName: "Eager Errored",
      enabled: true,
      lazyTools: false,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/error", headers: {} },
    },
    lazyServer: {
      name: "lazyServer",
      displayName: "Lazy Server",
      enabled: true,
      lazyTools: true,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: "http", url: "https://example.invalid/lazy", headers: {} },
    },
  };

  const snapshot = buildMcpToolCatalogSnapshot(
    [
      {
        server: "eagerOnly",
        displayName: "Eager Only",
        toolName: "search",
        description: "Search",
        inputSchema: { type: "object" },
      },
      {
        server: "eagerWithResource",
        displayName: "Eager Resource",
        toolName: "execute",
        description: "Execute",
        inputSchema: { type: "object" },
      },
      {
        server: "lazyServer",
        displayName: "Lazy Server",
        toolName: "list",
        description: "List",
        inputSchema: { type: "object" },
      },
    ],
    [{ server: "eagerWithResource", uri: "mcp://doc", name: "doc" }],
    registry,
    resolved,
  );

  assert.equal(snapshot.totalToolCount, 1);
  assert.equal(snapshot.truncated, false);
  assert.deepEqual(
    snapshot.servers.map((server) => server.name),
    ["eagerErrored", "eagerWithResource", "lazyServer"],
  );
  assert.deepEqual(
    snapshot.servers.find((server) => server.name === "eagerWithResource")?.tools,
    [],
  );
  assert.equal(
    snapshot.servers.find((server) => server.name === "eagerWithResource")?.resources.length,
    1,
  );
  assert.equal(
    snapshot.servers.find((server) => server.name === "eagerErrored")?.lastError,
    "unauthorized",
  );
});

test("buildMcpToolCatalogSnapshot ignores stale entries for removed or disabled servers", () => {
  const registry = new McpRegistry();
  const snapshot = buildMcpToolCatalogSnapshot(
    [
      {
        server: "removed",
        displayName: "Removed",
        toolName: "search",
        description: "Search",
        inputSchema: { type: "object" },
      },
    ],
    [{ server: "removed", uri: "mcp://doc", name: "doc" }],
    registry,
    {},
  );
  assert.equal(snapshot.totalToolCount, 0);
  assert.equal(snapshot.totalResourceCount, 0);
  assert.deepEqual(snapshot.servers, []);
});
