import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildOpenResponsesRequestTrace,
  openResponsesReasoningTrace,
  resolveAzureResourceName,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
} from "./responses-compat.js";
import { extractAzureResourceNameFromApiBase } from "../azure-resource.js";

test("resolveOpenResponsesLanguageModelId passes the declared model id through", () => {
  assert.equal(
    resolveOpenResponsesLanguageModelId({ model: "openai/gpt-5.4-mini" }),
    "openai/gpt-5.4-mini",
  );
  assert.equal(resolveOpenResponsesLanguageModelId({ model: "gpt-5.1" }), "gpt-5.1");
});

test("resolveAzureResourceName parses the baseUrl host segment", () => {
  assert.equal(
    resolveAzureResourceName({
      baseUrl: "https://my-openai-resource.openai.azure.com/openai/v1",
    }),
    "my-openai-resource",
  );
});

test("resolveAzureResourceName throws when the baseUrl carries no resource segment", () => {
  assert.throws(
    () => resolveAzureResourceName({ baseUrl: "https://api.openai.com/v1" }),
    /resource name cannot be parsed from apiBase/,
  );
});

test("extractAzureResourceNameFromApiBase rejects invalid resource segments", () => {
  assert.equal(
    extractAzureResourceNameFromApiBase("https://bad name.openai.azure.com/openai/v1"),
    undefined,
  );
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
      sdk: "@ai-sdk/huggingface",
      reasoningEffort: "high",
    }),
    undefined,
  );
  assert.equal(resolveOpenResponsesReasoningSummary({ reasoningEffort: "high" }), "auto");
});

test("resolveOpenResponsesReasoningSummary honors off and effort none", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      sdk: "@ai-sdk/openai",
      reasoningEffort: "none",
    }),
    undefined,
  );
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      sdk: "@ai-sdk/openai",
      reasoningSummary: "off",
    }),
    undefined,
  );
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      sdk: "@ai-sdk/openai",
      reasoningSummary: "detailed",
    }),
    "detailed",
  );
});

test("resolveOpenResponsesReasoningSummary omits SigV4 (Bedrock Mantle) endpoints", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      sdk: "@ai-sdk/openai",
      options: { auth: "aws-sigv4" },
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
