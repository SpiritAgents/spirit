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

const STEPFUN_CONFIG: LlmTransportConfig = {
  apiKey: "k",
  model: "step-3",
  llmVendor: "stepfun",
};

test("default exposure keeps web_fetch and managed web_search", async () => {
  const names = await toolNamesFor(STEPFUN_CONFIG);
  assert.ok(names.includes("web_fetch"));
  assert.ok(names.includes("web_search"));
});

test("webFetchEnabled=false hides web_fetch but keeps managed web_search", async () => {
  const names = await toolNamesFor({ ...STEPFUN_CONFIG, webFetchEnabled: false });
  assert.ok(!names.includes("web_fetch"));
  assert.ok(names.includes("web_search"));
});

test("webSearchEnabled=false hides managed web_search but keeps web_fetch", async () => {
  const names = await toolNamesFor({ ...STEPFUN_CONFIG, webSearchEnabled: false });
  assert.ok(!names.includes("web_search"));
  assert.ok(names.includes("web_fetch"));
});

test("explicit true keeps both tools exposed", async () => {
  const names = await toolNamesFor({
    ...STEPFUN_CONFIG,
    webSearchEnabled: true,
    webFetchEnabled: true,
  });
  assert.ok(names.includes("web_fetch"));
  assert.ok(names.includes("web_search"));
});
