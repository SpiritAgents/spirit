import assert from "node:assert/strict";
import { test } from "vitest";

import {
  compareMarketplaceVersions,
  isMarketplaceVersionNewer,
  isMarketplaceVersionString,
  parseMarketplaceVersion,
} from "./semver.js";

test("parseMarketplaceVersion accepts strict major.minor.patch", () => {
  assert.deepEqual(parseMarketplaceVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseMarketplaceVersion("0.0.1"), { major: 0, minor: 0, patch: 1 });
  assert.deepEqual(parseMarketplaceVersion(" 10.20.30 "), { major: 10, minor: 20, patch: 30 });
});

test("parseMarketplaceVersion rejects pre-release and build metadata", () => {
  assert.throws(() => parseMarketplaceVersion("1.0.0-alpha"), /without pre-release/);
  assert.throws(() => parseMarketplaceVersion("1.0.0-rc.1"), /without pre-release/);
  assert.throws(() => parseMarketplaceVersion("1.0.0+build"), /without pre-release/);
});

test("parseMarketplaceVersion rejects malformed versions", () => {
  for (const value of [
    "",
    "1",
    "1.0",
    "1.0.0.0",
    "v1.0.0",
    "1.01.0",
    "a.b.c",
    "1.0.x",
    "^1.0.0",
    "~1.0.0",
  ]) {
    assert.throws(() => parseMarketplaceVersion(value), /without pre-release/, value);
  }
  assert.equal(isMarketplaceVersionString("1.0.0"), true);
  assert.equal(isMarketplaceVersionString("1.0.0-beta"), false);
});

test("compareMarketplaceVersions orders numerically", () => {
  const v = (raw: string) => parseMarketplaceVersion(raw);
  assert.ok(compareMarketplaceVersions(v("1.0.0"), v("1.0.0")) === 0);
  assert.ok(compareMarketplaceVersions(v("2.0.0"), v("10.0.0")) < 0);
  assert.ok(compareMarketplaceVersions(v("1.10.0"), v("1.9.0")) > 0);
  assert.ok(compareMarketplaceVersions(v("1.0.2"), v("1.0.10")) < 0);
});

test("isMarketplaceVersionNewer implements update-button semantics", () => {
  assert.equal(isMarketplaceVersionNewer("1.0.1", "1.0.0"), true);
  assert.equal(isMarketplaceVersionNewer("2.0.0", "1.9.9"), true);
  assert.equal(isMarketplaceVersionNewer("1.0.0", "1.0.0"), false);
  assert.equal(isMarketplaceVersionNewer("1.0.0", "1.0.1"), false);
});
