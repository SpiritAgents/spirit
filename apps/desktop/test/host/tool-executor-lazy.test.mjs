import assert from "node:assert/strict";
import { test } from "vitest";

import { McpService } from "@spiritagent/agent-core";

import { DesktopToolExecutor } from "../../dist-electron/src/host/tool-executor.js";

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
