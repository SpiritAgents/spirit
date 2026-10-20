import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildGatewayV3ProviderOptions,
  gatewayUpstreamRouteSlug,
} from "./gateway-v3-provider-options.js";

test("gatewayUpstreamRouteSlug parses the public routing slug", () => {
  assert.equal(gatewayUpstreamRouteSlug("anthropic/claude-opus-5.5"), "anthropic");
  assert.equal(gatewayUpstreamRouteSlug("OpenAI/gpt-5.6"), "openai");
  assert.equal(gatewayUpstreamRouteSlug("gpt-5.6"), undefined);
  assert.equal(gatewayUpstreamRouteSlug("/orphan"), undefined);
});

test("openai-routed models take the Responses reasoning payload in the openai namespace", () => {
  const options = buildGatewayV3ProviderOptions({
    model: "openai/gpt-5.6",
    reasoningEffort: "high",
  });
  assert.deepEqual(options, {
    openai: { reasoningEffort: "high", reasoningSummary: "auto" },
  });
});

test("unknown routes fall back to the openai namespace with the default summary", () => {
  assert.deepEqual(buildGatewayV3ProviderOptions({ model: "meta/llama-4-scout" }), {
    openai: { reasoningSummary: "auto" },
  });
  assert.deepEqual(buildGatewayV3ProviderOptions({ model: "gpt-5.6" }), {
    openai: { reasoningSummary: "auto" },
  });
});

test("anthropic routes carry toolStreaming and the protocol effort enum only", () => {
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "anthropic/claude-opus-5.5", reasoningEffort: "xhigh" }),
    { anthropic: { toolStreaming: true, effort: "xhigh" } },
  );
  // none/minimal are not Anthropic effort tokens (the code-completion profile pins none).
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "anthropic/claude-opus-5.5", reasoningEffort: "none" }),
    { anthropic: { toolStreaming: true } },
  );
  assert.deepEqual(buildGatewayV3ProviderOptions({ model: "anthropic/claude-opus-5.5" }), {
    anthropic: { toolStreaming: true },
  });
});

test("anthropic routes merge the declared thinking providerOptions patch", () => {
  const thinkingSwitch = {
    on: {
      body: { thinking: { type: "adaptive", display: "summarized" } },
      providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
    },
    off: {
      body: { thinking: { type: "disabled" } },
      providerOptions: { anthropic: { thinking: { type: "disabled" } } },
    },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "anthropic/claude-opus-5.5",
      reasoningEffort: "high",
      thinkingSwitch,
    }),
    {
      anthropic: {
        toolStreaming: true,
        effort: "high",
        thinking: { type: "adaptive", display: "summarized" },
      },
    },
  );
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "anthropic/claude-opus-5.5",
      thinkingSwitch,
      vendorExtendedThinking: false,
    }),
    { anthropic: { toolStreaming: true, thinking: { type: "disabled" } } },
  );
});

test("the legacy claude budget patch uses the AI SDK budgetTokens shape", () => {
  const thinkingSwitch = {
    on: {
      body: { thinking: { type: "enabled", budget_tokens: 12000 } },
      providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
    },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "anthropic/claude-opus-4.5", thinkingSwitch }),
    { anthropic: { toolStreaming: true, thinking: { type: "enabled", budgetTokens: 12000 } } },
  );
});

test("google routes map the declared effort to the era's thinkingConfig", () => {
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "google/gemini-3.5-flash", reasoningEffort: "low" }),
    { google: { thinkingConfig: { thinkingLevel: "low", includeThoughts: true } } },
  );
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "google/gemini-2.5-flash", reasoningEffort: "none" }),
    { google: { thinkingConfig: { thinkingBudget: 0 } } },
  );
});

test("deepseek routes carry the effort and the declared thinking patch in the deepseek namespace", () => {
  const thinkingSwitch = {
    on: {
      body: { thinking: { type: "enabled" } },
      providerOptions: { deepseek: { thinking: { type: "enabled" } } },
    },
    off: {
      body: { thinking: { type: "disabled" } },
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
    },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "deepseek/deepseek-v4-pro",
      reasoningEffort: "max",
      thinkingSwitch,
    }),
    { deepseek: { reasoningEffort: "max", thinking: { type: "enabled" } } },
  );
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "deepseek/deepseek-v4-pro",
      thinkingSwitch,
      vendorExtendedThinking: false,
    }),
    { deepseek: { thinking: { type: "disabled" } } },
  );
});

test("xai routes filter the effort to the xAI adapter enum", () => {
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "xai/grok-4.3", reasoningEffort: "high" }),
    { xai: { reasoningEffort: "high" } },
  );
  assert.deepEqual(
    buildGatewayV3ProviderOptions({ model: "xai/grok-4.3", reasoningEffort: "minimal" }),
    {},
  );
});

test("zai / moonshotai routes keep the effort in the openai namespace and think in their own", () => {
  const zaiThinkingSwitch = {
    on: {
      body: { thinking: { type: "enabled" } },
      providerOptions: { zai: { thinking: { type: "enabled" } } },
    },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "zai/glm-5.2",
      reasoningEffort: "high",
      thinkingSwitch: zaiThinkingSwitch,
    }),
    {
      zai: { thinking: { type: "enabled" } },
      openai: { reasoningEffort: "high", reasoningSummary: "auto" },
    },
  );

  const kimiThinkingSwitch = {
    off: {
      body: { thinking: { type: "disabled" } },
      providerOptions: { moonshotai: { thinking: { type: "disabled" } } },
    },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "moonshotai/kimi-k2.6",
      thinkingSwitch: kimiThinkingSwitch,
      vendorExtendedThinking: false,
    }),
    {
      moonshotai: { thinking: { type: "disabled" } },
      openai: { reasoningSummary: "auto" },
    },
  );
});

test("minimax routes emit only the declared adaptive/disabled thinking patch", () => {
  const thinkingSwitch = {
    on: {
      body: { thinking: { type: "adaptive" } },
      providerOptions: { minimax: { thinking: { type: "adaptive" } } },
    },
    off: {
      body: { thinking: { type: "disabled" } },
      providerOptions: { minimax: { thinking: { type: "disabled" } } },
    },
  };
  assert.deepEqual(buildGatewayV3ProviderOptions({ model: "minimax/minimax-m3", thinkingSwitch }), {
    minimax: { thinking: { type: "adaptive" } },
    openai: { reasoningSummary: "auto" },
  });
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "minimax/minimax-m3",
      thinkingSwitch,
      vendorExtendedThinking: false,
    }),
    {
      minimax: { thinking: { type: "disabled" } },
      openai: { reasoningSummary: "auto" },
    },
  );
});

test("a thinkingSwitch without a providerOptions form sends no thinking on the gateway", () => {
  // Xiaomi MiMo: the chat-body encoding exists, but the gateway route is effort-controlled, so
  // the record declares no providerOptions form and nothing is emitted.
  const thinkingSwitch = {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  };
  assert.deepEqual(
    buildGatewayV3ProviderOptions({
      model: "xiaomi/mimo-v2.5",
      reasoningEffort: "high",
      thinkingSwitch,
      vendorExtendedThinking: false,
    }),
    { openai: { reasoningEffort: "high", reasoningSummary: "auto" } },
  );
});

test("no declarations and no effort still yield the default summary for non-special routes", () => {
  assert.deepEqual(buildGatewayV3ProviderOptions({ model: "openai/gpt-5.4" }), {
    openai: { reasoningSummary: "auto" },
  });
});
