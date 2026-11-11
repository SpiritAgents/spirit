import { test } from "vitest";
import assert from "node:assert/strict";

import {
  buildWorktreeNamingPrompt,
  normalizeGeneratedWorktreeNames,
  parseGeneratedWorktreeNamingResponse,
} from "./worktree-naming.js";

test("buildWorktreeNamingPrompt includes task and repository metadata", () => {
  const prompt = buildWorktreeNamingPrompt({
    userPrompt: "Add worktree UI polish",
    baseBranch: "main",
    repoRoot: "/tmp/repo",
  });

  assert.match(prompt, /Add worktree UI polish/);
  assert.match(prompt, /baseBranch: main/);
  assert.match(prompt, /repository: \/tmp\/repo/);
});

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
