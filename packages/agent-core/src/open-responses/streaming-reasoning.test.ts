import assert from "node:assert/strict";
import { test } from "vitest";

import { extractOpenResponsesReasoningTextFromRawChunk } from "./streaming.js";
import { resolveOpenResponsesReasoningSummary } from "./responses-compat.js";

test("resolveOpenResponsesReasoningSummary defaults to auto", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      reasoningEffort: "medium",
    }),
    "auto",
  );
});

test("resolveOpenResponsesReasoningSummary respects none effort", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      reasoningEffort: "none",
      reasoningSummary: "auto",
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary disables summary for the SigV4 surface", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      options: { auth: "aws-sigv4" },
      reasoningEffort: "medium",
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary is suppressed for adapters whose wire drops it", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
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
