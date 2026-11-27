import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveForkedSessionDisplayName } from "../../src/lib/fork-session-utils.ts";

test("deriveForkedSessionDisplayName prefixes untitled sessions with (1)", () => {
  assert.equal(deriveForkedSessionDisplayName("My Thread"), "(1) My Thread");
});

test("deriveForkedSessionDisplayName increments stacked fork prefix", () => {
  assert.equal(deriveForkedSessionDisplayName("(1) My Thread"), "(2) My Thread");
  assert.equal(deriveForkedSessionDisplayName("(2) My Thread"), "(3) My Thread");
  assert.equal(deriveForkedSessionDisplayName("(9) My Thread"), "(10) My Thread");
});
