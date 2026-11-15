import assert from "node:assert/strict";
import { test } from "vitest";

import type { ProviderEntry } from "./schema.js";
import {
  listSubagentLanguageModelSelectors,
  resolveSubagentLanguageModelSelector,
} from "./subagent-models.js";

function providers(): ProviderEntry[] {
  return [
    {
      id: "alpha",
      apiBase: "https://alpha.invalid/v1",
      capabilities: ["languageModel"],
      models: [
        { name: "shared", capabilities: ["languageModel"] },
        { name: "vendor/reasoning" },
        { name: "image-only", capabilities: ["imageGeneration"] },
        { name: "shared", capabilities: ["languageModel"] },
      ],
    },
    {
      id: "beta",
      apiBase: "https://beta.invalid/v1",
      models: [{ name: "shared", capabilities: ["languageModel"] }, { name: "undeclared" }],
    },
  ];
}

test("lists unique qualified language models in stable order", () => {
  assert.deepEqual(listSubagentLanguageModelSelectors(providers()), [
    "alpha::shared",
    "alpha::vendor/reasoning",
    "beta::shared",
  ]);
});

test("resolves the exact provider and preserves slash-containing model ids", () => {
  assert.deepEqual(resolveSubagentLanguageModelSelector(providers(), " beta::shared "), {
    providerId: "beta",
    name: "shared",
  });
  assert.deepEqual(resolveSubagentLanguageModelSelector(providers(), "alpha::vendor/reasoning"), {
    providerId: "alpha",
    name: "vendor/reasoning",
  });
});

test("rejects bare, unknown, malformed, and non-language selectors", () => {
  for (const selector of [
    "shared",
    "unknown::shared",
    "alpha::missing",
    "alpha::image-only",
    "beta::undeclared",
    "::shared",
    "alpha::",
  ]) {
    assert.throws(
      () => resolveSubagentLanguageModelSelector(providers(), selector),
      /subagent model/i,
      selector,
    );
  }
});
