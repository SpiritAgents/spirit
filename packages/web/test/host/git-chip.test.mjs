import assert from "node:assert/strict";
import { test } from "vitest";

import i18n from "../../../../packages/sessions/dist/lib/i18n-host.js";
import {
  buildGitChipUserTurn,
  GIT_CHIP_DISPLAY_I18N_KEYS,
  GIT_CHIP_PROMPT_COMMIT,
  GIT_CHIP_PROMPT_MERGE,
  GIT_CHIP_PROMPT_PUSH,
} from "../../../../packages/sessions/dist/host/git-chip-prompts.js";

function buildGitChipDisplayText(action, extraNote) {
  const label = i18n.t(GIT_CHIP_DISPLAY_I18N_KEYS[action]);
  const note = extraNote?.trim();
  return note ? `${label} ${note}` : label;
}

test("buildGitChipUserTurn returns prompt body without YAML frontmatter", () => {
  for (const prompt of [GIT_CHIP_PROMPT_COMMIT, GIT_CHIP_PROMPT_PUSH, GIT_CHIP_PROMPT_MERGE]) {
    assert.match(prompt, /^## Goal/m);
    assert.doesNotMatch(prompt, /^---\r?\nname:/m);
  }
});

test("buildGitChipUserTurn maps commit push merge actions", () => {
  assert.equal(buildGitChipUserTurn("commit"), GIT_CHIP_PROMPT_COMMIT);
  assert.equal(buildGitChipUserTurn("push"), GIT_CHIP_PROMPT_PUSH);
  assert.equal(buildGitChipUserTurn("merge"), GIT_CHIP_PROMPT_MERGE);
});

test("buildGitChipUserTurn appends extraNote after prompt body", () => {
  const text = buildGitChipUserTurn("commit", "  use English subject  ");
  assert.equal(text, `${GIT_CHIP_PROMPT_COMMIT}\n\nuse English subject`);
});

test("buildGitChipUserTurn ignores blank extraNote", () => {
  assert.equal(buildGitChipUserTurn("push", "   "), GIT_CHIP_PROMPT_PUSH);
});

test("buildGitChipDisplayText uses button labels for UI bubble", async () => {
  await i18n.changeLanguage("en");
  assert.equal(buildGitChipDisplayText("commit"), "Commit");
  assert.equal(buildGitChipDisplayText("push"), "Push");
  assert.equal(buildGitChipDisplayText("merge"), "Merge");
  assert.equal(
    buildGitChipDisplayText("commit", "use English subject"),
    "Commit use English subject",
  );

  await i18n.changeLanguage("zh-CN");
  assert.equal(buildGitChipDisplayText("commit"), "提交");
  assert.equal(buildGitChipDisplayText("push"), "推送");
  assert.equal(buildGitChipDisplayText("merge"), "合并");
});
