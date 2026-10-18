import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import { buildResponsesTraceTools } from "./apply-patch-bridge.js";
import { buildResponsesProviderOptions } from "./model-factory.js";
import {
  buildOpenResponsesRequestTrace,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";

const xaiConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test-key",
  model: "grok-4.3",
  baseUrl: "https://api.x.ai/v1",
  sdk: "@ai-sdk/xai",
  reasoningEffort: "medium",
};

test("xAI responses provider options and trace kind key on the declared sdk", () => {
  assert.deepEqual(buildResponsesProviderOptions(xaiConfig), {
    xai: { reasoningEffort: "medium" },
  });
  assert.deepEqual(buildResponsesProviderOptions({ ...xaiConfig, reasoningEffort: "none" }), {
    xai: { reasoningEffort: "none" },
  });

  const trace = buildOpenResponsesRequestTrace(
    xaiConfig,
    1,
    [{ role: "user", content: "hello" }],
    [],
  )[0];
  assert.equal(
    trace && typeof trace === "object" && !Array.isArray(trace) ? trace.kind : undefined,
    "xai_sdk_responses",
  );
});

test("xAI responses trace lists declared provider tools alongside host tools", () => {
  const traceTools = buildResponsesTraceTools(xaiConfig, [demoToolDefinition()], {
    functionTools: [],
    literalEntries: [{ type: "web_search" }],
  });
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        !Array.isArray(tool) &&
        (tool as { type?: string }).type === "web_search",
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
