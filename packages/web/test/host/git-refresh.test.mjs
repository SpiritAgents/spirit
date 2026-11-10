import assert from "node:assert/strict";
import { test } from "vitest";

import { applyGitRevision } from "../../../../packages/sessions/dist/host/git.js";

test("applyGitRevision increments from previous revision", () => {
  const snapshot = applyGitRevision(
    {
      isRepository: true,
      hasChanges: false,
      branches: ["main"],
      aheadCount: 0,
      behindCount: 0,
      needsPush: false,
      branch: "main",
    },
    3,
  );
  assert.equal(snapshot.revision, 4);
});

test("applyGitRevision reset sets revision to 1", () => {
  const snapshot = applyGitRevision(
    {
      isRepository: true,
      hasChanges: true,
      branches: [],
      aheadCount: 0,
      behindCount: 0,
      needsPush: false,
    },
    9,
    { reset: true },
  );
  assert.equal(snapshot.revision, 1);
});
