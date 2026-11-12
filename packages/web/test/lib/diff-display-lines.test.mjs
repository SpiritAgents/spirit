import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildDiffLinesFromUnifiedText,
  buildToolCallDiffLines,
  wrapPatchAsUnifiedDiff,
} from "../../src/lib/diff-display-lines.ts";

test("buildToolCallDiffLines marks new file lines as insertions", () => {
  const lines = buildToolCallDiffLines("", "line1\nline2\n");
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, content: line.content })),
    [
      { kind: "insert", content: "line1" },
      { kind: "insert", content: "line2" },
    ],
  );
  assert.equal(lines[0]?.newLineNumber, 1);
  assert.equal(lines[1]?.newLineNumber, 2);
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

const SAMPLE_PATCH = `@@ -10,6 +10,7 @@
 import foo
+import bar
 context
-deleted
+added
 trailing`;

test("buildDiffLinesFromUnifiedText parses GitHub patch hunks", () => {
  const diffText = wrapPatchAsUnifiedDiff("src/foo.ts", SAMPLE_PATCH);
  const lines = buildDiffLinesFromUnifiedText(diffText);
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, content: line.content })),
    [
      { kind: "normal", content: "import foo" },
      { kind: "insert", content: "import bar" },
      { kind: "normal", content: "context" },
      { kind: "delete", content: "deleted" },
      { kind: "insert", content: "added" },
      { kind: "normal", content: "trailing" },
    ],
  );
  assert.equal(lines[1]?.newLineNumber, 11);
});
