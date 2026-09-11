import assert from "node:assert/strict";
import { test } from "node:test";
import { conventionalSpacingErrors } from "./check-commit-msg.mjs";

test("rejects a missing space after the colon", () => {
  assert.deepEqual(conventionalSpacingErrors("feat:xxx"), [
    "put a space after ':' (feat: xxx, not feat:xxx)",
  ]);
});

test("rejects a missing space after a multi-scope comma", () => {
  assert.deepEqual(conventionalSpacingErrors("feat(desktop,agent-core): xxx"), [
    "put a space after ',' in a multi-scope list (a, b, not a,b)",
  ]);
});

test("rejects both spacing mistakes together", () => {
  assert.deepEqual(conventionalSpacingErrors("feat(desktop,agent-core):xxx"), [
    "put a space after ':' (feat: xxx, not feat:xxx)",
    "put a space after ',' in a multi-scope list (a, b, not a,b)",
  ]);
});

test("accepts conventional subjects with the required spaces", () => {
  assert.deepEqual(conventionalSpacingErrors("feat: xxx"), []);
  assert.deepEqual(conventionalSpacingErrors("feat(desktop, agent-core): xxx"), []);
  assert.deepEqual(conventionalSpacingErrors("feat(desktop)!: xxx"), []);
});

test("does not require Conventional Commits", () => {
  assert.deepEqual(conventionalSpacingErrors("Merge branch 'feat/git-hooks'"), []);
  assert.deepEqual(conventionalSpacingErrors('Revert "feat: xxx"'), []);
  assert.deepEqual(conventionalSpacingErrors("修复提交说明空格"), []);
  assert.deepEqual(conventionalSpacingErrors("WIP on the hook path"), []);
});
