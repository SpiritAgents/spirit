import assert from "node:assert/strict";
import { test } from "vitest";

import {
  bedrockReasoningConfigFromEffort,
  bedrockSupportsReasoningConfig,
  buildBedrockProviderOptions,
} from "./bedrock-compat.js";

test("bedrockSupportsReasoningConfig whitelists Anthropic, Nova, and DeepSeek R1", () => {
  assert.equal(bedrockSupportsReasoningConfig("anthropic.claude-3-5-sonnet-20241022-v2:0"), true);
  assert.equal(bedrockSupportsReasoningConfig("us.amazon.nova-premier-v1:0"), true);
  assert.equal(bedrockSupportsReasoningConfig("deepseek.r1-v1:0"), true);
  assert.equal(bedrockSupportsReasoningConfig("meta.llama3-70b-instruct-v1:0"), false);
  assert.equal(bedrockSupportsReasoningConfig("openai.gpt-oss-120b"), false);
});

test("bedrockReasoningConfigFromEffort skips budgetTokens for non-whitelisted models", () => {
  assert.equal(
    bedrockReasoningConfigFromEffort("meta.llama3-70b-instruct-v1:0", "medium"),
    undefined,
  );
  assert.deepEqual(
    bedrockReasoningConfigFromEffort("anthropic.claude-3-5-sonnet-20241022-v2:0", "medium"),
    { type: "enabled", budgetTokens: 4_096 },
  );
});

test("buildBedrockProviderOptions encodes the thinking off state as disabled reasoningConfig", () => {
  assert.deepEqual(
    buildBedrockProviderOptions({
      model: "us.anthropic.claude-sonnet-4-6",
      vendorExtendedThinking: false,
    }),
    { bedrock: { reasoningConfig: { type: "disabled" } } },
  );
  // Off wins over any effort-derived config.
  assert.deepEqual(
    buildBedrockProviderOptions({
      model: "deepseek.r1-v1:0",
      reasoningEffort: "high",
      vendorExtendedThinking: false,
    }),
    { bedrock: { reasoningConfig: { type: "disabled" } } },
  );
  // Models outside the reasoningConfig whitelist take no reasoning parameter at all.
  assert.deepEqual(
    buildBedrockProviderOptions({
      model: "meta.llama3-70b-instruct-v1:0",
      vendorExtendedThinking: false,
    }),
    {},
  );
});

test("buildBedrockProviderOptions keeps the effort-derived config when thinking is on", () => {
  assert.deepEqual(
    buildBedrockProviderOptions({
      model: "us.amazon.nova-premier-v1:0",
      reasoningEffort: "max",
    }),
    { bedrock: { reasoningConfig: { type: "enabled", maxReasoningEffort: "high" } } },
  );
  assert.deepEqual(
    buildBedrockProviderOptions({ model: "anthropic.claude-3-5-sonnet-20241022-v2:0" }),
    {},
  );
});
