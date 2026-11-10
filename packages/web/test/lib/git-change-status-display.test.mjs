import assert from "node:assert/strict";
import { test } from "vitest";

import {
  formatGitChangeStatusLabel,
  gitChangeStatusClassName,
  gitChangeStatusTitle,
} from "../../src/lib/git-change-status-display.ts";

test("formatGitChangeStatusLabel maps untracked porcelain to U", () => {
  assert.equal(formatGitChangeStatusLabel("??"), "U");
  assert.equal(formatGitChangeStatusLabel("M"), "M");
  assert.equal(formatGitChangeStatusLabel("MM"), "MM");
});

test("gitChangeStatusTitle describes untracked files", () => {
  assert.equal(gitChangeStatusTitle("??"), "Untracked");
  assert.equal(gitChangeStatusTitle("M"), "M");
});

test("gitChangeStatusClassName uses blue for untracked", () => {
  assert.match(gitChangeStatusClassName("??"), /blue/);
  assert.match(gitChangeStatusClassName("M"), /amber/);
  assert.match(gitChangeStatusClassName("D"), /destructive/);
});
