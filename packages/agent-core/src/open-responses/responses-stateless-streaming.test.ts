import assert from "node:assert/strict";
import { test } from "vitest";

import {
  extractAiSdkProviderErrorDetail,
  NonRetryableProviderError,
} from "../openai/ai-sdk-provider-error.js";
import { observeLlmFetchResponse, runInLlmRetryObservationContext } from "../llm-retry.js";
import { materializeProviderPreset } from "../provider-presets/materialize.js";
import { wrapFetchForDynamicBearerAuth } from "./responses-bearer-auth-fetch.js";
import {
  createStatelessStreamingResponsesFetch,
  patchStatelessStreamingResponsesBody,
} from "./responses-stateless-streaming-fetch.js";

test("materializeProviderPreset materializes the chatgpt preset with stateless streaming options", () => {
  const entry = materializeProviderPreset({ presetId: "chatgpt" });
  assert.equal(entry.id, "chatgpt");
  assert.equal(entry.label, "ChatGPT");
  assert.equal(entry.apiBase, "https://api.openai.com/v1");
  assert.equal(entry.transportKind, "open-responses");
  assert.equal(entry.sdk, "@ai-sdk/openai");
  assert.equal(entry.imageApi, undefined);
  assert.equal(entry.fileUpload, undefined);
  assert.deepEqual(entry.options, {
    auth: "chatgpt-oauth",
    applyPatch: true,
    reasoningSummary: true,
    statelessStreamingResponses: true,
  });
});

test("patchStatelessStreamingResponsesBody enforces store=false, stream=true, developer role, and strips unsupported fields", () => {
  const patched = patchStatelessStreamingResponsesBody({
    model: "gpt-6.2-sol",
    store: true,
    stream: false,
    truncation: "disabled",
    max_output_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9,
    previous_response_id: "resp_123",
    prompt_cache_retention: "24h",
    metadata: { a: "1" },
    user: "u_1",
    input: [
      { type: "message", role: "system", content: "You are helpful." },
      { type: "message", role: "user", content: "Hello" },
    ],
  });

  assert.equal(patched.store, false);
  assert.equal(patched.stream, true);
  assert.equal("truncation" in patched, false);
  assert.equal("max_output_tokens" in patched, false);
  assert.equal("temperature" in patched, false);
  assert.equal("top_p" in patched, false);
  assert.equal("previous_response_id" in patched, false);
  assert.equal("prompt_cache_retention" in patched, false);
  assert.equal("metadata" in patched, false);
  assert.equal("user" in patched, false);
  assert.deepEqual(patched.input, [
    { type: "message", role: "developer", content: "You are helpful." },
    { type: "message", role: "user", content: "Hello" },
  ]);
});

test("createStatelessStreamingResponsesFetch rewrites JSON request bodies when enabled", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const wrapped = createStatelessStreamingResponsesFetch(
    { options: { statelessStreamingResponses: true } },
    async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response("ok", { status: 200 });
    },
  );

  await wrapped("https://example.test/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-6.2-sol",
      truncation: "disabled",
      max_output_tokens: 1024,
      input: [{ role: "system", content: "hi" }],
    }),
  });

  assert.equal(capturedBody?.store, false);
  assert.equal(capturedBody?.stream, true);
  assert.equal("truncation" in (capturedBody ?? {}), false);
  assert.equal("max_output_tokens" in (capturedBody ?? {}), false);
  assert.deepEqual(capturedBody?.input, [{ role: "developer", content: "hi" }]);
});

test("wrapFetchForDynamicBearerAuth injects fresh bearer token and retries once after 401", async () => {
  const seenAuthHeaders: string[] = [];
  let token = "tok-initial";
  const wrapped = wrapFetchForDynamicBearerAuth(
    {
      resolveBearerToken: async () => token,
      refreshBearerTokenAfterUnauthorized: async (rejected) => {
        assert.equal(rejected, "tok-initial");
        token = "tok-refreshed";
        return token;
      },
    },
    async (_input, init) => {
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      seenAuthHeaders.push(auth);
      return new Response(auth === "Bearer tok-refreshed" ? "ok" : "unauthorized", {
        status: auth === "Bearer tok-refreshed" ? 200 : 401,
      });
    },
  );

  const response = await wrapped("https://example.test/v1/responses", { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(seenAuthHeaders, ["Bearer tok-initial", "Bearer tok-refreshed"]);
});

test("observeLlmFetchResponse throws NonRetryableProviderError for subscription_sharing_usage_limit_exceeded without retry events", async () => {
  const events: string[] = [];
  let caught: unknown;

  await runInLlmRetryObservationContext(
    {
      observer: (event) => events.push(event.kind),
    },
    async () => {
      try {
        await observeLlmFetchResponse(
          new Response(
            JSON.stringify({
              error: {
                code: "subscription_sharing_usage_limit_exceeded",
                message: "Usage limit reached for this app.",
              },
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "x-request-id": "req_limit_1",
              },
            },
          ),
        );
      } catch (error) {
        caught = error;
      }
    },
  );

  assert.deepEqual(events, []);
  assert.ok(caught instanceof NonRetryableProviderError);
  assert.equal(caught.isRetryable, false);
  assert.deepEqual(extractAiSdkProviderErrorDetail(caught), {
    code: "subscription_sharing_usage_limit_exceeded",
    status: 429,
    requestId: "req_limit_1",
  });
});
