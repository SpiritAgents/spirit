import assert from "node:assert/strict";
import { test } from "vitest";

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  attachEditFileLineDelta,
  deleteFileLineDeltaFromContent,
  preserveDeleteFileBaseline,
  preserveDeleteFileLineDelta,
  editFileLineDeltaFromArgumentsJson,
  lineChangeCounts,
  resolveToolLineDeltaForDisplay,
  toolLineDeltaFromArgumentsJson,
  toolLineDeltaFromRequest,
  tryExtractPartialJsonStringValue,
  tryExtractPartialPlanName,
} from "../../src/lib/edit-file-line-delta.ts";

test("lineChangeCounts uses line-level LCS", () => {
  assert.deepEqual(lineChangeCounts("a\nb", "a\nc\nd"), { removed: 1, added: 2 });
  assert.deepEqual(lineChangeCounts("same", "same"), { removed: 0, added: 0 });
});

test("tryExtractPartialPlanName reads in-flight plan name", () => {
  const partial = '{"name":"my-plan","content":"# ';
  assert.equal(tryExtractPartialPlanName(partial), "my-plan");
});

test("tryExtractPartialJsonStringValue reads in-flight old_text", () => {
  const partial = '{"path":"x.ts","old_text":"line one\\nline two","new_text":"line';
  assert.equal(tryExtractPartialJsonStringValue(partial, "old_text"), "line one\nline two");
  assert.equal(tryExtractPartialJsonStringValue(partial, "new_text"), "line");
});

test("editFileLineDeltaFromArgumentsJson updates while new_text streams", () => {
  const partial = '{"path":"m.ts","old_text":"a\\nb","new_text":"a\\nc\\n';
  const delta = editFileLineDeltaFromArgumentsJson(partial);
  assert.deepEqual(delta, { removed: 1, added: 2 });
});

test("preview skips LCS for large edits; final pass still computes", () => {
  const oldText = Array.from({ length: 300 }, (_, i) => `old ${i}`).join("\n");
  const newText = Array.from({ length: 300 }, (_, i) => `new ${i}`).join("\n");
  const json = JSON.stringify({ path: "x.ts", old_text: oldText, new_text: newText });
  assert.equal(toolLineDeltaFromArgumentsJson("edit_file", json, { preview: true }), undefined);
  assert.deepEqual(toolLineDeltaFromArgumentsJson("edit_file", json), {
    removed: 300,
    added: 300,
  });
});

test("preview keeps LCS for small edits", () => {
  const json = JSON.stringify({ path: "x.ts", old_text: "a\nb", new_text: "a\nc\nd" });
  assert.deepEqual(toolLineDeltaFromArgumentsJson("edit_file", json, { preview: true }), {
    removed: 1,
    added: 2,
  });
});

test("editFileLineDeltaFromArgumentsJson parses complete JSON", () => {
  const json = JSON.stringify({
    path: "m.ts",
    old_text: "x",
    new_text: "x\ny",
  });
  assert.deepEqual(editFileLineDeltaFromArgumentsJson(json), { removed: 0, added: 1 });
});

test("create_file line delta counts new content lines", () => {
  assert.deepEqual(toolLineDeltaFromRequest("create_file", { path: "a.ts", content: "one\ntwo" }), {
    added: 2,
    removed: 0,
  });
});

test("create_plan partial content streams in", () => {
  const partial = '{"name":"plan","content":"line one';
  assert.deepEqual(toolLineDeltaFromArgumentsJson("create_plan", partial), {
    added: 1,
    removed: 0,
  });
});

test("deleteFileLineDeltaFromContent counts removed lines only", () => {
  assert.deepEqual(deleteFileLineDeltaFromContent("one\ntwo\n"), { added: 0, removed: 3 });
  assert.equal(deleteFileLineDeltaFromContent(""), undefined);
});

test("delete file line delta matches on-disk utf8 content", () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "spirit-delete-delta-"));
  const filePath = path.join(workspaceRoot, "hello.txt");
  writeFileSync(filePath, "alpha\nbeta", "utf8");
  const content = readFileSync(filePath, "utf8");
  assert.deepEqual(deleteFileLineDeltaFromContent(content), { added: 0, removed: 2 });
});

test("toolLineDeltaFromRequest ignores delete_file without disk read", () => {
  assert.equal(toolLineDeltaFromRequest("delete_file", { path: "x.ts" }), undefined);
});

test("preserveDeleteFileLineDelta keeps prior removed count after file is gone", () => {
  const prior = { added: 0, removed: 11 };
  const attached = {
    toolName: "delete_file",
    phase: "succeeded",
    headline: "Delete hello.txt",
    detailLines: [],
  };
  assert.deepEqual(
    preserveDeleteFileLineDelta("delete_file", attached, prior).editLineDelta,
    prior,
  );
  assert.equal(
    preserveDeleteFileLineDelta("create_file", attached, prior).editLineDelta,
    undefined,
  );
});

test("resolveToolLineDeltaForDisplay hides delta when tool phase is failed", () => {
  const argsExcerpt = JSON.stringify({ path: "a.ts", content: "line one\nline two\nline three" });
  assert.deepEqual(
    resolveToolLineDeltaForDisplay({
      toolName: "create_file",
      phase: "failed",
      headline: "Create",
      detailLines: [],
      argsExcerpt,
    }),
    undefined,
  );
  assert.deepEqual(
    resolveToolLineDeltaForDisplay({
      toolName: "create_file",
      phase: "succeeded",
      headline: "Create",
      detailLines: [],
      argsExcerpt,
    }),
    { removed: 0, added: 3 },
  );
});

test("preserveDeleteFileBaseline keeps prior text after delete succeeds", () => {
  const priorText = "line one\nline two";
  const attached = {
    toolName: "delete_file",
    phase: "succeeded",
    headline: "Delete hello.txt",
    detailLines: [],
  };
  assert.equal(
    preserveDeleteFileBaseline("delete_file", attached, priorText).deleteFileBaselineText,
    priorText,
  );
  assert.equal(
    preserveDeleteFileBaseline("create_file", attached, priorText).deleteFileBaselineText,
    undefined,
  );
});

test("toolLineDeltaFromRequest counts apply_patch marker lines", () => {
  const request = {
    name: "apply_patch",
    operation: {
      type: "update_file",
      path: "m.ts",
      diff: "@@ \n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n*** End Patch",
    },
  };
  assert.deepEqual(toolLineDeltaFromRequest("apply_patch", request), { added: 2, removed: 1 });
  assert.deepEqual(
    toolLineDeltaFromRequest("apply_patch", {
      name: "apply_patch",
      operation: { type: "delete_file", path: "x" },
    }),
    undefined,
  );
});

test("toolLineDeltaFromArgumentsJson reads a streaming apply_patch diff", () => {
  const delta = toolLineDeltaFromArgumentsJson(
    "apply_patch",
    '{"operation":{"type":"update_file","path":"m.ts","diff":"+a\\n+b',
  );
  assert.deepEqual(delta, { added: 2, removed: 0 });
});

test("attachEditFileLineDelta prefers the executor fileChangeDiff pair for apply_patch", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Edited",
    detailLines: [],
    fileChangeDiff: { path: "m.ts", before: "a\nb\nc", after: "a\nB\nc\nd" },
  };
  const attached = attachEditFileLineDelta(tool, {
    request: {
      name: "apply_patch",
      operation: { type: "update_file", path: "m.ts", diff: "-b\n+B" },
    },
  });
  // The pair's LCS stat wins over the patch's marker counts (2 added, 1 removed here).
  assert.deepEqual(attached.editLineDelta, { added: 2, removed: 1 });
});
