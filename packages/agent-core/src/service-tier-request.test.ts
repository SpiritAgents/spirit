import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "./ports.js";
import {
  mergeServiceTierProviderOptions,
  resolveServiceTierRequestPlan,
  type ServiceTierRequestContext,
} from "./service-tier-request.js";

function plan(
  context: Partial<ServiceTierRequestContext> & Pick<ServiceTierRequestContext, "surface">,
) {
  return resolveServiceTierRequestPlan(context);
}

test("unset serviceTier resolves to an empty plan on every surface", () => {
  assert.deepEqual(plan({ provider: "openai", model: "gpt-5.4", surface: "responses" }), {});
  assert.deepEqual(
    plan({ provider: "openrouter", model: "openai/gpt-5.4", surface: "chat-completions" }),
    {},
  );
  assert.deepEqual(
    plan({ provider: "vercel-ai-gateway", model: "openai/gpt-5.4", surface: "gateway-v3" }),
    {},
  );
  assert.deepEqual(
    plan({
      provider: "google-vertex-ai",
      model: "gemini-2.5-flash",
      vertexLocation: "global",
      surface: "chat-completions",
    }),
    {},
  );
});

test("openai responses maps auto/default/flex/fast to SDK provider options", () => {
  for (const tier of ["auto", "default", "flex", "fast"] as const) {
    const result = plan({
      provider: "openai",
      model: "gpt-5.4",
      serviceTier: tier,
      surface: "responses",
    });
    assert.deepEqual(result.providerOptions, { openai: { serviceTier: tier } });
    assert.equal(result.bodyServiceTier, undefined);
    assert.equal(result.headers, undefined);
    assert.equal(result.flexWaiting, tier === "flex" ? true : undefined);
  }
});

test("openai responses ultrafast uses the official SDK enum plus the direct-only header", () => {
  const astra = plan({
    provider: "openai",
    model: "gpt-6-astra",
    serviceTier: "ultrafast",
    surface: "responses",
  });
  assert.deepEqual(astra, {
    providerOptions: { openai: { serviceTier: "ultrafast" } },
    headers: { "OpenAI-Service-Tier": "ultrafast" },
  });

  assert.deepEqual(
    plan({ provider: "openai", model: "gpt-5.4", serviceTier: "ultrafast", surface: "responses" }),
    {},
  );
});

test("openai on the chat-completions surface injects nothing", () => {
  assert.deepEqual(
    plan({
      provider: "openai",
      model: "gpt-5.4",
      serviceTier: "flex",
      surface: "chat-completions",
    }),
    {},
  );
});

test("openai priority is not injected (rejected at config parse)", () => {
  assert.deepEqual(
    plan({ provider: "openai", model: "gpt-5.4", serviceTier: "priority", surface: "responses" }),
    {},
  );
});

test("xai maps default/priority on chat-completions and responses", () => {
  for (const surface of ["chat-completions", "responses"] as const) {
    for (const tier of ["default", "priority"] as const) {
      assert.deepEqual(plan({ provider: "xai", model: "grok-4.3", serviceTier: tier, surface }), {
        providerOptions: { xai: { serviceTier: tier } },
      });
    }
  }
  assert.deepEqual(
    plan({ provider: "xai", model: "grok-4.3", serviceTier: "flex", surface: "chat-completions" }),
    {},
  );
});

test("google maps default/flex/priority to the Developer API body enum", () => {
  assert.deepEqual(
    plan({
      provider: "google",
      model: "gemini-2.5-flash",
      serviceTier: "default",
      surface: "chat-completions",
    }),
    { providerOptions: { google: { serviceTier: "standard" } } },
  );
  assert.deepEqual(
    plan({
      provider: "google",
      model: "gemini-2.5-flash",
      serviceTier: "flex",
      surface: "chat-completions",
    }),
    { providerOptions: { google: { serviceTier: "flex" } }, flexWaiting: true },
  );
  assert.deepEqual(
    plan({
      provider: "google",
      model: "gemini-2.5-flash",
      serviceTier: "priority",
      surface: "chat-completions",
    }),
    { providerOptions: { google: { serviceTier: "priority" } } },
  );
});

