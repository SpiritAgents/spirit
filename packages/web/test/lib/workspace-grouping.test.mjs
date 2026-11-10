import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isSpiritWorktreeWorkspaceRoot,
  resolveSessionWorkLocation,
  resolveWorkspaceGroupingRoot,
} from "../../src/lib/workspace-grouping.ts";

test("resolveWorkspaceGroupingRoot maps linked worktrees to primary repo", () => {
  assert.equal(
    resolveWorkspaceGroupingRoot("D:\\Spirit.worktrees\\spirit-hello-test"),
    "D:/Spirit",
  );
  assert.equal(
    resolveWorkspaceGroupingRoot("/Users/dev/Spirit.worktrees/spirit-a"),
    "/Users/dev/Spirit",
  );
});

test("resolveWorkspaceGroupingRoot returns local repo path unchanged", () => {
  assert.equal(resolveWorkspaceGroupingRoot("D:\\Spirit"), "D:/Spirit");
  assert.equal(resolveWorkspaceGroupingRoot("/Users/dev/Spirit/"), "/Users/dev/Spirit");
});

test("isSpiritWorktreeWorkspaceRoot detects spirit worktree paths", () => {
  assert.equal(isSpiritWorktreeWorkspaceRoot("D:\\Spirit.worktrees\\spirit-a"), true);
  assert.equal(isSpiritWorktreeWorkspaceRoot("d:/spirit.worktrees/spirit-a"), true);
  assert.equal(isSpiritWorktreeWorkspaceRoot("/Users/dev/Spirit.worktrees/spirit-a/"), true);
});

test("isSpiritWorktreeWorkspaceRoot rejects primary repo and unrelated paths", () => {
  assert.equal(isSpiritWorktreeWorkspaceRoot("D:\\Spirit"), false);
  assert.equal(isSpiritWorktreeWorkspaceRoot("/Users/dev/Spirit"), false);
  assert.equal(isSpiritWorktreeWorkspaceRoot("/tmp/foo/bar"), false);
});

test("resolveSessionWorkLocation maps path to local or worktree", () => {
  assert.equal(resolveSessionWorkLocation("D:\\Spirit"), "local");
  assert.equal(resolveSessionWorkLocation("D:\\Spirit.worktrees\\spirit-a"), "worktree");
});
