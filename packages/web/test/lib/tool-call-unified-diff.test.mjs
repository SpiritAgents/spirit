import assert from "node:assert/strict";
import { test } from "vitest";

import { buildToolCallDiffLines } from "../../src/lib/diff-display-lines.ts";

test("buildToolCallDiffLines marks new file lines as insertions", () => {
  const lines = buildToolCallDiffLines("", "line1\nline2\n");
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, content: line.content })),
    [
      { kind: "insert", content: "line1" },
      { kind: "insert", content: "line2" },
    ],
  );
});

test("buildToolCallDiffLines marks delete file lines as deletions", () => {
  const lines = buildToolCallDiffLines("alpha\nbeta\n", "");
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, content: line.content })),
    [
      { kind: "delete", content: "alpha" },
      { kind: "delete", content: "beta" },
    ],
  );
});

test("buildToolCallDiffLines shows edit replacements", () => {
  const lines = buildToolCallDiffLines("a\nb\n", "a\nc\n");
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, content: line.content })),
    [
      { kind: "normal", content: "a" },
      { kind: "delete", content: "b" },
      { kind: "insert", content: "c" },
    ],
  );
});

test("buildToolCallDiffLines assigns line numbers for edits", () => {
  const lines = buildToolCallDiffLines("old\n", "new\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.kind, "delete");
  assert.equal(lines[0]?.oldLineNumber, 1);
  assert.equal(lines[1]?.kind, "insert");
  assert.equal(lines[1]?.newLineNumber, 1);
});
