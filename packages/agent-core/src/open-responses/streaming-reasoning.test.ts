import assert from "node:assert/strict";
import { test } from "vitest";

import { extractOpenResponsesReasoningTextFromRawChunk } from "./streaming.js";
import { resolveOpenResponsesReasoningSummary } from "./responses-compat.js";

test("resolveOpenResponsesReasoningSummary defaults to auto when declared", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      reasoningEffort: "medium",
      options: { reasoningSummary: true },
    }),
    "auto",
  );
});

test("resolveOpenResponsesReasoningSummary respects none effort", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      reasoningEffort: "none",
      reasoningSummary: "auto",
      options: { reasoningSummary: true },
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary disables summary for the SigV4 surface", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      options: { auth: "aws-sigv4", reasoningSummary: true },
      reasoningEffort: "medium",
    }),
    undefined,
  );
});

test("resolveOpenResponsesReasoningSummary is suppressed without the declaration", () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
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
