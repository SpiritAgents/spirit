import assert from "node:assert/strict";
import { test } from "vitest";

import { createApplyPatchAwareFetch } from "./apply-patch-responses-fetch.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test",
  model: "openai/gpt-5.6-luna",
  sdk: "@ai-sdk/gateway",
  options: { applyPatch: true },
};

test("createApplyPatchAwareFetch skips Responses apply_patch inject on Gateway language-model body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fetchFn = createApplyPatchAwareFetch(gatewayConfig, async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  });

  await fetchFn("https://ai-gateway.vercel.sh/v4/ai/language-model", {
    method: "POST",
    body: JSON.stringify({
      model: "openai/gpt-5.6-luna",
      prompt: [{ role: "user", content: [{ type: "text", text: "compact" }] }],
      toolChoice: { type: "auto" },
    }),
  });

  assert.equal(Array.isArray(capturedBody?.prompt), true);
  assert.equal(capturedBody?.tools, undefined);
});

test("createApplyPatchAwareFetch still injects apply_patch on Open Responses body", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fetchFn = createApplyPatchAwareFetch(gatewayConfig, async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  await fetchFn("https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "openai/gpt-5.6-luna",
      input: [{ role: "user", content: "edit" }],
      tools: [{ type: "function", name: "grep", parameters: {} }],
    }),
  });

  const tools = capturedBody?.tools as Array<{ name?: string; type?: string }> | undefined;
  assert.ok(tools?.some((tool) => tool.name === "apply_patch" && tool.type === "function"));
});
