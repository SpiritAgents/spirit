import assert from "node:assert/strict";
import { test } from "vitest";

import {
  loadModelKnowledgeRecords,
  loadModelKnowledgeSource,
  lookupModelKnowledgeRecord,
  lookupModelKnowledgeSource,
  ModelKnowledgeLoadError,
  normalizeModelKnowledgeModelId,
  stripModelIdAggregatorPrefix,
} from "./loader.js";

test("stripModelIdAggregatorPrefix strips single-token route prefixes only", () => {
  assert.equal(stripModelIdAggregatorPrefix("openai/gpt-5.5"), "gpt-5.5");
  assert.equal(stripModelIdAggregatorPrefix("anthropic/claude-opus-5.5"), "claude-opus-5.5");
  assert.equal(stripModelIdAggregatorPrefix("gpt-5.5"), "gpt-5.5");
  assert.equal(
    stripModelIdAggregatorPrefix("anthropic.claude-opus-5-5-v1"),
    "anthropic.claude-opus-5-5-v1",
  );
  assert.equal(
    stripModelIdAggregatorPrefix("publishers/google/models/gemini-3.5-flash"),
    "publishers/google/models/gemini-3.5-flash",
  );
  assert.equal(stripModelIdAggregatorPrefix("/leading"), "/leading");
  assert.equal(stripModelIdAggregatorPrefix("  openai/gpt-5.5  "), "gpt-5.5");
});

test("family defaults cover unmatched members and merge before specific records", () => {
  const source = loadModelKnowledgeSource({
    match: "(?:gpt-|o)",
    defaults: { applyPatch: true },
    models: [{ match: "gpt-5.4", declare: { serviceTiers: ["default"] } }],
  });

  assert.deepEqual(lookupModelKnowledgeSource(source, "openai/gpt-5.4"), {
    applyPatch: true,
    serviceTiers: ["default"],
  });
  assert.deepEqual(lookupModelKnowledgeSource(source, "openai/o4-mini"), { applyPatch: true });
  assert.equal(lookupModelKnowledgeSource(source, "anthropic/claude-sonnet-4.5"), undefined);
});

test("family match and defaults must be declared together", () => {
  assert.throws(
    () => loadModelKnowledgeSource({ match: "gpt-", models: [] }, "kb.json"),
    /kb\.json.*must be paired/,
  );
  assert.throws(
    () => loadModelKnowledgeSource({ defaults: { applyPatch: true }, models: [] }, "kb.json"),
    /kb\.json.*must be paired/,
  );
});

test("normalizeModelKnowledgeModelId strips the prefix and folds case", () => {
  assert.equal(normalizeModelKnowledgeModelId("OpenAI/GPT-5.5"), "gpt-5.5");
  assert.equal(normalizeModelKnowledgeModelId("Claude-Opus-5.5"), "claude-opus-5.5");
});

test("loadModelKnowledgeRecords compiles records and preserves order", () => {
  const records = loadModelKnowledgeRecords({
    models: [
      { match: "claude-opus-5", declare: { supportsThinkingType: "only" } },
      { match: "gpt-\\d", declare: { supportedReasoningModes: ["standard", "pro"] } },
    ],
  });
  assert.equal(records.length, 2);
  assert.equal(records[0]?.match, "claude-opus-5");
  assert.deepEqual(records[1]?.declare, { supportedReasoningModes: ["standard", "pro"] });
});

test("loadModelKnowledgeRecords fails fast on malformed data and invalid regexes", () => {
  assert.throws(() => loadModelKnowledgeRecords(null), ModelKnowledgeLoadError);
  assert.throws(() => loadModelKnowledgeRecords({}), /"models" array/);
  assert.throws(() => loadModelKnowledgeRecords({ models: [[]] }), /must be an object/);
  assert.throws(
    () => loadModelKnowledgeRecords({ models: [{ declare: {} }] }),
    /models\[0\].*"match"/,
  );
  assert.throws(
    () => loadModelKnowledgeRecords({ models: [{ match: "x" }] }),
    /models\[0\].*"declare"/,
  );
  assert.throws(
    () => loadModelKnowledgeRecords({ models: [{ match: "([", declare: {} }] }, "kb.json"),
    /kb\.json models\[0\].*invalid "match" regex/,
  );
});

test("lookupModelKnowledgeRecord matches anchored at the start of the normalized id", () => {
  const records = loadModelKnowledgeRecords({
    models: [{ match: "claude-opus", declare: { tag: "opus" } }],
  });
  assert.deepEqual(lookupModelKnowledgeRecord(records, "anthropic/claude-opus-5.5"), {
    tag: "opus",
  });
  assert.deepEqual(lookupModelKnowledgeRecord(records, "Claude-Opus-5.5"), { tag: "opus" });
  assert.equal(lookupModelKnowledgeRecord(records, "openrouter/claude-sonnet"), undefined);

  const suffixPattern = loadModelKnowledgeRecords({
    models: [{ match: "opus", declare: { tag: "suffix" } }],
  });
  assert.equal(lookupModelKnowledgeRecord(suffixPattern, "anthropic/claude-opus-5.5"), undefined);
});

test("lookupModelKnowledgeRecord applies record order priority, first match wins", () => {
  const records = loadModelKnowledgeRecords({
    models: [
      { match: "claude-opus-5-5", declare: { tag: "specific" } },
      { match: "claude-opus", declare: { tag: "broad" } },
    ],
  });
  assert.deepEqual(lookupModelKnowledgeRecord(records, "claude-opus-5-5-v1"), { tag: "specific" });
  assert.deepEqual(lookupModelKnowledgeRecord(records, "claude-opus-4-8"), { tag: "broad" });
  assert.equal(lookupModelKnowledgeRecord(records, "gpt-5.5"), undefined);
});
