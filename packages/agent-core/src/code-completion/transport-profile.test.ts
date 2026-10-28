import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyCodeCompletionTransportProfile,
  isCodeCompletionTransportProfile,
} from "./transport-profile.js";
import type { AnthropicTransportConfig } from "../anthropic/anthropic-compat.js";
import type { BedrockTransportConfig } from "../bedrock/bedrock-compat.js";
import { buildBedrockProviderOptions } from "../bedrock/bedrock-compat.js";
import type { OpenAiTransportConfig } from "../openai/openai-compat.js";
import type { OpenResponsesTransportConfig } from "../open-responses/responses-compat.js";
import { resolveAnthropicThinkingConfig } from "../anthropic/anthropic-compat.js";

test("isCodeCompletionTransportProfile matches code-completion only", () => {
  assert.equal(
    isCodeCompletionTransportProfile({ transportRequestProfile: "code-completion" }),
    true,
  );
  assert.equal(isCodeCompletionTransportProfile({ transportRequestProfile: "agent" }), false);
  assert.equal(isCodeCompletionTransportProfile({}), false);
});

test("openai-compatible chat: default adapter pins reasoning effort to the wire none token", () => {
  const input: OpenAiTransportConfig = {
    apiKey: "k",
    model: "gpt-5",
    reasoningEffort: "high",
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, "code-completion");
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, "none");
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, undefined);
});

test("openai-compatible chat: Gemini adapters pin none (mapped to thinkingBudget 0 on the wire)", () => {
  for (const sdk of ["@ai-sdk/google", "@ai-sdk/google-vertex"] as const) {
    const input: OpenAiTransportConfig = {
      apiKey: "k",
      model: "gemini-2.5-flash",
      sdk,
      reasoningEffort: "high",
    };
    const result = applyCodeCompletionTransportProfile(input);
    assert.equal((result as OpenAiTransportConfig).reasoningEffort, "none");
  }
});

test("openai-compatible chat: adapters without a none token omit the reasoning parameter", () => {
  const input: OpenAiTransportConfig = {
    apiKey: "k",
    model: "deepseek-v4-flash",
    sdk: "@ai-sdk/deepseek",
    reasoningEffort: "high",
    supportsThinkingSwitch: true,
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, "default");
  // The declared thinking-switch capability turns thinking off for the completion path.
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, false);
});

test("thinking is left alone when the model never declared a thinking switch", () => {
  const input: OpenAiTransportConfig = {
    apiKey: "k",
    model: "Qwen/Qwen3-8B",
    sdk: "@ai-sdk/openai-compatible",
    reasoningEffort: "medium",
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, undefined);
});

test("a thinkingSwitch block alone also marks the model as switchable for the completion path", () => {
  const input: OpenAiTransportConfig = {
    apiKey: "k",
    model: "LongCat-2.0",
    sdk: "@ai-sdk/openai-compatible",
    thinkingSwitch: {
      on: { body: { thinking: { type: "enabled" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, false);
});

test("open-responses: OpenAI-family adapters pin none and silence the reasoning summary", () => {
  for (const sdk of [
    "@ai-sdk/openai",
    "@ai-sdk/azure",
    "@ai-sdk/xai",
    "@ai-sdk/gateway",
  ] as const) {
    const input: OpenResponsesTransportConfig = {
      transportKind: "open-responses",
      apiKey: "k",
      model: "gpt-5",
      sdk,
      reasoningEffort: "high",
      reasoningSummary: "detailed",
    };
    const result = applyCodeCompletionTransportProfile(input);
    assert.equal(result.transportRequestProfile, "code-completion");
    assert.equal((result as OpenResponsesTransportConfig).reasoningEffort, "none");
    assert.equal((result as OpenResponsesTransportConfig).reasoningSummary, "off");
  }
});

test("open-responses: generic adapter omits the reasoning parameter instead of pinning none", () => {
  const input: OpenResponsesTransportConfig = {
    transportKind: "open-responses",
    apiKey: "k",
    model: "some-model",
    reasoningEffort: "high",
    reasoningSummary: "detailed",
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenResponsesTransportConfig).reasoningEffort, "default");
  assert.equal((result as OpenResponsesTransportConfig).reasoningSummary, "off");
});

test("anthropic: the profile marks the config and the transport encodes thinking disabled", () => {
  const input: AnthropicTransportConfig = {
    transportKind: "anthropic",
    apiKey: "k",
    model: "claude-sonnet-4-6",
    effort: "high",
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, "code-completion");
  assert.deepEqual(resolveAnthropicThinkingConfig(result as AnthropicTransportConfig), {
    type: "disabled",
  });
});

test("anthropic: a declared thinking switch routes the off state through the declaration", () => {
  const input: AnthropicTransportConfig = {
    transportKind: "anthropic",
    apiKey: "k",
    model: "MiniMax-M3",
    sdk: "@ai-sdk/minimax",
    supportsThinkingSwitch: true,
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as AnthropicTransportConfig).vendorExtendedThinking, false);
  assert.deepEqual(resolveAnthropicThinkingConfig(result as AnthropicTransportConfig), {
    type: "disabled",
  });
});

test("bedrock: reasoning effort none maps to no reasoningConfig", () => {
  const input: BedrockTransportConfig = {
    transportKind: "bedrock",
    model: "anthropic.claude-sonnet-4-6",
    region: "us-east-1",
    reasoningEffort: "high",
  };
  const result = applyCodeCompletionTransportProfile(input) as BedrockTransportConfig;
  assert.equal(result.transportRequestProfile, "code-completion");
  assert.equal(result.reasoningEffort, "none");
  assert.deepEqual(buildBedrockProviderOptions(result), {});
});

test("bedrock: a declared thinking switch turns thinking off explicitly on the completion path", () => {
  const input: BedrockTransportConfig = {
    transportKind: "bedrock",
    model: "anthropic.claude-sonnet-4-6",
    region: "us-east-1",
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  };
  const result = applyCodeCompletionTransportProfile(input) as BedrockTransportConfig;
  assert.equal(result.vendorExtendedThinking, false);
  assert.deepEqual(buildBedrockProviderOptions(result), {
    bedrock: { reasoningConfig: { type: "disabled" } },
  });
});

test("applyCodeCompletionTransportProfile tags anthropic, open-responses, and bedrock transports", () => {
  const anthropic: AnthropicTransportConfig = {
    transportKind: "anthropic",
    apiKey: "k",
    model: "claude-sonnet-4-6",
  };
  const openResponses: OpenResponsesTransportConfig = {
    transportKind: "open-responses",
    apiKey: "k",
    model: "gpt-5",
    sdk: "@ai-sdk/xai",
  };
  const bedrock: BedrockTransportConfig = {
    transportKind: "bedrock",
    model: "anthropic.claude-sonnet-4-6",
    region: "us-east-1",
  };

  assert.equal(
    applyCodeCompletionTransportProfile(anthropic).transportRequestProfile,
    "code-completion",
  );
  assert.equal(
    applyCodeCompletionTransportProfile(openResponses).transportRequestProfile,
    "code-completion",
  );
  assert.equal(
    applyCodeCompletionTransportProfile(bedrock).transportRequestProfile,
    "code-completion",
  );
});
