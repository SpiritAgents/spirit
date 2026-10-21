import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MODEL_SERVICE_TIERS,
  ModelServiceTierConfigError,
  normalizeModelServiceTier,
} from "./model-service-tier.js";

test("MODEL_SERVICE_TIERS is the public tier vocabulary", () => {
  assert.deepEqual(
    [...MODEL_SERVICE_TIERS],
    ["auto", "default", "flex", "fast", "priority", "ultrafast"],
  );
});

test("normalizeModelServiceTier accepts enum values case-insensitively", () => {
  assert.equal(normalizeModelServiceTier("fast"), "fast");
  assert.equal(normalizeModelServiceTier(" Priority "), "priority");
  assert.equal(normalizeModelServiceTier("turbo"), undefined);
  assert.equal(normalizeModelServiceTier(undefined), undefined);
  assert.equal(normalizeModelServiceTier(7), undefined);
});

test("ModelServiceTierConfigError is a named error type for config-load validation", () => {
  const error = new ModelServiceTierConfigError("nope");
  assert.equal(error.name, "ModelServiceTierConfigError");
  assert.ok(error instanceof Error);
});
