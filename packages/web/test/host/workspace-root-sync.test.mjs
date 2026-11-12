import assert from "node:assert/strict";
import { test } from "vitest";

import {
  needsHostWorkspaceRootSync,
  resolveEffectiveWorkspaceRoot,
} from "../../../../packages/sessions/dist/host/workspace-root-sync.js";

test("resolveEffectiveWorkspaceRoot prefers bundle workspaceRoot", () => {
  assert.equal(
    resolveEffectiveWorkspaceRoot(
      { workspaceRoot: "D:\\Spirit.worktrees\\spirit-a" },
      { workspaceRoot: "D:\\Spirit" },
    ),
    "D:\\Spirit.worktrees\\spirit-a",
  );
});

test("resolveEffectiveWorkspaceRoot falls back to host state when bundle empty", () => {
  assert.equal(
    resolveEffectiveWorkspaceRoot({ workspaceRoot: "" }, { workspaceRoot: "D:\\Spirit" }),
    "D:\\Spirit",
  );
});

test("needsHostWorkspaceRootSync is true when bundle worktree differs from host primary repo", () => {
  assert.equal(
    needsHostWorkspaceRootSync(
      { workspaceRoot: "D:\\Spirit.worktrees\\spirit-a" },
      { workspaceRoot: "D:\\Spirit" },
    ),
    true,
  );
});

test("needsHostWorkspaceRootSync is false when paths match case-insensitively", () => {
  assert.equal(
    needsHostWorkspaceRootSync(
      { workspaceRoot: "d:/spirit.worktrees/spirit-a" },
      { workspaceRoot: "D:\\Spirit.worktrees\\spirit-a" },
    ),
    false,
  );
});

test("needsHostWorkspaceRootSync is false when both use primary repo", () => {
  assert.equal(
    needsHostWorkspaceRootSync({ workspaceRoot: "D:\\Spirit" }, { workspaceRoot: "D:\\Spirit" }),
    false,
  );
});
