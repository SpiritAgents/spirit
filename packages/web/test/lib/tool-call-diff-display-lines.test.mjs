import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveToolCallDisplayLines } from "../../src/lib/tool-call-diff-display-lines.ts";

const line = (content, kind = "normal") => ({ kind, content });

test("resolveToolCallDisplayLines uses lines synchronously when followTail is false", () => {
  const lines = [line("a"), line("b", "insert")];
  const debounced = [line("stale")];
  assert.deepEqual(resolveToolCallDisplayLines(lines, debounced, false), lines);
});

test("resolveToolCallDisplayLines shows lines immediately on empty-to-content transition", () => {
  const lines = [line("new", "insert")];
  assert.deepEqual(resolveToolCallDisplayLines(lines, [], true), lines);
});

test("resolveToolCallDisplayLines uses debounced lines during followTail streaming", () => {
  const lines = [line("a"), line("b", "insert")];
  const debounced = [line("a")];
  assert.deepEqual(resolveToolCallDisplayLines(lines, debounced, true), debounced);
});

test("resolveToolCallDisplayLines returns empty when lines cleared", () => {
  assert.deepEqual(resolveToolCallDisplayLines([], [line("old")], true), []);
});
