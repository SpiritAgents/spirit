import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeApprovalLevel } from "./approval-level.js";

test("normalizeApprovalLevel maps canonical values", () => {
  assert.equal(normalizeApprovalLevel("default"), "default");
  assert.equal(normalizeApprovalLevel("auto-approval"), "auto-approval");
  assert.equal(normalizeApprovalLevel("bypass-approval"), "bypass-approval");
});

test("normalizeApprovalLevel falls back unknown values to default", () => {
  assert.equal(normalizeApprovalLevel("bogus"), "default");
  assert.equal(normalizeApprovalLevel("full-approval"), "default");
  assert.equal(normalizeApprovalLevel(undefined), "default");
});
