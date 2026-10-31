import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isServiceTierAvailableForInputTokens,
  MODEL_SERVICE_TIERS,
  ModelServiceTierConfigError,
  normalizeModelServiceTier,
  resolveEffectiveServiceTier,
  serviceTierMaxInputTokens,
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

const LIMITED_TIERS = {
  default: { body: { service_tier: "default" } },
  flex: { body: { service_tier: "flex" } },
  fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
} as const;

test("literal tiers expose input limits while simple lists remain unlimited", () => {
  assert.equal(serviceTierMaxInputTokens(LIMITED_TIERS, "fast"), 278528);
  assert.equal(serviceTierMaxInputTokens(LIMITED_TIERS, "default"), undefined);
  assert.equal(serviceTierMaxInputTokens(["default", "fast"], "fast"), undefined);
  assert.equal(serviceTierMaxInputTokens(undefined, "fast"), undefined);
});

test("tier input limits are inclusive and unknown usage does not change availability", () => {
  assert.equal(isServiceTierAvailableForInputTokens(LIMITED_TIERS, "fast", undefined), true);
  assert.equal(isServiceTierAvailableForInputTokens(LIMITED_TIERS, "fast", 278528), true);
  assert.equal(isServiceTierAvailableForInputTokens(LIMITED_TIERS, "fast", 278529), false);
  assert.equal(isServiceTierAvailableForInputTokens(LIMITED_TIERS, "flex", 999999), true);
});

test("effective tier falls back to default without mutating the fast preference", () => {
  for (const lastInputTokens of [undefined, 1000, 278528]) {
    assert.equal(
      resolveEffectiveServiceTier({
        serviceTier: "fast",
        serviceTiers: LIMITED_TIERS,
        ...(lastInputTokens !== undefined ? { lastInputTokens } : {}),
      }),
      "fast",
    );
  }
  assert.equal(
    resolveEffectiveServiceTier({
      serviceTier: "fast",
      serviceTiers: LIMITED_TIERS,
      lastInputTokens: 278529,
    }),
    "default",
  );
  assert.equal(
    resolveEffectiveServiceTier({
      serviceTier: "fast",
      serviceTiers: LIMITED_TIERS,
      lastInputTokens: 1000,
    }),
    "fast",
  );
  assert.equal(
    resolveEffectiveServiceTier({
      serviceTier: "fast",
      serviceTiers: { fast: { maxInputTokens: 10 } },
      lastInputTokens: 11,
    }),
    undefined,
  );
  assert.equal(
    resolveEffectiveServiceTier({
      serviceTier: "fast",
      serviceTiers: {
        default: { maxInputTokens: 5 },
        fast: { maxInputTokens: 10 },
      },
      lastInputTokens: 11,
    }),
    undefined,
  );
});
