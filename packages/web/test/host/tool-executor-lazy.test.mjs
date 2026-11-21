import assert from "node:assert/strict";
import { test } from "vitest";

import { McpService } from "@spiritagent/agent-core";

import { DesktopToolExecutor } from "../../../../packages/sessions/dist/host/tool-executor.js";

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === "object" && typeof tool.name === "string" ? [tool.name] : [];
      })
    : [];
}

test("DesktopToolExecutor exposes lazy gateway for built-in create_automation without MCP servers", () => {
  const toolExecutor = new DesktopToolExecutor(process.cwd(), {
    hostContributedToolsEnabled: true,
    getAutomationCreateDefaults: () => ({
      workspaceRoot: process.cwd(),
      modelRef: { providerId: "openai", name: "demo-model" },
    }),
  });

  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());
  assert.ok(!toolNames.includes("create_automation"));
  assert.ok(toolNames.includes("tool_describe"));
  assert.ok(toolNames.includes("tool_call"));

  const catalog = toolExecutor.mcpToolCatalogSnapshot();
  assert.equal(catalog.builtInToolCount, 1);
  assert.equal(catalog.builtInServers?.[0]?.tools[0]?.name, "create_automation");
});

test("DesktopToolExecutor exposes lazy gateway when MCP only provides fetch_mcp_resource", () => {
  const mcp = new McpService(process.cwd());
  mcp.resourceIndexStore = [{ server: "docs", uri: "mcp://readme", name: "readme" }];

  const toolExecutor = new DesktopToolExecutor(process.cwd(), {
    mcp,
    hostContributedToolsEnabled: true,
    getAutomationCreateDefaults: () => ({
      workspaceRoot: process.cwd(),
      modelRef: { providerId: "openai", name: "demo-model" },
    }),
  });

  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());
  assert.ok(toolNames.includes("fetch_mcp_resource"));
  assert.ok(toolNames.includes("tool_describe"));
  assert.ok(toolNames.includes("tool_call"));
  assert.ok(!toolNames.includes("create_automation"));
});

test("DesktopToolExecutor hides built-in create_automation in plan mode", () => {
  const toolExecutor = new DesktopToolExecutor(process.cwd(), {
    hostContributedToolsEnabled: true,
    getAutomationCreateDefaults: () => ({
      workspaceRoot: process.cwd(),
      modelRef: { providerId: "openai", name: "demo-model" },
    }),
  });
  toolExecutor.setAgentModeToolExposure("plan");

  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());
  assert.ok(!toolNames.includes("create_automation"));
  assert.ok(!toolNames.includes("tool_describe"));
  assert.ok(!toolNames.includes("tool_call"));
  assert.equal(toolExecutor.mcpToolCatalogSnapshot().builtInToolCount ?? 0, 0);
});

test("DesktopToolExecutor exposes eager MCP tools directly and enforces approval parity", async () => {
  const mcp = new McpService(process.cwd(), false, {
    configSource: {
      scopeKey: "eager-test",
      read: () => ({
        user: {
          servers: {
            edge: {
              displayName: "Edge",
              lazyTools: false,
              transport: { type: "http", url: "https://example.invalid/mcp" },
            },
          },
        },
        workspace: { servers: {} },
      }),
    },
  });
  await mcp.refreshConfig();
  mcp.toolIndexStore = [
    {
      server: "edge",
      displayName: "Edge",
      toolName: "search",
      description: "Search docs",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      server: "edge",
      displayName: "Edge",
      toolName: "execute",
      description: "Execute code",
      inputSchema: { type: "object", properties: { code: { type: "string" } } },
    },
  ];

  const toolExecutor = new DesktopToolExecutor(process.cwd(), { mcp });
  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());
  assert.ok(toolNames.includes("mcp__edge__search"));
  assert.ok(toolNames.includes("mcp__edge__execute"));
  assert.ok(!toolNames.includes("tool_describe"));
  assert.ok(!toolNames.includes("tool_call"));

  const readOnlyRequest = await toolExecutor.requestFromFunctionCall(
    "mcp__edge__search",
    JSON.stringify({ query: "dns" }),
  );
  assert.equal((await toolExecutor.authorize(readOnlyRequest)).kind, "allowed");

  const execRequest = await toolExecutor.requestFromFunctionCall(
    "mcp__edge__execute",
    JSON.stringify({ code: "1 + 1" }),
  );
  const decision = await toolExecutor.authorize(execRequest);
  assert.equal(decision.kind, "need-approval");
  if (decision.kind === "need-approval") {
    assert.deepEqual(decision.approval, {
      kind: "lazy_tool_call",
      provider: "mcp",
      server: "edge",
      tool: "execute",
      arguments: { code: "1 + 1" },
    });
  }
});
