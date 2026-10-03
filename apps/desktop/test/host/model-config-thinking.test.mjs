import assert from "node:assert/strict";
import { test } from "vitest";

import { buildPrimaryTransportConfig } from "../../dist-electron/src/host/model-config.js";

test("buildPrimaryTransportConfig wires DeepSeek V4 thinking on with high effort", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "deepseek",
      transportKind: "openai-compatible",
      reasoningEffort: "high",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "high");
});

test("buildPrimaryTransportConfig disables DeepSeek V4 thinking and strips effort", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "deepseek",
      transportKind: "openai-compatible",
      reasoningEffort: "high",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, undefined);
});

test("buildPrimaryTransportConfig wires Z.ai effort when thinking enabled", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "glm-4.7",
    baseUrl: "https://api.z.ai/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "z-ai",
      transportKind: "openai-compatible",
      reasoningEffort: "medium",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "medium");
});

test("buildPrimaryTransportConfig disables Alibaba thinking when thinkingEnabled false", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "alibaba",
      transportKind: "openai-compatible",
      reasoningEffort: "default",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.vendorExtendedThinking, false);
});

test("buildPrimaryTransportConfig wires Gateway Claude budget thinking off via vendorExtendedThinking", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-5",
    baseUrl: "https://gateway.ai.vercel.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "medium",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, undefined);
});

test("buildPrimaryTransportConfig wires Gateway Claude adaptive thinking off via vendorExtendedThinking", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    baseUrl: "https://gateway.ai.vercel.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "high",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, "high");
});

test("buildPrimaryTransportConfig wires Gateway Claude adaptive thinking on with effort", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    baseUrl: "https://gateway.ai.vercel.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "high",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "high");
});

test("buildPrimaryTransportConfig wires Gateway Xiaomi responses reasoningEffort none", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "xiaomi/mimo-v2.5",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "none",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "none");
});

test("buildPrimaryTransportConfig maps legacy Gateway Xiaomi thinkingEnabled false to reasoningEffort none", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "xiaomi/mimo-v2.5",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "default",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "none");
});

test("buildPrimaryTransportConfig maps legacy Gateway Xiaomi thinkingEnabled false with high effort to none", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "xiaomi/mimo-v2.5",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "high",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "none");
});

test("buildPrimaryTransportConfig wires direct Xiaomi responses reasoningEffort none", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "mimo-v2.5-pro",
    baseUrl: "https://api.xiaomimimo.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "xiaomi",
      transportKind: "open-responses",
      reasoningEffort: "none",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, "none");
});

test("buildPrimaryTransportConfig keeps direct Xiaomi chat thinking switch", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "mimo-v2.5",
    baseUrl: "https://api.xiaomimimo.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "xiaomi",
      transportKind: "openai-compatible",
      thinkingEnabled: false,
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, undefined);
});

test("buildPrimaryTransportConfig wires gpt-5.6 pro max reasoning mode", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "openai/gpt-5.6-sol",
    baseUrl: "https://gateway.ai.vercel.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
      reasoningEffort: "max",
      reasoningMode: "pro",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.reasoningEffort, "max");
  assert.equal(config.reasoningMode, "pro");
});

test("buildPrimaryTransportConfig omits reasoning mode for gpt-5.6 standard", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "gpt-5.6-sol",
    baseUrl: "https://api.openai.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "openai",
      transportKind: "open-responses",
      reasoningEffort: "medium",
      reasoningMode: "standard",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.reasoningEffort, "medium");
  assert.equal(config.reasoningMode, undefined);
});
