import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ModelServiceTierConfigError,
  defaultModelServiceTier,
  isAnthropicNativeFastModel,
  isVertexGlobalServiceTierEndpoint,
  modelServiceTierOptions,
  modelServiceTierTriggerLabel,
  modelServiceTierControlKind,
  modelShowsServiceTierControl,
  modelSupportsAnthropicNativeFast,
  normalizeModelServiceTier,
  normalizeServiceTierUpstreamProvider,
  parseModelServiceTierConfig,
  resolveEffectiveModelServiceTier,
  resolveServiceTierUpstreamProvider,
  type ModelServiceTier,
} from "./model-service-tier.js";

function optionValues(context?: Parameters<typeof modelServiceTierOptions>[0]): ModelServiceTier[] {
  return (modelServiceTierOptions(context) ?? []).map((option) => option.value);
}

test("openai exposes auto/default/flex/fast and no priority", () => {
  assert.deepEqual(optionValues({ provider: "openai", model: "gpt-6" }), [
    "auto",
    "default",
    "flex",
    "fast",
  ]);
  assert.equal(defaultModelServiceTier({ provider: "openai" }), "auto");
});

test("xai exposes default/priority and no fast (fast/priority stay distinct)", () => {
  assert.deepEqual(optionValues({ provider: "xai", model: "grok-4" }), ["default", "priority"]);
  assert.equal(defaultModelServiceTier({ provider: "xai" }), "default");
  assert.throws(
    () => parseModelServiceTierConfig("fast", { provider: "xai", model: "grok-4" }),
    ModelServiceTierConfigError,
  );
  assert.throws(
    () => parseModelServiceTierConfig("priority", { provider: "openai", model: "gpt-6" }),
    ModelServiceTierConfigError,
  );
});

test("google ai studio exposes default/flex/priority", () => {
  assert.deepEqual(optionValues({ provider: "google", model: "gemini-3.1-pro" }), [
    "default",
    "flex",
    "priority",
  ]);
});

test("vertex gates flex/priority to the global endpoint", () => {
  assert.deepEqual(
    optionValues({
      provider: "google-vertex-ai",
      model: "gemini-3.1-pro",
      vertexLocation: "global",
    }),
    ["default", "flex", "priority"],
  );
  assert.deepEqual(
    optionValues({
      provider: "google-vertex-ai",
      model: "gemini-3.1-pro",
      vertexLocation: "us-central1",
    }),
    [],
  );
  assert.equal(isVertexGlobalServiceTierEndpoint(" Global "), true);
  assert.equal(isVertexGlobalServiceTierEndpoint("us-central1"), false);
  assert.throws(
    () =>
      parseModelServiceTierConfig("flex", {
        provider: "google-vertex-ai",
        model: "gemini-3.1-pro",
        vertexLocation: "us-central1",
      }),
    ModelServiceTierConfigError,
  );
});

test("anthropic direct exposes no dropdown; native fast only for claude opus 4.8 / 5 / 5.5", () => {
  assert.deepEqual(optionValues({ provider: "anthropic", model: "claude-opus-4-8" }), []);
  assert.equal(
    modelShowsServiceTierControl({ provider: "anthropic", model: "claude-opus-4-8" }),
    true,
  );
  assert.equal(
    modelShowsServiceTierControl({ provider: "anthropic", model: "claude-sonnet-4-6" }),
    false,
  );

  assert.equal(isAnthropicNativeFastModel("claude-opus-4-8"), true);
  assert.equal(isAnthropicNativeFastModel("claude-opus-4-8-20260201"), true);
  assert.equal(isAnthropicNativeFastModel("claude-opus-5"), true);
  assert.equal(isAnthropicNativeFastModel("claude-opus-5-5"), true);
  assert.equal(isAnthropicNativeFastModel("Claude-Opus-4.8"), true);
  assert.equal(isAnthropicNativeFastModel("claude-opus-4-7"), false);
  assert.equal(isAnthropicNativeFastModel("claude-opus-4-1"), false);
  assert.equal(isAnthropicNativeFastModel("claude-sonnet-5"), false);
  assert.equal(isAnthropicNativeFastModel("claude-opus-4-80"), false);

  assert.equal(
    parseModelServiceTierConfig("fast", { provider: "anthropic", model: "claude-opus-5-5" }),
    "fast",
  );
  assert.throws(
    () =>
      parseModelServiceTierConfig("fast", { provider: "anthropic", model: "claude-sonnet-4-6" }),
    ModelServiceTierConfigError,
  );
  assert.throws(
    () => parseModelServiceTierConfig("flex", { provider: "anthropic", model: "claude-opus-4-8" }),
    ModelServiceTierConfigError,
  );
  // Aggregator-routed Claude never gets the native Fast toggle.
  assert.equal(
    modelSupportsAnthropicNativeFast({
      provider: "openrouter",
      model: "anthropic/claude-opus-4-8",
    }),
    false,
  );
  assert.equal(
    modelSupportsAnthropicNativeFast({ provider: "anthropic", model: "claude-opus-4-8" }),
    true,
  );
  assert.equal(
    modelShowsServiceTierControl({
      provider: "openrouter",
      model: "anthropic/claude-opus-4-8",
      upstreamProvider: "anthropic",
    }),
    true, // Default/Priority switch, not the native toggle
  );
  assert.equal(
    parseModelServiceTierConfig("priority", {
      provider: "openrouter",
      model: "anthropic/claude-opus-4-8",
      upstreamProvider: "anthropic",
    }),
    "priority",
  );
  // Aggregator-routed Claude has no Fast alias: the canonical fast value is rejected.
  assert.throws(
    () =>
      parseModelServiceTierConfig("fast", {
        provider: "openrouter",
        model: "anthropic/claude-opus-4-8",
        upstreamProvider: "anthropic",
      }),
    ModelServiceTierConfigError,
  );
});

