import assert from "node:assert/strict";
import { test } from "vitest";

import { groupModelsForPicker, providerLabelMetadata } from "../../src/lib/model-picker-groups.ts";

const PRESET_ROWS = [
  { id: "openai", label: "OpenAI" },
  { id: "kimi-code", label: "Kimi Code" },
  { id: "anthropic", label: "Anthropic" },
];

function model(providerId, name) {
  return {
    providerId,
    name,
    apiBase: "https://example.com/v1",
    ref: { providerId, name },
  };
}

test("groupModelsForPicker orders groups by the snapshot's preset rows and labels them", () => {
  const groups = groupModelsForPicker(
    [model("anthropic", "claude-opus-5.5"), model("openai", "gpt-5.5"), model("kimi-code", "k3")],
    undefined,
    undefined,
    PRESET_ROWS,
  );

  assert.deepEqual(
    groups.map((group) => `${group.providerId}:${group.fallbackLabel}`),
    ["openai:OpenAI", "kimi-code:Kimi Code", "anthropic:Anthropic"],
  );
});

test("groupModelsForPicker sorts unknown providers last and keeps custom entry labels", () => {
  const groups = groupModelsForPicker(
    [model("my-lab", "local-model"), model("openai", "gpt-5.5")],
    undefined,
    [{ id: "my-lab", label: "Lab LLM", apiBase: "http://192.168.1.10:8000/v1", models: [] }],
    PRESET_ROWS,
  );

  assert.deepEqual(
    groups.map((group) => group.providerId),
    ["openai", "my-lab"],
  );
  assert.equal(groups[1]?.customLabel, "Lab LLM");
  assert.equal(groups[1]?.fallbackLabel, "my-lab");
});

test("providerLabelMetadata reads the fallback label from the snapshot rows", () => {
  assert.deepEqual(providerLabelMetadata("kimi-code", PRESET_ROWS), {
    labelKey: "providers.kimiCode",
    fallbackLabel: "Kimi Code",
  });
  assert.deepEqual(providerLabelMetadata("my-lab", PRESET_ROWS), {
    labelKey: "providers.myLab",
    fallbackLabel: "my-lab",
  });
});
