import assert from "node:assert/strict";
import { test } from "vitest";

import { assertAutomationMenuConfig } from "./automation-menu-values.js";

test("menu configs reject arrays and non-JSON values", () => {
  assert.throws(() => assertAutomationMenuConfig([]), /must be an object/);
  assert.throws(() => assertAutomationMenuConfig({ value: Number.NaN }), /finite number/);
});
