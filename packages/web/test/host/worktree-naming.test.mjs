import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeGeneratedWorktreeNames,
  parseGeneratedWorktreeNamingResponse,
} from "../../../../packages/sessions/dist/host/service-utils.js";

test("parseGeneratedWorktreeNamingResponse accepts valid JSON", () => {
  const parsed = parseGeneratedWorktreeNamingResponse(
    '{"worktreeName":"spirit-add-worktree-ui","branchName":"spirit/add-worktree-ui"}',
  );
  assert.deepEqual(parsed, {
    worktreeName: "spirit-add-worktree-ui",
    branchName: "spirit/add-worktree-ui",
  });
});

test("normalizeGeneratedWorktreeNames rejects invalid formats", () => {
  assert.throws(
    () =>
      normalizeGeneratedWorktreeNames({
        worktreeName: "feature/foo",
        branchName: "spirit/add-worktree-ui",
      }),
    /worktreeName/,
  );
  assert.throws(
    () =>
      normalizeGeneratedWorktreeNames({
        worktreeName: "spirit-add-worktree-ui",
        branchName: "feature/foo",
      }),
    /branchName/,
  );
});
