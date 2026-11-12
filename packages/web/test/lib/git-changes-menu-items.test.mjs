import assert from "node:assert/strict";
import { test } from "vitest";

import { buildGitChangesMenuItemIds } from "../../../../packages/sessions/dist/lib/git-changes-menu-items.js";

test("buildGitChangesMenuItemIds lists push and merge when enabled", () => {
  assert.deepEqual(buildGitChangesMenuItemIds({ needsPush: true, canMerge: true }), [
    "push",
    "merge",
  ]);
  assert.deepEqual(buildGitChangesMenuItemIds({ needsPush: true, canMerge: false }), ["push"]);
  assert.deepEqual(buildGitChangesMenuItemIds({ needsPush: false, canMerge: true }), ["merge"]);
  assert.deepEqual(buildGitChangesMenuItemIds({ needsPush: false, canMerge: false }), []);
});
