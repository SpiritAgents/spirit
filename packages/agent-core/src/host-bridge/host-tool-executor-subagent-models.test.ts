import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import { JsonRpcPeer } from "./framing.js";
import { HostToolExecutorProxy, type LocalHostToolService } from "./host-tool-executor.js";

function createExecutor(): HostToolExecutorProxy {
  const peer = {
    call: async () => ({}),
    notify: () => {},
  } as unknown as JsonRpcPeer;
  const executor = new HostToolExecutorProxy(peer);
  executor.setLocalHostService({
    toolDefinitionEnvironment: () => ({
      shellDisplayName: "shell",
      commandParameterDescription: "Command to run.",
    }),
  } as unknown as LocalHostToolService);
  return executor;
}

function subagentModelSchema(definitions: JsonValue) {
  assert.ok(Array.isArray(definitions));
  const definition = definitions.find(
    (entry) =>
      isJsonObject(entry) && isJsonObject(entry.function) && entry.function.name === "subagent",
  );
  assert.ok(isJsonObject(definition));
  const fn = definition.function;
  assert.ok(isJsonObject(fn));
  const parameters = fn.parameters;
  assert.ok(isJsonObject(parameters));
  const properties = parameters.properties;
  assert.ok(isJsonObject(properties));
  const model = properties.model;
  assert.ok(isJsonObject(model));
  return { model, required: parameters.required };
}

test("subagent model is optional and its available selectors refresh live", async () => {
  let selectors = ["legacy::shared"];
  const executor = createExecutor();
  executor.setSubagentLanguageModelSelectorResolver(() => selectors);
  await executor.refreshCaches();

  const initial = subagentModelSchema(executor.toolDefinitionsJson());
  assert.deepEqual(initial.required, ["prompt"]);
  assert.match(String(initial.model.description), /providerId::modelId/);
  assert.match(String(initial.model.description), /inherit the current main agent model/);
  assert.match(String(initial.model.description), /keep the target session's current model/);
  assert.match(String(initial.model.description), /Available language models: legacy::shared\./);

  selectors = ["beta::vendor/reasoning", "alpha::shared"];
  const refreshed = subagentModelSchema(executor.toolDefinitionsJson());
  assert.match(
    String(refreshed.model.description),
    /Available language models: alpha::shared, beta::vendor\/reasoning\./,
  );
  assert.doesNotMatch(String(refreshed.model.description), /legacy::shared/);

  selectors = [];
  const emptied = subagentModelSchema(executor.toolDefinitionsJson());
  assert.doesNotMatch(String(emptied.model.description), /Available language models:/);
});
