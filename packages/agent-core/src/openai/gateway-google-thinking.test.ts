import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildGatewayGoogleProviderOptions,
  buildGoogleThinkingConfigForEffort,
  gatewayGoogleGeminiSupportedEfforts,
  isGatewayGoogleGeminiModel,
  isGoogleGemini25ProModel,
  isGoogleGeminiMinimalThinkingLevelModel,
  isGoogleGeminiThinkingLevelModel,
} from "./gateway-google-thinking.js";

test("isGatewayGoogleGeminiModel matches vercel-ai-gateway google gemini routes only", () => {
  assert.equal(
    isGatewayGoogleGeminiModel("vercel-ai-gateway", "google/gemini-3.1-pro-preview"),
    true,
  );
  assert.equal(isGatewayGoogleGeminiModel("vercel-ai-gateway", "google/gemini-2.5-flash"), true);
  assert.equal(isGatewayGoogleGeminiModel("vercel-ai-gateway", "openai/gpt-5"), false);
  assert.equal(isGatewayGoogleGeminiModel("vercel-ai-gateway", "google/imagen-4"), false);
  assert.equal(isGatewayGoogleGeminiModel("google", "google/gemini-3.1-pro-preview"), false);
});

test("isGoogleGeminiThinkingLevelModel uses numeric version at or above gemini-3", () => {
  assert.equal(isGoogleGeminiThinkingLevelModel("google/gemini-2.5-flash"), false);
  assert.equal(isGoogleGeminiThinkingLevelModel("google/gemini-2.5-pro"), false);
  assert.equal(isGoogleGeminiThinkingLevelModel("gemini-3-flash-preview"), true);
  assert.equal(isGoogleGeminiThinkingLevelModel("google/gemini-3.1-pro-preview"), true);
  assert.equal(isGoogleGeminiThinkingLevelModel("gemini-3.7-flash-lite"), true);
  assert.equal(isGoogleGeminiThinkingLevelModel("google/gemini-4-argon"), true);
  assert.equal(isGoogleGeminiThinkingLevelModel("gemini-4.0-argon"), true);
});

test("isGoogleGeminiMinimalThinkingLevelModel matches flash routes except 3.7 and 3.8", () => {
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("google/gemini-3-flash-preview"), true);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("google/gemini-3.1-flash-lite"), true);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("google/gemini-3.1-pro-preview"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("gemini-3.7-flash"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("gemini-3.7-flash-lite"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("google/gemini-3.7-flash-batch"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("gemini-3.8-flash"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("gemini-3.8-flash-lite"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("google/gemini-3.8-flash-preview"), false);
  assert.equal(isGoogleGeminiMinimalThinkingLevelModel("gemini-4-flash"), true);
});

test("isGoogleGemini25ProModel matches 2.5 pro and not flash or flash-lite", () => {
  assert.equal(isGoogleGemini25ProModel("gemini-2.5-pro"), true);
  assert.equal(isGoogleGemini25ProModel("google/gemini-2.5-pro-preview"), true);
  assert.equal(isGoogleGemini25ProModel("gemini-2.5-flash"), false);
  assert.equal(isGoogleGemini25ProModel("google/gemini-2.5-flash-lite"), false);
  assert.equal(isGoogleGemini25ProModel("gemini-2.5-flash-preview"), false);
});

test("buildGoogleThinkingConfigForEffort maps Gemini 3 and 2.5 effort levels", () => {
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-3.1-pro-preview", "high"), {
    thinkingLevel: "high",
    includeThoughts: true,
  });
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-2.5-flash", "medium"), {
    thinkingBudget: 4096,
    includeThoughts: true,
  });
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-3-flash-preview", "minimal"), {
    thinkingLevel: "minimal",
  });
  assert.equal(
    buildGoogleThinkingConfigForEffort("google/gemini-3.1-pro-preview", "none"),
    undefined,
  );
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-3-flash-preview", "none"), {
    thinkingLevel: "minimal",
  });
  assert.equal(buildGoogleThinkingConfigForEffort("gemini-3.7-flash", "minimal"), undefined);
  assert.equal(buildGoogleThinkingConfigForEffort("gemini-3.7-flash-lite", "none"), undefined);
  assert.equal(
    buildGoogleThinkingConfigForEffort("google/gemini-3.8-flash-batch", "minimal"),
    undefined,
  );
  assert.equal(buildGoogleThinkingConfigForEffort("gemini-2.5-pro", "none"), undefined);
  assert.deepEqual(buildGoogleThinkingConfigForEffort("gemini-2.5-pro", "low"), {
    thinkingBudget: 1024,
    includeThoughts: true,
  });
  assert.deepEqual(buildGoogleThinkingConfigForEffort("gemini-2.5-flash", "none"), {
    thinkingBudget: 0,
  });
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-2.5-flash-lite", "none"), {
    thinkingBudget: 0,
  });
  assert.deepEqual(buildGoogleThinkingConfigForEffort("google/gemini-4-argon", "high"), {
    thinkingLevel: "high",
    includeThoughts: true,
  });
});

test("buildGatewayGoogleProviderOptions sends google thinkingConfig for gateway gemini", () => {
  assert.deepEqual(
    buildGatewayGoogleProviderOptions(
      {
        llmVendor: "vercel-ai-gateway",
        model: "google/gemini-3.1-pro-preview",
        reasoningEffort: "medium",
      },
      "medium",
    ),
    {
      google: {
        thinkingConfig: {
          thinkingLevel: "medium",
          includeThoughts: true,
        },
      },
    },
  );
});

test("gatewayGoogleGeminiSupportedEfforts exports effort vocabulary for catalog metadata", () => {
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-3.1-pro-preview"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-3-flash-preview"), [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-3.7-flash-lite"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-3.8-flash-batch"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-4-argon"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-2.5-pro"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-2.5-flash"), [
    "none",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(gatewayGoogleGeminiSupportedEfforts("google/gemini-2.5-flash-lite"), [
    "none",
    "low",
    "medium",
    "high",
  ]);
  assert.equal(gatewayGoogleGeminiSupportedEfforts("openai/gpt-5"), undefined);
});
