import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import {
  buildApplyPatchToolCallArgumentsJson,
  buildResponsesTraceTools,
  prepareApplyPatchRequestBodyStash,
  runWithApplyPatchBridgeContext,
} from "./apply-patch-bridge.js";
import { APPLY_PATCH_HOST_TOOL_NAME } from "./apply-patch-eligibility.js";
import { createApplyPatchAwareFetch } from "./apply-patch-responses-fetch.js";
import {
  buildGatewayWebSearchTool,
  buildGatewayWebSearchTraceToolEntry,
  shouldUseGatewayWebSearch,
} from "./gateway-web-search.js";
import { buildResponsesGenerateTools, createResponsesLanguageModel } from "./model-factory.js";
import {
  resolveProviderWebSearchMode,
  shouldUseProviderWebSearch,
} from "./web-search-eligibility.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test-key",
  model: "openai/gpt-5.4",
  llmVendor: "vercel-ai-gateway",
};

const hostTool = {
  type: "function",
  function: {
    name: "grep",
    description: "search",
    parameters: { type: "object", properties: {} },
  },
} as const;

test("shouldUseGatewayWebSearch matches vercel-ai-gateway open-responses", () => {
  assert.equal(shouldUseGatewayWebSearch(gatewayConfig), true);
  assert.equal(shouldUseGatewayWebSearch({ llmVendor: "openrouter" }), false);
});

test("resolveProviderWebSearchMode enables gateway-sdk-web-search", () => {
  assert.equal(resolveProviderWebSearchMode(gatewayConfig), "gateway-sdk-web-search");
  assert.equal(shouldUseProviderWebSearch(gatewayConfig), true);
});

test("buildGatewayWebSearchTool returns provider tool with gateway perplexity id", () => {
  const tool = buildGatewayWebSearchTool(gatewayConfig) as {
    type?: string;
    id?: string;
  };
  assert.equal(tool.type, "provider");
  assert.equal(tool.id, "gateway.perplexity_search");
});

test("buildResponsesGenerateTools adds web_search for gateway", () => {
  const tools = buildResponsesGenerateTools(gatewayConfig, [hostTool]);
  assert.ok("web_search" in tools);
  assert.ok("grep" in tools);
});

test("buildGatewayWebSearchTraceToolEntry names web_search for UI parity", () => {
  assert.deepEqual(buildGatewayWebSearchTraceToolEntry(), {
    type: "provider_tool",
    id: "gateway.perplexity_search",
    name: "web_search",
  });
});

test("createResponsesLanguageModel uses gateway v3 when web search enabled", () => {
  const model = createResponsesLanguageModel(gatewayConfig) as { provider?: string };
  assert.equal(model.provider, "gateway");
});

test("gateway responses trace lists web_search alongside host tools when eligible", () => {
  const traceTools = buildResponsesTraceTools(gatewayConfig, [hostTool as JsonValue]);
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        !Array.isArray(tool) &&
        (tool as { id?: string }).id === "gateway.perplexity_search" &&
        (tool as { name?: string }).name === "web_search",
    ),
  );
});

test("createApplyPatchAwareFetch injects stashed apply_patch output for OpenRouter fetch path", async () => {
  await runWithApplyPatchBridgeContext(async () => {
    const callId = "call_gateway_fetch";
    const operation = { type: "create_file", path: "demo.txt", diff: "+hi\n" };
    prepareApplyPatchRequestBodyStash([
      {
        role: "assistant",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name: APPLY_PATCH_HOST_TOOL_NAME,
              arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: callId, content: "created ok" },
    ]);

    let patchedBody: Record<string, unknown> | undefined;
    const openrouterConfig: OpenResponsesTransportConfig = {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      options: { applyPatch: true },
    };
    const fetchFn = createApplyPatchAwareFetch(openrouterConfig, async (_input, init) => {
      patchedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await fetchFn("https://example.test/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-5.4", input: [] }),
    });

    const input = patchedBody?.input as Array<Record<string, unknown>>;
    assert.equal(input?.length, 2);
    assert.equal(input?.[1]?.output, "created ok");
  });
});
