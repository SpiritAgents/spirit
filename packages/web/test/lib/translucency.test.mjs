import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_TRANSLUCENCY,
  isContentTranslucencyEnabled,
  isNativeTranslucencyEnabled,
  parseTranslucencyPreference,
} from "../../src/lib/translucency.ts";

test("parseTranslucencyPreference accepts off, sidebar, and all", () => {
  assert.equal(parseTranslucencyPreference("off"), "off");
  assert.equal(parseTranslucencyPreference("sidebar"), "sidebar");
  assert.equal(parseTranslucencyPreference("all"), "all");
});

test("parseTranslucencyPreference falls back to all for unknown values", () => {
  assert.equal(DEFAULT_TRANSLUCENCY, "all");
  assert.equal(parseTranslucencyPreference(undefined), DEFAULT_TRANSLUCENCY);
  assert.equal(parseTranslucencyPreference(true), DEFAULT_TRANSLUCENCY);
  assert.equal(parseTranslucencyPreference(false), DEFAULT_TRANSLUCENCY);
  assert.equal(parseTranslucencyPreference("true"), DEFAULT_TRANSLUCENCY);
  assert.equal(parseTranslucencyPreference(""), DEFAULT_TRANSLUCENCY);
});

test("native material is on for sidebar and all", () => {
  assert.equal(isNativeTranslucencyEnabled("off"), false);
  assert.equal(isNativeTranslucencyEnabled("sidebar"), true);
  assert.equal(isNativeTranslucencyEnabled("all"), true);
});

test("content tint is only on for all", () => {
  assert.equal(isContentTranslucencyEnabled("off"), false);
  assert.equal(isContentTranslucencyEnabled("sidebar"), false);
  assert.equal(isContentTranslucencyEnabled("all"), true);
});
