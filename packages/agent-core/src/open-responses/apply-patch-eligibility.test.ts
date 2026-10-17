import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildApplyPatchFileToolsPromptSection,
  normalizeGatewayOpenAiModelId,
  shouldUseApplyPatchFileTools,
  shouldUseApplyPatchFunctionTool,
  shouldUseBuiltInApplyPatchRequestItems,
  shouldOmitApplyPatchFromAiSdkMessages,
  shouldUseOpenAiSdkApplyPatchTool,
} from "./apply-patch-eligibility.js";

test("normalizeGatewayOpenAiModelId", () => {
  assert.equal(normalizeGatewayOpenAiModelId("openai/gpt-5.1"), "gpt-5.1");
  assert.equal(normalizeGatewayOpenAiModelId("openai/gpt-5.4"), "gpt-5.4");
  assert.equal(normalizeGatewayOpenAiModelId("anthropic/claude-sonnet-4"), undefined);
  assert.equal(normalizeGatewayOpenAiModelId("gpt-5.1"), undefined);
});

test("apply_patch file tools require the options.applyPatch declaration on open-responses", () => {
  const declared = {
    transportKind: "open-responses",
    model: "gpt-5.1",
    options: { applyPatch: true },
  } as const;
  assert.equal(shouldUseApplyPatchFileTools(declared), true);

  // Absent declaration = the endpoint does not expose apply_patch.
  assert.equal(
    shouldUseApplyPatchFileTools({ transportKind: "open-responses", model: "gpt-5.1" }),
    false,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: "open-responses",
      model: "gpt-5.1",
      options: { applyPatch: false },
    }),
    false,
  );
  // Other transports never expose it.
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: "openai-compatible",
      model: "gpt-5.1",
      options: { applyPatch: true },
    } as never),
    false,
  );
});

test("apply_patch is hidden in ask mode even when declared", () => {
  const config = {
    transportKind: "open-responses",
    model: "gpt-5.1",
    options: { applyPatch: true },
    agentMode: "ask",
  } as const;
  assert.equal(shouldUseApplyPatchFileTools(config), false);
  assert.equal(
    shouldUseApplyPatchFileTools(
      { transportKind: "open-responses", model: "gpt-5.1", options: { applyPatch: true } },
      { agentMode: "ask" },
    ),
    false,
  );
});

test("the @ai-sdk/openai adapter uses the official SDK apply_patch tool", () => {
  const config = {
    transportKind: "open-responses",
    model: "gpt-5.1",
    sdk: "@ai-sdk/openai",
    options: { applyPatch: true },
  } as const;
  assert.equal(shouldUseOpenAiSdkApplyPatchTool(config), true);
  assert.equal(shouldUseApplyPatchFunctionTool(config), false);
  assert.equal(shouldUseBuiltInApplyPatchRequestItems(config), false);
});

test("the gateway adapter registers the flat function tool", () => {
  const config = {
    transportKind: "open-responses",
    model: "openai/gpt-5.4",
    sdk: "@ai-sdk/gateway",
    options: { applyPatch: true },
  } as const;
  assert.equal(shouldUseApplyPatchFunctionTool(config), true);
  assert.equal(shouldUseOpenAiSdkApplyPatchTool(config), false);
  assert.equal(shouldUseBuiltInApplyPatchRequestItems(config), false);
});

test("Bedrock Mantle takes the function-tool path on the OpenAI adapter", () => {
  const mantleConfig = {
    transportKind: "open-responses" as const,
    sdk: "@ai-sdk/openai" as const,
    model: "openai.gpt-5.5",
    baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
    options: { applyPatch: true },
  };

  assert.equal(shouldUseApplyPatchFileTools(mantleConfig), true);
  assert.equal(shouldUseOpenAiSdkApplyPatchTool(mantleConfig), false);
  assert.equal(shouldUseApplyPatchFunctionTool(mantleConfig), true);
  assert.equal(shouldUseBuiltInApplyPatchRequestItems(mantleConfig), false);
});

test("the generic open-responses adapter patches built-in request items", () => {
  const config = {
    transportKind: "open-responses",
    model: "openai/gpt-5.4",
    options: { applyPatch: true },
  } as const;
  assert.equal(shouldUseBuiltInApplyPatchRequestItems(config), true);
  assert.equal(shouldUseOpenAiSdkApplyPatchTool(config), false);
  assert.equal(shouldUseApplyPatchFunctionTool(config), false);
  assert.equal(shouldOmitApplyPatchFromAiSdkMessages(config), true);
});

test("buildApplyPatchFileToolsPromptSection mentions apply_patch and V4A", () => {
  const section = buildApplyPatchFileToolsPromptSection();
  assert.match(section, /apply_patch/);
  assert.match(section, /V4A/);
});
