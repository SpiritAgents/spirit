import assert from "node:assert/strict";
import { test } from "vitest";

import { formatGitCommitChipLabel } from "@spiritagent/ui/composer";

test("formatGitCommitChipLabel keeps short subjects unchanged", () => {
  assert.equal(formatGitCommitChipLabel("  feat: add chip  "), "feat: add chip");
});

test("formatGitCommitChipLabel truncates by code points without splitting surrogate pairs", () => {
  const subject = "🎉".repeat(60);
  const label = formatGitCommitChipLabel(subject);
  assert.equal(label, `${"🎉".repeat(45)}…`);
  assert.equal(label.isWellFormed(), true);
});

test("formatGitCommitChipLabel counts astral characters as single units", () => {
  // 48 emoji = 96 code units; counting by code points should not trigger truncation
  const subject = "🎉".repeat(48);
  assert.equal(formatGitCommitChipLabel(subject), subject);
});
