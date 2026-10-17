import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildOpenResponsesRequestTrace,
  isGatewayOpenAiRoutedModel,
  normalizeGatewayOpenAiModelId,
  openResponsesReasoningTrace,
  resolveAzureResourceName,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
} from "./responses-compat.js";
import { extractAzureResourceNameFromApiBase } from "../azure-resource.js";

test("normalizeGatewayOpenAiModelId", () => {
  assert.equal(normalizeGatewayOpenAiModelId("openai/gpt-5.1"), "gpt-5.1");
  assert.equal(normalizeGatewayOpenAiModelId("anthropic/claude-sonnet-4"), undefined);
});

test("resolveOpenResponsesSdkProvider keys on the declared sdk package name", () => {
  assert.equal(resolveOpenResponsesSdkProvider({ sdk: "@ai-sdk/openai" }), "openai");
  assert.equal(resolveOpenResponsesSdkProvider({ sdk: "@ai-sdk/xai" }), "xai");
  assert.equal(resolveOpenResponsesSdkProvider({ sdk: "@ai-sdk/azure" }), "azure");
});

test("resolveOpenResponsesSdkProvider defaults to the generic open-responses adapter", () => {
  assert.equal(resolveOpenResponsesSdkProvider({}), "open-responses-compatible");
  // Gateway-routed OpenAI models must NOT use `@ai-sdk/openai` (which strips the `openai/` prefix
  // and suppresses gateway reasoning streaming); the preset declares @ai-sdk/gateway.
  assert.equal(
    resolveOpenResponsesSdkProvider({ sdk: "@ai-sdk/gateway" }),
    "open-responses-compatible",
  );
  assert.equal(
    resolveOpenResponsesSdkProvider({ sdk: "@ai-sdk/open-responses" }),
    "open-responses-compatible",
  );
});

test("resolveOpenResponsesLanguageModelId passes the declared model id through", () => {
  assert.equal(
    resolveOpenResponsesLanguageModelId({ model: "openai/gpt-5.4-mini" }),
    "openai/gpt-5.4-mini",
  );
  assert.equal(resolveOpenResponsesLanguageModelId({ model: "gpt-5.1" }), "gpt-5.1");
});

test("resolveAzureResourceName prefers explicit azureResourceName", () => {
  assert.equal(
    resolveAzureResourceName({
      azureResourceName: "my-resource",
      baseUrl: "https://other-resource.openai.azure.com/openai/v1",
    }),
    "my-resource",
  );
});

test("resolveAzureResourceName falls back to baseUrl host segment", () => {
  assert.equal(
    resolveAzureResourceName({
      baseUrl: "https://my-openai-resource.openai.azure.com/openai/v1",
    }),
    "my-openai-resource",
  );
});

test("resolveAzureResourceName throws when neither field is usable", () => {
  assert.throws(
    () => resolveAzureResourceName({ baseUrl: "https://api.openai.com/v1" }),
    /azureResourceName configuration is missing/,
  );
});

test("extractAzureResourceNameFromApiBase rejects invalid resource segments", () => {
  assert.equal(
    extractAzureResourceNameFromApiBase("https://bad name.openai.azure.com/openai/v1"),
    undefined,
  );
});

test("isGatewayOpenAiRoutedModel", () => {
  assert.equal(isGatewayOpenAiRoutedModel("openai/gpt-5.1"), true);
  assert.equal(isGatewayOpenAiRoutedModel("gpt-5.1"), false);
});

test("openResponsesReasoningTrace passes declared effort and pro mode verbatim", () => {
  assert.deepEqual(
    openResponsesReasoningTrace({
      model: "gpt-5.6-sol",
      sdk: "@ai-sdk/openai",
      reasoningEffort: "max",
      reasoningMode: "pro",
    }),
    { effort: "max", mode: "pro", summary: "auto" },
  );
});

test("openResponsesReasoningTrace omits mode for standard and downgrades nothing", () => {
  assert.deepEqual(
    openResponsesReasoningTrace({
      model: "gpt-5.5",
      sdk: "@ai-sdk/openai",
      reasoningEffort: "max",
      reasoningMode: "standard",
    }),
    { effort: "max", summary: "auto" },
  );
});

test("openResponsesReasoningTrace sends nothing when nothing is declared and the adapter drops summaries", () => {
  assert.equal(
    openResponsesReasoningTrace({ model: "some-model", sdk: "@ai-sdk/huggingface" }),
    undefined,
  );
});

test("openResponsesReasoningTrace defaults the reasoning summary to auto on eligible adapters", () => {
  assert.deepEqual(openResponsesReasoningTrace({ model: "gpt-5.5", sdk: "@ai-sdk/openai" }), {
    summary: "auto",
  });
});

test("resolveOpenResponsesReasoningSummary is sdk-keyed: ineligible adapters send nothing", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "some-model",
      sdk: "@ai-sdk/huggingface",
      reasoningEffort: "high",
    }),
    undefined,
  );
  assert.equal(
    resolveOpenResponsesReasoningSummary({ model: "some-model", reasoningEffort: "high" }),
    "auto",
  );
});

test("resolveOpenResponsesReasoningSummary honors off and effort none", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "gpt-5.5",
      sdk: "@ai-sdk/openai",
      reasoningEffort: "none",
    }),
    undefined,
  );
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "gpt-5.5",
      sdk: "@ai-sdk/openai",
      reasoningSummary: "off",
    }),
    undefined,
  );
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "gpt-5.5",
      sdk: "@ai-sdk/openai",
      reasoningSummary: "detailed",
    }),
    "detailed",
  );
});

test("resolveOpenResponsesReasoningSummary omits Bedrock Mantle endpoints", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "openai.gpt-5.5",
      sdk: "@ai-sdk/openai",
      baseUrl: "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
      reasoningEffort: "high",
    }),
    undefined,
  );
});

test("buildOpenResponsesRequestTrace keys the trace kind on the declared sdk", () => {
  const base = {
    transportKind: "open-responses",
    apiKey: "k",
    model: "m",
  } as const;
  const kind = (sdk?: string) =>
    (
      buildOpenResponsesRequestTrace(
        { ...base, ...(sdk !== undefined ? { sdk } : {}) },
        1,
        [],
        [],
      )[0] as { kind?: string }
    ).kind;
  assert.equal(kind("@ai-sdk/openai"), "openai_sdk_responses");
  assert.equal(kind("@ai-sdk/xai"), "xai_sdk_responses");
  assert.equal(kind("@ai-sdk/azure"), "azure_sdk_responses");
  assert.equal(kind(), "open_responses_sdk_responses");
  assert.equal(kind("@ai-sdk/open-responses"), "open_responses_sdk_responses");
});
