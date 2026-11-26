import assert from "node:assert/strict";
import { test } from "vitest";

import { workspaceFileDirname } from "../../src/lib/file-picker-path.ts";

test("workspaceFileDirname hides the directory for files at the workspace root", () => {
  assert.equal(workspaceFileDirname("AGENTS.md"), "");
});

test("workspaceFileDirname returns only the relative parent directory", () => {
  assert.equal(workspaceFileDirname(".spirit/AGENTS.md"), ".spirit");
  assert.equal(
    workspaceFileDirname(".agents/skills/design-review/SKILL.md"),
    ".agents/skills/design-review",
  );
  assert.equal(
    workspaceFileDirname(".agents\\skills\\design-review\\SKILL.md"),
    ".agents/skills/design-review",
  );
});
