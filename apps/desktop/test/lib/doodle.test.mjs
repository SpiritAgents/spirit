import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DOODLE_WORKSPACE_VARIANT,
  activeDoodleNavigationVariant,
  beginDoodleNavigation,
  cancelDoodleNavigation,
  commitDoodleNavigation,
  doodlePool,
  isWorkspaceDoodleVariant,
  pickDoodleVariant,
  resetDoodleStateForTests,
  resolveDoodle,
  resolveDoodleVariantForSession,
} from "../../src/lib/doodle.ts";

test("doodlePool excludes workspace variant when disabled", () => {
  const pool = doodlePool(false);
  assert.equal(pool.length, 2);
  assert.ok(!pool.includes(DOODLE_WORKSPACE_VARIANT));
});

test("doodlePool includes workspace variant when enabled", () => {
  const pool = doodlePool(true);
  assert.equal(pool.length, 3);
  assert.ok(pool.includes(DOODLE_WORKSPACE_VARIANT));
});

test("pickDoodleVariant never picks workspace when disabled", () => {
  for (let i = 0; i < 20; i += 1) {
    const variant = pickDoodleVariant({
      includeWorkspaceVariants: false,
      random: () => i / 20,
    });
    assert.ok(!isWorkspaceDoodleVariant(variant));
  }
});

test("pickDoodleVariant can pick workspace when enabled", () => {
  const variant = pickDoodleVariant({
    includeWorkspaceVariants: true,
    random: () => 0.99,
  });
  assert.equal(variant, DOODLE_WORKSPACE_VARIANT);
});

test("beginDoodleNavigation exposes pending variant until commit", () => {
  resetDoodleStateForTests();
  const variant = beginDoodleNavigation(7, {
    includeWorkspaceVariants: true,
    random: () => 0.99,
  });
  assert.equal(variant, DOODLE_WORKSPACE_VARIANT);
  assert.equal(activeDoodleNavigationVariant(7), variant);
  commitDoodleNavigation(7, "session-b");
  assert.equal(activeDoodleNavigationVariant(7), null);
  assert.equal(
    resolveDoodleVariantForSession("session-b", {
      includeWorkspaceVariants: true,
      random: () => 0,
    }),
    variant,
  );
});

test("cancelDoodleNavigation drops pending variant", () => {
  resetDoodleStateForTests();
  beginDoodleNavigation(9, {
    includeWorkspaceVariants: false,
    random: () => 0,
  });
  cancelDoodleNavigation(9);
  assert.equal(activeDoodleNavigationVariant(9), null);
});

test("resolveDoodleVariantForSession returns stable variant per session key", () => {
  resetDoodleStateForTests();
  const first = resolveDoodleVariantForSession("session-a", {
    includeWorkspaceVariants: true,
    random: () => 0.99,
  });
  const second = resolveDoodleVariantForSession("session-a", {
    includeWorkspaceVariants: false,
    random: () => 0,
  });
  assert.equal(first, DOODLE_WORKSPACE_VARIANT);
  assert.equal(second, first);
});

test("resolveDoodle passes workspace to t", () => {
  const calls = [];
  const t = (key, options) => {
    calls.push({ key, options });
    return `${key}:${options?.workspace ?? ""}`;
  };
  const resolved = resolveDoodle(t, "doSomethingIn", "Spirit");
  assert.equal(resolved, "app.doodle.doSomethingIn:Spirit");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.workspace, "Spirit");
});
