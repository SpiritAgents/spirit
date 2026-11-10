import assert from "node:assert/strict";
import { test } from "vitest";

import {
  gitWorkingTreeFingerprint,
  nextWorkspaceContentInvalidation,
  toWorkspaceRelativePosixPath,
  workspaceContentInvalidationTouchesPath,
} from "../../src/lib/workspace-content-invalidation.ts";

test("toWorkspaceRelativePosixPath maps files under the workspace root", () => {
  assert.equal(
    toWorkspaceRelativePosixPath("/Users/me/proj", "/Users/me/proj/README.md"),
    "README.md",
  );
  assert.equal(
    toWorkspaceRelativePosixPath("/Users/me/proj", "/Users/me/proj/src/app.ts"),
    "src/app.ts",
  );
  assert.equal(toWorkspaceRelativePosixPath("/Users/me/proj", "/Users/me/other/README.md"), null);
});

test("workspaceContentInvalidationTouchesPath matches listed paths and git-wide refreshes", () => {
  assert.equal(
    workspaceContentInvalidationTouchesPath(
      { paths: ["README.md"], reason: "agent-file-change" },
      "README.md",
    ),
    true,
  );
  assert.equal(
    workspaceContentInvalidationTouchesPath(
      { paths: ["README.md"], reason: "agent-file-change" },
      "src/app.ts",
    ),
    false,
  );
  assert.equal(
    workspaceContentInvalidationTouchesPath(
      { paths: [], reason: "agent-file-change" },
      "README.md",
    ),
    false,
  );
  assert.equal(
    workspaceContentInvalidationTouchesPath({ paths: [], reason: "git-working-tree" }, "README.md"),
    true,
  );
});

test("gitWorkingTreeFingerprint ignores git revision-only churn", () => {
  const base = {
    hasChanges: true,
    workingTreeLineDelta: { added: 2, removed: 1 },
    branch: "main",
    aheadCount: 0,
    behindCount: 0,
  };
  assert.equal(gitWorkingTreeFingerprint(base), gitWorkingTreeFingerprint({ ...base }));
  assert.notEqual(
    gitWorkingTreeFingerprint(base),
    gitWorkingTreeFingerprint({ ...base, workingTreeLineDelta: { added: 3, removed: 1 } }),
  );
});

test("nextWorkspaceContentInvalidation bumps revision", () => {
  const first = nextWorkspaceContentInvalidation(undefined, ["README.md"], "agent-file-change");
  const second = nextWorkspaceContentInvalidation(first, ["src/a.ts"], "git-working-tree");
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.deepEqual(second.paths, ["src/a.ts"]);
});
