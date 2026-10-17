import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildOpenAiRequestTrace,
  isDeepSeekV4VisionModelId,
  openAiReasoningEffort,
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiTransportConfig,
} from "./openai-compat.js";

test("resolveOpenAiModelCompatibilityProfile trims only from declared capabilities", () => {
  const declared = resolveOpenAiModelCompatibilityProfile({
    model: "some-model",
    modelCapabilities: { languageModel: true },
  });
  assert.equal(declared.hasExplicitCapabilities, true);
  assert.deepEqual(declared.capabilities, { languageModel: true });

  // Undeclared capabilities: no arbitrary downgrade — messages are passed through untouched.
  const undeclared = resolveOpenAiModelCompatibilityProfile({ model: "some-model" });
  assert.equal(undeclared.hasExplicitCapabilities, false);
  assert.deepEqual(undeclared.capabilities, {});
});

test("isDeepSeekV4VisionModelId recognizes the experimental vision model id", () => {
  assert.equal(isDeepSeekV4VisionModelId("deepseek-v4-flash-vision-exp"), true);
  assert.equal(isDeepSeekV4VisionModelId("deepseek/deepseek-v4-flash-vision-exp"), true);
  assert.equal(isDeepSeekV4VisionModelId("deepseek-v4-flash"), false);
});

test("openAiReasoningEffort passes the declared tier verbatim and drops default", () => {
  assert.equal(openAiReasoningEffort({ reasoningEffort: "high" }), "high");
  assert.equal(openAiReasoningEffort({ reasoningEffort: "max" }), "max");
  assert.equal(openAiReasoningEffort({ reasoningEffort: "default" }), undefined);
  assert.equal(openAiReasoningEffort({}), undefined);
});

test("buildOpenAiRequestTrace records the declared effort and tier", () => {
  const config: OpenAiTransportConfig = {
    apiKey: "k",
    model: "m",
    reasoningEffort: "high",
    serviceTier: "fast",
  };
  const [trace] = buildOpenAiRequestTrace(config, 3, [{ role: "user", content: "hi" }], [], true);
  assert.ok(trace !== undefined && typeof trace === "object" && !Array.isArray(trace));
  const record = trace as Record<string, unknown>;
  assert.equal(record.kind, "openai_sdk_chat_completions");
  assert.equal(record.reasoning_effort, "high");
  assert.equal(record.serviceTier, "fast");
  assert.equal(record.stream, true);
  assert.equal(record.stepIndex, 3);
});

test("buildOpenAiRequestTrace omits reasoning fields when nothing is declared", () => {
  const [trace] = buildOpenAiRequestTrace({ apiKey: "k", model: "m" }, 1, [], []);
  const record = trace as Record<string, unknown>;
  assert.equal("reasoning_effort" in record, false);
  assert.equal("serviceTier" in record, false);
  assert.equal("tools" in record, false);
});
