import assert from "node:assert/strict";
import { test } from "vitest";

import type { LlmTransportConfig } from "../provider-config.js";
import { McpService } from "../mcp/service.js";
import type { McpToolIndexEntry, ResolvedMcpServerConfig } from "../mcp/types.js";
import { toolNamesFromDefinitions } from "../unknown-tool-error.js";
import { JsonRpcPeer } from "./framing.js";
import { HostToolExecutorProxy, type LocalHostToolService } from "./host-tool-executor.js";

const TOOL_DEFINITION_ENVIRONMENT = {
  shellDisplayName: "shell",
  commandParameterDescription: "Command to run.",
};

function createExecutor(): HostToolExecutorProxy {
  const peer = {
    call: async () => ({}),
    notify: () => {},
  } as unknown as JsonRpcPeer;
  const executor = new HostToolExecutorProxy(peer);
  executor.setLocalHostService({
    toolDefinitionEnvironment: () => TOOL_DEFINITION_ENVIRONMENT,
  } as unknown as LocalHostToolService);
  return executor;
}

async function toolNamesFor(config?: LlmTransportConfig): Promise<string[]> {
  const executor = createExecutor();
  await executor.refreshCaches();
  if (config) {
    executor.setTransportConfigForToolDefinitions(config);
  }
  return toolNamesFromDefinitions(executor.toolDefinitionsJson());
}

const DECLARED_PROVIDER_TOOLS_CONFIG: LlmTransportConfig = {
  apiKey: "k",
  model: "step-3",
  providerTools: [
    {
      label: "Web Search",
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      execute: { path: "/search" },
    },
  ],
};

test("default exposure keeps web_fetch", async () => {
  const names = await toolNamesFor(DECLARED_PROVIDER_TOOLS_CONFIG);
  assert.ok(names.includes("web_fetch"));
});

test("webFetchEnabled=false hides web_fetch", async () => {
  const names = await toolNamesFor({ ...DECLARED_PROVIDER_TOOLS_CONFIG, webFetchEnabled: false });
  assert.ok(!names.includes("web_fetch"));
});

test("provider tool declarations merge at the transport, not into host tool definitions", async () => {
  const names = await toolNamesFor(DECLARED_PROVIDER_TOOLS_CONFIG);
  assert.ok(!names.includes("web_search"));
});

test("Plan edit guidance follows live transport changes", async () => {
  const executor = createExecutor();
  await executor.refreshCaches();
  executor.setAgentModeToolExposure("plan");
  assert.match(JSON.stringify(executor.toolDefinitionsJson()), /revise this plan with edit_file/);
  executor.setTransportConfigForToolDefinitions({
    transportKind: "open-responses",
    apiKey: "fixture",
    model: "fixture-model",
    options: { applyPatch: true },
  });
  assert.match(JSON.stringify(executor.toolDefinitionsJson()), /revise this plan with apply_patch/);
  assert.ok(!toolNamesFromDefinitions(executor.toolDefinitionsJson()).includes("edit_file"));
  executor.setTransportConfigForToolDefinitions({
    transportKind: "openai-compatible",
    apiKey: "fixture",
    model: "fixture-model",
    options: { applyPatch: true },
  });
  assert.match(JSON.stringify(executor.toolDefinitionsJson()), /revise this plan with apply_patch/);
  assert.ok(!toolNamesFromDefinitions(executor.toolDefinitionsJson()).includes("edit_file"));
  executor.setTransportConfigForToolDefinitions({ apiKey: "fixture", model: "fixture-model" });
  assert.match(JSON.stringify(executor.toolDefinitionsJson()), /revise this plan with edit_file/);
});

test("HostToolExecutorProxy refreshes eager MCP tools on catalog revision changes and enforces approval parity", async () => {
  const peer = {
    call: async () => ({}),
    notify: () => {},
  } as unknown as JsonRpcPeer;
  let lazyTools = false;
  const mcp = new McpService(process.cwd(), false, {
    configSource: {
      scopeKey: "host-proxy-eager-test",
      read: () => ({
        user: {
          servers: {
            edge: {
              displayName: "Edge",
              lazyTools,
              transport: { type: "http", url: "https://example.invalid/mcp" },
            },
          },
        },
        workspace: { servers: {} },
      }),
    },
  });
  await mcp.refreshConfig();

  const internal = mcp as unknown as {
    toolIndexStore: McpToolIndexEntry[];
    catalogRevisionStore: number;
    toolingCacheInitialized: boolean;
    loadedConfigStore: { resolved: Record<string, ResolvedMcpServerConfig> };
  };
  internal.toolingCacheInitialized = true;

  const executor = new HostToolExecutorProxy(peer, mcp);
  executor.setLocalHostService({
    toolDefinitionEnvironment: () => TOOL_DEFINITION_ENVIRONMENT,
  } as unknown as LocalHostToolService);
  await executor.refreshCaches();

  assert.ok(!toolNamesFromDefinitions(executor.toolDefinitionsJson()).includes("mcp__edge__run"));

  internal.toolIndexStore = [
    {
      server: "edge",
      displayName: "Edge",
      toolName: "run",
      description: "Run operation",
      inputSchema: { type: "object", properties: { script: { type: "string" } } },
    },
  ];
  internal.catalogRevisionStore += 1;

  const updatedNames = toolNamesFromDefinitions(executor.toolDefinitionsJson());
  assert.ok(updatedNames.includes("mcp__edge__run"));
  assert.ok(!updatedNames.includes("tool_call"));

  const request = await executor.requestFromFunctionCall(
    "mcp__edge__run",
    JSON.stringify({ script: "status" }),
  );
  const decision = await executor.authorize(request);
  assert.equal(decision.kind, "need-approval");
  if (decision.kind === "need-approval") {
    assert.deepEqual(decision.approval, {
      kind: "lazy_tool_call",
      provider: "mcp",
      server: "edge",
      tool: "run",
      arguments: { script: "status" },
    });
  }

  executor.setApprovalLevel("bypass-approval");
  assert.equal((await executor.authorize(request)).kind, "allowed");

  lazyTools = true;
  await mcp.refreshConfig();
  const lazyNames = toolNamesFromDefinitions(executor.toolDefinitionsJson());
  assert.ok(!lazyNames.includes("mcp__edge__run"));
  assert.ok(lazyNames.includes("tool_describe"));
  assert.ok(lazyNames.includes("tool_call"));
});
