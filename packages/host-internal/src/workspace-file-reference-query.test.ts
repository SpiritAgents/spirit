import { test } from "vitest";
import assert from "node:assert/strict";

import { mergeRecentIntoSuggestions } from "./workspace-file-reference-query.js";

test("merge keeps recent hits on top in MRU order ahead of better-scoring index hits", () => {
  const index = ["src/core/util.ts", "src/core/dialog.ts"];
  const recent = ["src/a-util.ts", "src/util.ts"];

  const merged = mergeRecentIntoSuggestions("@util", index, recent);

  assert.deepEqual(merged, ["src/a-util.ts", "src/util.ts", "src/core/util.ts"]);
});

test("merge drops recent entries that do not match the query", () => {
  const index = ["src/ui/dialog.ts"];
  const recent = ["docs/guide.md", "src/ui/dialog.ts"];

  const merged = mergeRecentIntoSuggestions("@dialog", index, recent);

  assert.deepEqual(merged, ["src/ui/dialog.ts"]);
});

test("merge with an empty query lists recent entries first and falls back to index order", () => {
  const index = ["src/", "src/a.ts", "src/b.ts"];
  const recent = ["src/z.ts", "src/"];

  const merged = mergeRecentIntoSuggestions("@", index, recent);

  assert.deepEqual(merged, ["src/z.ts", "src/", "src/a.ts", "src/b.ts"]);
});

test("merge dedupes recent and index paths case-insensitively and across directory markers", () => {
  const index = ["src/ui/", "src/ui/dialog.ts"];
  const recent = ["Src/UI/", "src/ui/DIALOG.ts"];

  const merged = mergeRecentIntoSuggestions("@ui", index, recent);

  assert.deepEqual(merged, ["Src/UI/", "src/ui/DIALOG.ts"]);
});

test("merge matches recent entries on basename of absolute paths", () => {
  const index: string[] = [];
  const recent = ["/etc/hosts", "/var/log/system.log"];

  const merged = mergeRecentIntoSuggestions("@hosts", index, recent);

  assert.deepEqual(merged, ["/etc/hosts"]);
});

test("merge sorts non-recent hits by match quality regardless of input order", () => {
  const index = ["src/deep/nested/util-helper.ts", "src/util.ts"];
  const recent: string[] = [];

  const merged = mergeRecentIntoSuggestions("@util", index, recent);

  assert.deepEqual(merged, ["src/util.ts", "src/deep/nested/util-helper.ts"]);
});

test("merge respects the limit option across recent and index hits", () => {
  const index = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const recent = ["src/z.ts", "src/y.ts"];

  const merged = mergeRecentIntoSuggestions("@", index, recent, { limit: 3 });

  assert.deepEqual(merged, ["src/z.ts", "src/y.ts", "src/a.ts"]);
});
