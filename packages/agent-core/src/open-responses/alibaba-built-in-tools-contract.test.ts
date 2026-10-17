import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import { buildResponsesTraceTools } from "./apply-patch-bridge.js";
import { buildResponsesProviderOptions } from "./model-factory.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const alibabaResponsesConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test-key",
  model: "qwen3-max",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  llmVendor: "alibaba",
};

test("alibaba responses provider options carry no vendor thinking field", () => {
  // The thinking wire encoding arrives via the declared thinkingSwitch merge, not providerOptions.
  const options = buildResponsesProviderOptions(alibabaResponsesConfig);
  assert.equal(options.alibaba, undefined);
});

test("alibaba responses trace lists builtin tools with host function tools", () => {
  const traceTools = buildResponsesTraceTools(alibabaResponsesConfig, [demoToolDefinition()]);
  for (const type of ["web_search", "code_interpreter"] as const) {
    assert.ok(
      traceTools.some(
        (tool) =>
          typeof tool === "object" &&
          tool !== null &&
          !Array.isArray(tool) &&
          (tool as { type?: string }).type === type,
      ),
      `missing ${type}`,
    );
  }
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        !Array.isArray(tool) &&
        (tool as { type?: string }).type === "function",
    ),
  );
});

function demoToolDefinition(): JsonValue {
  return {
    type: "function",
    function: {
      name: "demo_lookup",
      description: "Lookup demo data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  };
}