test("ultrafast requires gpt-6-astra behind an openai-capable route", () => {
  assert.deepEqual(optionValues({ provider: "openai", model: "gpt-6-astra" }), [
    "auto",
    "default",
    "flex",
    "fast",
    "ultrafast",
  ]);
  // Aggregator prefixes are normalized before the astra check.
  assert.deepEqual(optionValues({ provider: "openrouter", model: "openai/gpt-6-astra-max" }), [
    "default",
    "flex",
    "fast",
    "ultrafast",
  ]);
  assert.deepEqual(
    optionValues({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-6-astra",
      upstreamProvider: "openai",
    }),
    ["default", "flex", "fast", "ultrafast"],
  );
  // Non-astra GPT models and non-openai upstreams never see ultrafast.
  assert.ok(!optionValues({ provider: "openai", model: "gpt-6" }).includes("ultrafast"));
  assert.ok(
    !optionValues({ provider: "openrouter", model: "google/gemini-3.1-pro" }).includes("ultrafast"),
  );
  assert.throws(
    () => parseModelServiceTierConfig("ultrafast", { provider: "openai", model: "gpt-6" }),
    ModelServiceTierConfigError,
  );
});

test("vercel options depend on upstream identity", () => {
  assert.deepEqual(
    optionValues({ provider: "vercel-ai-gateway", model: "anthropic/claude-opus-5" }),
    [],
  );
  assert.deepEqual(
    optionValues({ provider: "vercel-ai-gateway", model: "google/gemini-3.1-pro" }),
    ["default", "flex", "priority"],
  );
  assert.deepEqual(optionValues({ provider: "vercel-ai-gateway", model: "xai/grok-4" }), [
    "default",
    "priority",
  ]);
  // Vercel routes current SpaceXAI models under the spacexai prefix / owned_by fact.
  assert.deepEqual(optionValues({ provider: "vercel-ai-gateway", model: "spacexai/grok-4.7" }), [
    "default",
    "priority",
  ]);
  assert.deepEqual(
    optionValues({
      provider: "vercel-ai-gateway",
      model: "spacexai/grok-4.7",
      upstreamProvider: "SpaceXAI",
    }),
    ["default", "priority"],
  );
});

test("openrouter options depend on upstream identity", () => {
  assert.deepEqual(optionValues({ provider: "openrouter", model: "anthropic/claude-opus-5" }), [
    "default",
    "priority",
  ]);
  assert.deepEqual(optionValues({ provider: "openrouter", model: "x-ai/grok-4" }), [
    "default",
    "priority",
  ]);
  assert.deepEqual(optionValues({ provider: "openrouter", model: "google/gemini-3.1-pro" }), [
    "default",
    "flex",
    "priority",
  ]);
  assert.deepEqual(optionValues({ provider: "openrouter", model: "meta/llama-4" }), []);
});

test("catalog identity wins over a conflicting model id prefix", () => {
  // Catalog says anthropic while the id looks openai-routed: the catalog fact is authoritative.
  assert.equal(
    resolveServiceTierUpstreamProvider({ upstreamProvider: "Anthropic", model: "openai/gpt-6" }),
    "anthropic",
  );
  // A present but unrecognized catalog fact means known-unsupported: no prefix fallback.
  assert.equal(
    resolveServiceTierUpstreamProvider({ upstreamProvider: "Meta", model: "openai/gpt-6" }),
    undefined,
  );
  // Prefix parsing only fills in when the catalog fact is missing.
  assert.equal(resolveServiceTierUpstreamProvider({ model: "x-ai/grok-4" }), "xai");
  assert.equal(resolveServiceTierUpstreamProvider({ model: "spacexai/grok-4.7" }), "xai");
  assert.equal(normalizeServiceTierUpstreamProvider(" xAI "), "xai");
  assert.equal(normalizeServiceTierUpstreamProvider("SpaceXAI"), "xai");
});

