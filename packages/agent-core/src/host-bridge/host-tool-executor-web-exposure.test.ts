import assert from "node:assert/strict";
import { test } from "vitest";

import type { LlmTransportConfig } from "../provider-config.js";
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
