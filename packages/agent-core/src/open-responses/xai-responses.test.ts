import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import { buildResponsesTraceTools } from "./apply-patch-bridge.js";
import { buildResponsesProviderOptions } from "./model-factory.js";
import {
  buildOpenResponsesRequestTrace,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";
import {
  xaiResponsesLocalToolsUnsupportedMessage,
  xaiResponsesRejectsLocalFunctionTools,
} from "./xai-responses-pre-guard.js";

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

const noResolvedProviderTools = { functionTools: [], literalEntries: [] };
const resolvedWebSearchEntry = {
  functionTools: [],
  literalEntries: [{ type: "web_search" }],
};

test("the xAI local-tools pre-guard keys on the declared sdk and provider tool resolution", () => {
  // Local function tools + no active provider tools on the xAI Responses surface -> reject early.
  assert.equal(xaiResponsesRejectsLocalFunctionTools(xaiConfig, 1, noResolvedProviderTools), true);
  // A resolved provider tool entry (web search) makes the combination legal upstream.
  assert.equal(xaiResponsesRejectsLocalFunctionTools(xaiConfig, 1, resolvedWebSearchEntry), false);
  // The global provider-tools opt-out rejects even when the entry declares tools.
  assert.equal(
    xaiResponsesRejectsLocalFunctionTools(
      { ...xaiConfig, providerToolsEnabled: false },
      1,
      resolvedWebSearchEntry,
    ),
    true,
  );
  // No local tools: nothing to reject.
  assert.equal(xaiResponsesRejectsLocalFunctionTools(xaiConfig, 0, noResolvedProviderTools), false);
  // Other sdk adapters are unaffected by the guard.
  assert.equal(
    xaiResponsesRejectsLocalFunctionTools(
      { ...xaiConfig, sdk: "@ai-sdk/openai" },
      1,
      noResolvedProviderTools,
    ),
    false,
  );

  assert.equal(
    xaiResponsesLocalToolsUnsupportedMessage(),
    "SpaceXAI Responses API does not support local function tools yet; please use the Chat Completions transport instead.",
  );
});