test("unsupported providers hide the control and reject stored values", () => {
  for (const provider of ["azure", "amazon-bedrock", "custom", "deepseek"] as const) {
    assert.deepEqual(optionValues({ provider, model: "whatever" }), []);
    assert.equal(modelShowsServiceTierControl({ provider, model: "whatever" }), false);
    assert.throws(
      () => parseModelServiceTierConfig("flex", { provider, model: "whatever" }),
      ModelServiceTierConfigError,
    );
  }
});

test("parse accepts unset and valid values, rejects unknown strings", () => {
  assert.equal(parseModelServiceTierConfig(undefined, { provider: "openai" }), undefined);
  assert.equal(parseModelServiceTierConfig(null, { provider: "openai" }), undefined);
  assert.equal(parseModelServiceTierConfig("flex", { provider: "openai" }), "flex");
  assert.equal(normalizeModelServiceTier(" FAST "), "fast");
  assert.equal(normalizeModelServiceTier("turbo"), undefined);
  assert.throws(
    () => parseModelServiceTierConfig("turbo", { provider: "openai" }),
    ModelServiceTierConfigError,
  );
  assert.throws(
    () => parseModelServiceTierConfig(42, { provider: "openai" }),
    ModelServiceTierConfigError,
  );
});

test("effective tier: openai auto vs explicit default stay distinct", () => {
  assert.equal(
    resolveEffectiveModelServiceTier(undefined, { provider: "openai", model: "gpt-6" }),
    "auto",
  );
  assert.equal(
    resolveEffectiveModelServiceTier("default", { provider: "openai", model: "gpt-6" }),
    "default",
  );
  assert.equal(
    resolveEffectiveModelServiceTier(undefined, { provider: "xai", model: "grok-4" }),
    "default",
  );
  // Anthropic fast resolves off when unset, on only when stored as fast.
  assert.equal(
    resolveEffectiveModelServiceTier(undefined, {
      provider: "anthropic",
      model: "claude-opus-4-8",
    }),
    undefined,
  );
  assert.equal(
    resolveEffectiveModelServiceTier("fast", { provider: "anthropic", model: "claude-opus-4-8" }),
    "fast",
  );
  // Hidden controls resolve to nothing.
  assert.equal(
    resolveEffectiveModelServiceTier("fast", { provider: "azure", model: "gpt-6" }),
    undefined,
  );
});

test("control kind: switches for binary rows, dropdown for wider matrices", () => {
  assert.equal(
    modelServiceTierControlKind({ provider: "anthropic", model: "claude-opus-4-8" }),
    "fast-switch",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "anthropic", model: "claude-sonnet-4-6" }),
    "none",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "xai", model: "grok-4" }),
    "priority-switch",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "vercel-ai-gateway", model: "spacexai/grok-4.7" }),
    "priority-switch",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "openrouter", model: "x-ai/grok-4" }),
    "priority-switch",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "openrouter", model: "anthropic/claude-opus-5" }),
    "priority-switch",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "google", model: "gemini-3.1-pro" }),
    "select",
  );
  assert.equal(
    modelServiceTierControlKind({ provider: "vercel-ai-gateway", model: "google/gemini-3.1-pro" }),
    "select",
  );
  assert.equal(
    modelServiceTierControlKind({
      provider: "google-vertex-ai",
      model: "gemini-3.1-pro",
      vertexLocation: "us-central1",
    }),
    "none",
  );
  assert.equal(modelServiceTierControlKind({ provider: "openai", model: "gpt-6" }), "select");
});

test("trigger labels mark fast, ultrafast, flex, and priority", () => {
  assert.equal(modelServiceTierTriggerLabel("fast"), "Fast");
  assert.equal(modelServiceTierTriggerLabel("ultrafast"), "Ultrafast");
  assert.equal(modelServiceTierTriggerLabel("flex"), "Flex");
  assert.equal(modelServiceTierTriggerLabel("priority"), "Priority");
  assert.equal(modelServiceTierTriggerLabel("auto"), undefined);
  assert.equal(modelServiceTierTriggerLabel("default"), undefined);
  assert.equal(modelServiceTierTriggerLabel(undefined), undefined);
});
