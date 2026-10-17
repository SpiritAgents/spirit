import assert from "node:assert/strict";
import { test } from "vitest";

import { extractOpenResponsesReasoningTextFromRawChunk } from "./streaming.js";
import { resolveOpenResponsesReasoningSummary } from "./responses-compat.js";

test("resolveOpenResponsesReasoningSummary defaults to auto", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "gpt-5",
      reasoningEffort: "medium",
    }),
    "auto",
  );
});

test("resolveOpenResponsesReasoningSummary respects none effort", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "gpt-5",
      reasoningEffort: "none",
      reasoningSummary: "auto",
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary disables summary for Bedrock Mantle", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      reasoningEffort: "medium",
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary is suppressed for adapters whose wire drops it", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: "some-model",
      sdk: "@ai-sdk/huggingface",
      reasoningEffort: "medium",
      reasoningSummary: "auto",
    }),
    undefined,
  );
});

test("extractOpenResponsesReasoningTextFromRawChunk reads summary delta", () => {
  assert.equal(
    extractOpenResponsesReasoningTextFromRawChunk({
      type: "response.reasoning_summary_text.delta",
      delta: "Planning next step.",
    }),
    "Planning next step.",
  );
});

test("extractOpenResponsesReasoningTextFromRawChunk reads reasoning_text delta", () => {
  assert.equal(
    extractOpenResponsesReasoningTextFromRawChunk({
      type: "response.reasoning_text.delta",
      delta: "Inspecting files first.",
    }),
    "Inspecting files first.",
  );
});
