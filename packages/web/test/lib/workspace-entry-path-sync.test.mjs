import assert from "node:assert/strict";
import { test } from "vitest";

import {
  evictRecordKeysUnderPrefix,
  formatWorkspaceRelativePathForCopy,
  isUnderWorkspaceEntryPath,
  joinWorkspaceAbsolutePath,
  remapWorkspaceEntryPath,
} from "../../src/lib/workspace-entry-path-sync.ts";

test("formatWorkspaceRelativePathForCopy normalizes and uses dot for root", () => {
  assert.equal(formatWorkspaceRelativePathForCopy(""), ".");
  assert.equal(formatWorkspaceRelativePathForCopy("src/App.tsx"), "src/App.tsx");
  assert.equal(formatWorkspaceRelativePathForCopy("src\\lib\\util.ts"), "src/lib/util.ts");
  assert.equal(formatWorkspaceRelativePathForCopy("/src/"), "src");
});

test("joinWorkspaceAbsolutePath joins root and relative path", () => {
  assert.equal(joinWorkspaceAbsolutePath("D:\\Projects\\app", ""), "D:\\Projects\\app");
  assert.equal(
    joinWorkspaceAbsolutePath("D:\\Projects\\app", "src/App.tsx"),
    "D:\\Projects\\app\\src\\App.tsx",
  );
  assert.equal(joinWorkspaceAbsolutePath("/home/user/app", "src/lib"), "/home/user/app/src/lib");
  assert.equal(joinWorkspaceAbsolutePath("/home/user/app/", "src/lib"), "/home/user/app/src/lib");
});

test("joinWorkspaceAbsolutePath accepts backslash relative paths on Windows root", () => {
  assert.equal(
    joinWorkspaceAbsolutePath("C:\\repo", "src\\components\\Button.tsx"),
    "C:\\repo\\src\\components\\Button.tsx",
  );
});

test("isUnderWorkspaceEntryPath matches self and nested paths", () => {
  assert.equal(isUnderWorkspaceEntryPath("src", "src"), true);
  assert.equal(isUnderWorkspaceEntryPath("src", "src/App.tsx"), true);
  assert.equal(isUnderWorkspaceEntryPath("src", "lib/App.tsx"), false);
  assert.equal(isUnderWorkspaceEntryPath("", "src"), false);
});

test("remapWorkspaceEntryPath remaps exact and nested paths", () => {
  assert.equal(
    remapWorkspaceEntryPath("src/App.tsx", "src/Main.tsx", "src/App.tsx"),
    "src/Main.tsx",
  );
  assert.equal(
    remapWorkspaceEntryPath("src", "lib", "src/components/Button.tsx"),
    "lib/components/Button.tsx",
  );
  assert.equal(remapWorkspaceEntryPath("src", "lib", "other/App.tsx"), null);
});

test("evictRecordKeysUnderPrefix removes prefix and descendants", () => {
  const record = {
    "": { status: "ready" },
    src: { status: "ready" },
    "src/components": { status: "ready" },
    lib: { status: "ready" },
  };

  const next = evictRecordKeysUnderPrefix(record, "src");
  assert.deepEqual(next, {
    "": { status: "ready" },
    lib: { status: "ready" },
  });
});
