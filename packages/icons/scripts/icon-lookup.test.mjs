import assert from "node:assert/strict";
import { test } from "node:test";

import { getSpiritIconComponent, isSpiritIconName, SPIRIT_ICON_NAMES } from "../dist/index.js";

test("Spirit Icons resolves only names from the generated registry", () => {
  assert.ok(SPIRIT_ICON_NAMES.includes("globe"));
  assert.equal(isSpiritIconName("globe"), true);
  assert.equal(getSpiritIconComponent("globe")?.displayName, "Globe");

  assert.equal(isSpiritIconName("file-text"), false);
  assert.equal(isSpiritIconName("FileText"), false);
  assert.equal(getSpiritIconComponent("file-text"), undefined);
  assert.equal(getSpiritIconComponent("FileText"), undefined);
  assert.equal(getSpiritIconComponent("constructor"), undefined);
  assert.equal(getSpiritIconComponent("toString"), undefined);
  assert.equal(getSpiritIconComponent("__proto__"), undefined);
});
