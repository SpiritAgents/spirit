import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isOpenAiGpt56OrLaterModel,
  isOpenAiGpt6AstraModel,
  modelSupportsOpenAiGpt56ReasoningControls,
  openAiGpt56SupportedReasoningEfforts,
  resolveModelReasoningMode,
} from "./gpt-reasoning-controls.js";
import {
  modelReasoningEffortOptions,
  modelSupportsReasoningModeControl,
  resolveModelReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
} from "../reasoning-effort.js";

test("isOpenAiGpt56OrLaterModel boundaries", () => {
  assert.equal(isOpenAiGpt56OrLaterModel("gpt-5.6-sol"), true);
  assert.equal(isOpenAiGpt56OrLaterModel("openai/gpt-5.6-terra"), true);
  assert.equal(isOpenAiGpt56OrLaterModel("gpt-6"), true);
  assert.equal(isOpenAiGpt56OrLaterModel("gpt-5.5"), false);
  assert.equal(isOpenAiGpt56OrLaterModel("gpt-5.4"), false);
});

test("gpt-5.6 models expose max effort and preserve max in transport resolution", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "openai/gpt-5.6-sol",
    transportKind: "open-responses" as const,
  };

  assert.equal(resolveOpenAiTransportReasoningEffortForContext("max", context), "max");
  assert.equal(
    resolveModelReasoningEffortForContext("max", {
      provider: "openai",
      model: "gpt-5.5",
      transportKind: "openai-compatible",
    }),
    "xhigh",
  );

  const options = modelReasoningEffortOptions(context);
  assert.ok(options.some((option) => option.value === "max"));
  assert.ok(!options.some((option) => option.value === "minimal"));
});

test("resolveModelReasoningMode defaults to standard and only applies on gpt-5.6+", () => {
  assert.equal(
    resolveModelReasoningMode(undefined, {
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.6-luna",
    }),
    "standard",
  );
  assert.equal(
    resolveModelReasoningMode("pro", {
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.6-luna",
    }),
    "pro",
  );
  assert.equal(
    resolveModelReasoningMode("pro", {
      provider: "openai",
      model: "gpt-5.5",
    }),
    "standard",
  );
});

test("gpt-6-astra excludes none effort across routed openai model ids", () => {
  assert.equal(isOpenAiGpt6AstraModel("gpt-6-astra"), true);
  assert.equal(isOpenAiGpt6AstraModel("openai/gpt-6-astra"), true);
  assert.equal(isOpenAiGpt6AstraModel("gpt-6"), false);
  assert.equal(isOpenAiGpt6AstraModel("openai/gpt-5.6-sol"), false);
  assert.deepEqual(openAiGpt56SupportedReasoningEfforts("openai/gpt-6-astra"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.ok(openAiGpt56SupportedReasoningEfforts("gpt-5.6-sol").includes("none"));

  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "openai/gpt-6-astra",
    transportKind: "open-responses" as const,
  };

  assert.ok(!modelReasoningEffortOptions(context).some((option) => option.value === "none"));
  assert.ok(
    !modelReasoningEffortOptions({
      provider: "openai",
      model: "gpt-6-astra",
      transportKind: "open-responses",
    }).some((option) => option.value === "none"),
  );
  assert.ok(
    !modelReasoningEffortOptions({
      ...context,
      supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    }).some((option) => option.value === "none"),
  );
  assert.equal(resolveModelReasoningEffortForContext("none", context), "default");
  assert.equal(resolveOpenAiTransportReasoningEffortForContext("none", context), undefined);
});

test("modelSupportsReasoningModeControl matches gpt-5.6 routed openai models", () => {
  assert.equal(
    modelSupportsReasoningModeControl({
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5.6-sol",
    }),
    true,
  );
  assert.equal(
    modelSupportsOpenAiGpt56ReasoningControls({
      provider: "anthropic",
      model: "gpt-5.6-sol",
    }),
    false,
  );
});
