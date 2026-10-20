import assert from "node:assert/strict";
import { test } from "vitest";

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

test("unset tier preserves the request byte-for-byte", () => {
  assert.deepEqual(plan({ surface: "responses" }), {});
  assert.deepEqual(plan({ surface: "chat-completions" }), {});
  assert.deepEqual(plan({ surface: "messages" }), {});
});

test("simple form maps every canonical tier onto the OpenAI-family service_tier body field", () => {
  for (const surface of ["chat-completions", "responses"] as const) {
    for (const serviceTier of [
      "auto",
      "default",
      "flex",
      "fast",
      "priority",
      "ultrafast",
    ] as const) {
      assert.deepEqual(
        plan({
          surface,
          serviceTier,
          serviceTiers: ["auto", "default", "flex", "fast", "priority", "ultrafast"],
        }),
        {
          body: { service_tier: serviceTier },
          ...(serviceTier === "flex" ? { flexWaiting: true } : {}),
        },
        `${surface} ${serviceTier}`,
      );
    }
  }
});

test("simple form works the same when the model declares no serviceTiers list (config load validates)", () => {
  assert.deepEqual(plan({ surface: "responses", serviceTier: "fast" }), {
    body: { service_tier: "fast" },
  });
});

test("gateway v3 maps only flex/priority into the gateway namespace provider option", () => {
  assert.deepEqual(plan({ surface: "gateway-v3", serviceTier: "flex" }), {
    providerOptions: { gateway: { serviceTier: "flex" } },
    flexWaiting: true,
  });
  assert.deepEqual(plan({ surface: "gateway-v3", serviceTier: "priority" }), {
    providerOptions: { gateway: { serviceTier: "priority" } },
  });
  assert.deepEqual(plan({ surface: "gateway-v3", serviceTier: "fast" }), {});
});

test("messages and bedrock surfaces carry no simple-form mapping (Anthropic speed lives in its transport)", () => {
  assert.deepEqual(plan({ surface: "messages", serviceTier: "fast" }), {});
  assert.deepEqual(plan({ surface: "bedrock", serviceTier: "priority" }), {});
});

test("literal form applies the tier's declared headers and body verbatim with zero mapping", () => {
  const serviceTiers = {
    fast: {
      headers: { "anthropic-beta": "fast-mode-2026-02-01" },
      body: { speed: "fast" },
    },
  } as const;
  assert.deepEqual(plan({ surface: "messages", serviceTier: "fast", serviceTiers }), {
    headers: { "anthropic-beta": "fast-mode-2026-02-01" },
    body: { speed: "fast" },
  });
  // The same declaration wins on any surface: the runtime holds no per-surface mapping for literals.
  assert.deepEqual(plan({ surface: "responses", serviceTier: "fast", serviceTiers }), {
    headers: { "anthropic-beta": "fast-mode-2026-02-01" },
    body: { speed: "fast" },
  });
});

test("literal form keeps name-keyed flex waiting and maps nothing for a missing tier", () => {
  assert.deepEqual(
    plan({
      surface: "responses",
      serviceTier: "flex",
      serviceTiers: { flex: { body: { service_tier: "flex" } } },
    }),
    { body: { service_tier: "flex" }, flexWaiting: true },
  );
  // A tier missing from the literal map is a config-load error; the runtime sends nothing.
  assert.deepEqual(
    plan({
      surface: "responses",
      serviceTier: "fast",
      serviceTiers: { flex: { body: { service_tier: "flex" } } },
    }),
    {},
  );
});

test("gemini literal declaration maps default onto the standard wire enum", () => {
  // The google-gemini knowledge records declare this literal map verbatim; the Gemini Developer
  // API speaks serviceTier standard/flex/priority, so the neutral default maps to standard.
  const serviceTiers = {
    default: { body: { serviceTier: "standard" } },
    flex: { body: { serviceTier: "flex" } },
    priority: { body: { serviceTier: "priority" } },
  } as const;
  assert.deepEqual(plan({ surface: "generate-content", serviceTier: "default", serviceTiers }), {
    body: { serviceTier: "standard" },
  });
  assert.deepEqual(plan({ surface: "generate-content", serviceTier: "flex", serviceTiers }), {
    body: { serviceTier: "flex" },
    flexWaiting: true,
  });
  assert.deepEqual(plan({ surface: "generate-content", serviceTier: "priority", serviceTiers }), {
    body: { serviceTier: "priority" },
  });
});

test("mergeServiceTierProviderOptions joins namespaces instead of replacing them", () => {
  const merged = mergeServiceTierProviderOptions(
    { openai: { reasoningEffort: "high", store: true } },
    { providerOptions: { gateway: { serviceTier: "flex" }, openai: { serviceTier: "auto" } } },
  );
  assert.deepEqual(merged, {
    openai: { reasoningEffort: "high", store: true, serviceTier: "auto" },
    gateway: { serviceTier: "flex" },
  });
});

test("mergeServiceTierProviderOptions returns the base when the plan carries no providerOptions", () => {
  const base = { openai: { reasoningEffort: "high" } };
  assert.equal(mergeServiceTierProviderOptions(base, {}), base);
  assert.equal(mergeServiceTierProviderOptions(base, { providerOptions: {} }), base);
});