test("vertex global maps flex/priority to shared capacity headers options", () => {
  assert.deepEqual(
    plan({
      provider: "google-vertex-ai",
      model: "gemini-2.5-flash",
      serviceTier: "flex",
      vertexLocation: "global",
      surface: "chat-completions",
    }),
    {
      providerOptions: { vertex: { sharedRequestType: "flex", requestType: "shared" } },
      flexWaiting: true,
    },
  );
  assert.deepEqual(
    plan({
      provider: "google-vertex-ai",
      model: "gemini-2.5-flash",
      serviceTier: "priority",
      vertexLocation: "global",
      surface: "chat-completions",
    }),
    { providerOptions: { vertex: { sharedRequestType: "priority", requestType: "shared" } } },
  );
});

test("vertex default and regional endpoints inject nothing", () => {
  assert.deepEqual(
    plan({
      provider: "google-vertex-ai",
      model: "gemini-2.5-flash",
      serviceTier: "default",
      vertexLocation: "global",
      surface: "chat-completions",
    }),
    {},
  );
  assert.deepEqual(
    plan({
      provider: "google-vertex-ai",
      model: "gemini-2.5-flash",
      serviceTier: "flex",
      vertexLocation: "us-central1",
      surface: "chat-completions",
    }),
    {},
  );
});

test("vercel gateway-v3 maps upstream openai flex/fast to the gateway namespace", () => {
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.4",
      serviceTier: "flex",
      upstreamProvider: "openai",
      surface: "gateway-v3",
    }),
    { providerOptions: { gateway: { serviceTier: "flex" } }, flexWaiting: true },
  );
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.4",
      serviceTier: "fast",
      upstreamProvider: "openai",
      surface: "gateway-v3",
    }),
    { providerOptions: { gateway: { serviceTier: "fast" } } },
  );
});

test("vercel gateway-v3 astra ultrafast uses the openai namespace, never the gateway enum", () => {
  const result = plan({
    provider: "vercel-ai-gateway",
    model: "openai/gpt-6-astra",
    serviceTier: "ultrafast",
    upstreamProvider: "openai",
    surface: "gateway-v3",
  });
  assert.deepEqual(result.providerOptions, { openai: { serviceTier: "ultrafast" } });
  assert.deepEqual(Object.keys(result.providerOptions ?? {}), ["openai"]);
  assert.equal(result.bodyServiceTier, undefined);
});

test("vercel gateway-v3 default/unlisted upstreams inject nothing", () => {
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.4",
      serviceTier: "default",
      upstreamProvider: "openai",
      surface: "gateway-v3",
    }),
    {},
  );
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "anthropic/claude-opus-4-8",
      serviceTier: "fast",
      upstreamProvider: "anthropic",
      surface: "gateway-v3",
    }),
    {},
  );
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "mystery-model",
      serviceTier: "fast",
      upstreamProvider: "unknown-co",
      surface: "gateway-v3",
    }),
    {},
  );
});

test("vercel gateway-v3 maps google and xai upstreams", () => {
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "google/gemini-2.5-flash",
      serviceTier: "priority",
      upstreamProvider: "google",
      surface: "gateway-v3",
    }),
    { providerOptions: { gateway: { serviceTier: "priority" } } },
  );
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "xai/grok-4.3",
      serviceTier: "priority",
      upstreamProvider: "xai",
      surface: "gateway-v3",
    }),
    { providerOptions: { gateway: { serviceTier: "priority" } } },
  );
  // Non-OpenAI upstreams have no Fast alias; the canonical fast value maps to nothing here
  // (the config parser rejects it before a request is built).
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "xai/grok-4.3",
      serviceTier: "fast",
      upstreamProvider: "xai",
      surface: "gateway-v3",
    }),
    {},
  );
});

test("vercel responses surface patches top-level body service_tier", () => {
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.4",
      serviceTier: "fast",
      upstreamProvider: "openai",
      surface: "responses",
    }),
    { bodyServiceTier: "fast" },
  );
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-6-astra",
      serviceTier: "ultrafast",
      upstreamProvider: "openai",
      surface: "responses",
    }),
    { bodyServiceTier: "ultrafast" },
  );
  // Ultrafast is never given the user-specified direct-OpenAI header on aggregators.
  assert.equal(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-6-astra",
      serviceTier: "ultrafast",
      upstreamProvider: "openai",
      surface: "responses",
    }).headers,
    undefined,
  );
});

