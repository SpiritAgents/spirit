import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildDeepSeekResponsesBuiltInTools,
  mergeDeepSeekResponsesBuiltInTools,
  shouldUseDeepSeekResponsesBuiltInTools,
} from "./deepseek-built-in-tools.js";

test("shouldUseDeepSeekResponsesBuiltInTools only for deepseek open-responses", () => {
  assert.equal(
    shouldUseDeepSeekResponsesBuiltInTools({
      transportKind: "open-responses",
      apiKey: "k",
      model: "deepseek-v4-flash",
      llmVendor: "deepseek",
    }),
    true,
  );
  assert.equal(
    shouldUseDeepSeekResponsesBuiltInTools({
      apiKey: "k",
      model: "deepseek-v4-flash",
      llmVendor: "deepseek",
    }),
    false,
  );
  assert.equal(
    shouldUseDeepSeekResponsesBuiltInTools({
      transportKind: "open-responses",
      apiKey: "k",
      model: "gpt-4.1",
      llmVendor: "openai",
    }),
    false,
  );
});

test("buildDeepSeekResponsesBuiltInTools returns web_search only", () => {
  const tools = buildDeepSeekResponsesBuiltInTools();
  assert.equal(tools.length, 1);
  assert.deepEqual(tools, [{ type: "web_search" }]);
});

test("mergeDeepSeekResponsesBuiltInTools does not duplicate web_search", () => {
  const merged = mergeDeepSeekResponsesBuiltInTools([
    { type: "function", name: "grep" },
    { type: "web_search" },
    { type: "web_search_2025_08_26" },
  ]);
  const types = merged
    .map((tool) =>
      typeof tool === "object" && tool !== null && !Array.isArray(tool)
        ? (tool as { type?: string }).type
        : undefined,
    )
    .filter((type): type is string => typeof type === "string");
  assert.equal(types.filter((type) => type === "web_search").length, 1);
  assert.equal(types.includes("web_search_2025_08_26"), true);
  assert.equal(types.includes("function"), true);
  assert.equal(types.includes("code_interpreter"), false);
});

test("shouldUseDeepSeekResponsesBuiltInTools honors the web search opt-out", () => {
  assert.equal(
    shouldUseDeepSeekResponsesBuiltInTools({
      transportKind: "open-responses",
      apiKey: "k",
      model: "deepseek-v4-flash",
      llmVendor: "deepseek",
      webSearchEnabled: false,
    }),
    false,
  );
});
