import assert from "node:assert/strict";
import { test } from "vitest";

import { workspaceDirectoryIconClassName } from "../../src/lib/workspace-directory-icon.ts";

test("workspaceDirectoryIconClassName matches slash menu list density", () => {
  assert.match(workspaceDirectoryIconClassName("list"), /size-3\.5/u);
  assert.match(workspaceDirectoryIconClassName("list"), /opacity-70/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName("list"), /text-/u);
});

test("workspaceDirectoryIconClassName inherit uses chip size", () => {
  assert.match(workspaceDirectoryIconClassName("inherit"), /size-3(?:\s|$)/u);
  assert.match(workspaceDirectoryIconClassName("inherit", "text-blue-600"), /text-blue-600/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName("inherit", "text-blue-600"), /opacity-70/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName("inherit"), /opacity-70/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName("inherit"), /size-3\.5/u);
});