test("openrouter chat-completions patches body service_tier per upstream", () => {
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "openai/gpt-5.4",
      serviceTier: "flex",
      upstreamProvider: "openai",
      surface: "chat-completions",
    }),
    { bodyServiceTier: "flex", flexWaiting: true },
  );
  // Explicit default must be sent to override :nitro / :floor variant admission.
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      serviceTier: "default",
      upstreamProvider: "google",
      surface: "chat-completions",
    }),
    { bodyServiceTier: "default" },
  );
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "anthropic/claude-opus-4-8",
      serviceTier: "priority",
      upstreamProvider: "anthropic",
      surface: "chat-completions",
    }),
    { bodyServiceTier: "priority" },
  );
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "openai/gpt-6-astra",
      serviceTier: "ultrafast",
      upstreamProvider: "openai",
      surface: "chat-completions",
    }),
    { bodyServiceTier: "ultrafast" },
  );
});

test("openrouter unknown upstream and out-of-matrix values inject nothing", () => {
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "openai/gpt-5.4",
      serviceTier: "flex",
      upstreamProvider: "anthropic",
      surface: "chat-completions",
    }),
    {},
  );
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "mystery",
      serviceTier: "fast",
      upstreamProvider: "unknown-co",
      surface: "chat-completions",
    }),
    {},
  );
});

test("openrouter responses surface mirrors chat-completions", () => {
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "x-ai/grok-4.3",
      serviceTier: "priority",
      upstreamProvider: "x-ai",
      surface: "responses",
    }),
    { bodyServiceTier: "priority" },
  );
});

test("aggregator identity falls back to the model id prefix when the catalog fact is absent", () => {
  assert.deepEqual(
    plan({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.4",
      serviceTier: "fast",
      surface: "gateway-v3",
    }),
    { providerOptions: { gateway: { serviceTier: "fast" } } },
  );
  assert.deepEqual(
    plan({
      provider: "openrouter",
      model: "openai/gpt-5.4",
      serviceTier: "fast",
      surface: "chat-completions",
    }),
    { bodyServiceTier: "fast" },
  );
});

test("unlisted providers inject nothing", () => {
  assert.deepEqual(
    plan({
      provider: "deepseek",
      model: "deepseek-v4",
      serviceTier: "flex",
      surface: "chat-completions",
    }),
    {},
  );
  assert.deepEqual(
    plan({ provider: "azure", model: "gpt-5.4", serviceTier: "flex", surface: "responses" }),
    {},
  );
  assert.deepEqual(
    plan({ model: "custom-model", serviceTier: "flex", surface: "chat-completions" }),
    {},
  );
});

test("mergeServiceTierProviderOptions merges per namespace without clobbering existing keys", () => {
  const base: Record<string, JsonObject> = {
    openai: {
      reasoningEffort: "high",
      store: true,
      previousResponseId: "resp_prev",
    },
  };
  const merged = mergeServiceTierProviderOptions(base, {
    providerOptions: { openai: { serviceTier: "flex" } },
  });

  assert.deepEqual(merged, {
    openai: {
      reasoningEffort: "high",
      store: true,
      previousResponseId: "resp_prev",
      serviceTier: "flex",
    },
  });
  // The base object is not mutated.
  assert.deepEqual(base.openai?.serviceTier, undefined);
});

test("mergeServiceTierProviderOptions adds new namespaces and is identity for empty plans", () => {
  const base: Record<string, JsonObject> = { vertex: { thinkingConfig: { thinkingBudget: 8 } } };
  const merged = mergeServiceTierProviderOptions(base, {
    providerOptions: { vertex: { sharedRequestType: "flex", requestType: "shared" } },
  });
  assert.deepEqual(merged.vertex, {
    thinkingConfig: { thinkingBudget: 8 },
    sharedRequestType: "flex",
    requestType: "shared",
  });

  const empty = mergeServiceTierProviderOptions(base, {});
  assert.equal(empty, base);
});
