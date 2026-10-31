import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MODEL_REASONING_EFFORT_TOKENS,
  normalizeModelReasoningEffort,
  normalizeModelReasoningMode,
  resolveDeclaredReasoningEffort,
  resolveDeclaredReasoningMode,
} from "./reasoning-effort.js";

test("MODEL_REASONING_EFFORT_TOKENS is the public effort vocabulary", () => {
  assert.deepEqual(
    [...MODEL_REASONING_EFFORT_TOKENS],
    ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"],
  );
});

test("normalizeModelReasoningEffort accepts the public tokens case-insensitively", () => {
  assert.equal(normalizeModelReasoningEffort("high"), "high");
  assert.equal(normalizeModelReasoningEffort(" MAX "), "max");
  assert.equal(normalizeModelReasoningEffort("ludicrous"), undefined);
  assert.equal(normalizeModelReasoningEffort(42), undefined);
  assert.equal(normalizeModelReasoningEffort(undefined), undefined);
});

test("normalizeModelReasoningMode knows only standard and pro", () => {
  assert.equal(normalizeModelReasoningMode("standard"), "standard");
  assert.equal(normalizeModelReasoningMode("PRO"), "pro");
  assert.equal(normalizeModelReasoningMode("fast"), undefined);
  assert.equal(normalizeModelReasoningMode(undefined), undefined);
});

test("resolveDeclaredReasoningEffort passes declared tiers verbatim and drops default", () => {
  assert.equal(resolveDeclaredReasoningEffort("minimal"), "minimal");
  assert.equal(resolveDeclaredReasoningEffort("xhigh"), "xhigh");
  assert.equal(resolveDeclaredReasoningEffort("max"), "max");
  assert.equal(resolveDeclaredReasoningEffort("default"), undefined);
  assert.equal(resolveDeclaredReasoningEffort(undefined), undefined);
});

test("resolveDeclaredReasoningMode sends only pro on the wire", () => {
  assert.equal(resolveDeclaredReasoningMode("pro"), "pro");
  assert.equal(resolveDeclaredReasoningMode("standard"), undefined);
  assert.equal(resolveDeclaredReasoningMode(undefined), undefined);
});
