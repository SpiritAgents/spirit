import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject, JsonValue } from "./ports.js";
import {
  buildOpenRouterAnthropicReasoningBody,
  createOpenRouterAnthropicReasoningFetch,
  usesOpenRouterAnthropicReasoning,
  type OpenRouterAnthropicReasoningConfig,
} from "./openrouter-anthropic-reasoning.js";

const DECLARED = { options: { openRouterAnthropicReasoning: true } } as const;

const ADAPTIVE_SWITCH = {
  on: {
    body: { thinking: { type: "adaptive" } },
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
  },
  off: {
    body: { thinking: { type: "disabled" } },
    providerOptions: { anthropic: { thinking: { type: "disabled" } } },
  },
} as const;

const BUDGET_SWITCH = {
  on: {
    body: { thinking: { type: "enabled", budget_tokens: 12000 } },
    providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
  },
  off: {
    body: { thinking: { type: "disabled" } },
    providerOptions: { anthropic: { thinking: { type: "disabled" } } },
  },
} as const;

function config(
  model: string,
  extra?: Partial<OpenRouterAnthropicReasoningConfig>,
): OpenRouterAnthropicReasoningConfig {
  return { ...DECLARED, model, ...extra };
}

test("usesOpenRouterAnthropicReasoning keys on the declaration and the anthropic route prefix", () => {
  assert.equal(usesOpenRouterAnthropicReasoning(config("anthropic/claude-sonnet-4.6")), true);
  assert.equal(usesOpenRouterAnthropicReasoning(config("Anthropic/Claude-Opus-4.8")), true);
  // The declaration alone is not enough: non-anthropic routes keep the generic encoding.
  assert.equal(usesOpenRouterAnthropicReasoning(config("openai/gpt-5")), false);
  // The route prefix alone is not enough: the provider must declare the mechanism.
  assert.equal(usesOpenRouterAnthropicReasoning({ model: "anthropic/claude-sonnet-4.6" }), false);
});

test("effort none maps to the unified effort field", () => {
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-sonnet-4.6", {
        reasoningEffort: "none",
        thinkingSwitch: ADAPTIVE_SWITCH,
      }),
    ),
    { effort: "none" },
  );
});

test("adaptive models send enabled with the declared effort, default sends bare enabled", () => {
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-opus-4.8", {
        reasoningEffort: "medium",
        thinkingSwitch: ADAPTIVE_SWITCH,
      }),
    ),
    { enabled: true, effort: "medium" },
  );
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-sonnet-4.6", {
        reasoningEffort: "default",
        thinkingSwitch: ADAPTIVE_SWITCH,
      }),
    ),
    { enabled: true },
  );
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-sonnet-4.6", { thinkingSwitch: ADAPTIVE_SWITCH }),
    ),
    { enabled: true },
  );
});

test("adaptive models honor the thinking switch only when an off patch is declared", () => {
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-opus-4.8", {
        vendorExtendedThinking: false,
        thinkingSwitch: ADAPTIVE_SWITCH,
      }),
    ),
    { enabled: false },
  );
  // Always-on families declare no off patch; thinking stays enabled.
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-fable-5", {
        vendorExtendedThinking: false,
        thinkingSwitch: { on: ADAPTIVE_SWITCH.on },
      }),
    ),
    { enabled: true },
  );
});

test("budget-era models send the declared budget as max_tokens and honor the off switch", () => {
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-sonnet-4-5", {
        reasoningEffort: "medium",
        thinkingSwitch: BUDGET_SWITCH,
      }),
    ),
    { enabled: true, max_tokens: 12000 },
  );
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-sonnet-4-5", { thinkingSwitch: BUDGET_SWITCH }),
    ),
    { enabled: true, max_tokens: 12000 },
  );
  assert.deepEqual(
    buildOpenRouterAnthropicReasoningBody(
      config("anthropic/claude-opus-4-5", {
        vendorExtendedThinking: false,
        thinkingSwitch: BUDGET_SWITCH,
      }),
    ),
    { enabled: false },
  );
});

test("anthropic routes without a thinking declaration send nothing", () => {
  assert.equal(
    buildOpenRouterAnthropicReasoningBody(config("anthropic/claude-future-9")),
    undefined,
  );
});

function capturingFetch() {
  const bodies: JsonObject[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === "string") {
      bodies.push(JSON.parse(init.body) as JsonObject);
    }
    return new Response("{}", { status: 200 });
  };
  return { fetch: fetch as typeof globalThis.fetch, bodies };
}

test("the fetch replaces reasoning wholesale and strips reasoning_effort and thinking", async () => {
  const { fetch: base, bodies } = capturingFetch();
  const fetch = createOpenRouterAnthropicReasoningFetch(
    config("anthropic/claude-sonnet-4.6", {
      reasoningEffort: "high",
      thinkingSwitch: ADAPTIVE_SWITCH,
    }),
    base,
  );

  const merged: JsonObject = {
    model: "anthropic/claude-sonnet-4.6",
    reasoning_effort: "high",
    reasoning: { effort: "high", summary: "auto" },
    thinking: { type: "adaptive" },
    messages: [] as JsonValue[],
  };
  await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(merged),
  });

  assert.deepEqual(bodies[0], {
    model: "anthropic/claude-sonnet-4.6",
    reasoning: { enabled: true, effort: "high" },
    messages: [],
  });
});

test("the fetch passes through when the mechanism is undeclared or the body is not JSON", async () => {
  const { fetch: base, bodies } = capturingFetch();
  const undeclared = createOpenRouterAnthropicReasoningFetch(
    { model: "anthropic/claude-sonnet-4.6", thinkingSwitch: ADAPTIVE_SWITCH },
    base,
  );
  const body = JSON.stringify({ model: "m", reasoning_effort: "high" });
  await undeclared("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body });
  assert.deepEqual(bodies[0], { model: "m", reasoning_effort: "high" });

  // A no-op config returns the base fetch reference outright.
  const base2 = capturingFetch();
  assert.equal(
    createOpenRouterAnthropicReasoningFetch(config("openai/gpt-5"), base2.fetch),
    base2.fetch,
  );
});
