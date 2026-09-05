import assert from "node:assert/strict";
import { test } from "vitest";

import { assertRegistryRelativePath, resolveRegistryRelativeUrl } from "./paths.js";

test("assertRegistryRelativePath accepts plain and ./-prefixed paths", () => {
  assert.equal(
    assertRegistryRelativePath("extensions/a/icon.svg", "icon"),
    "extensions/a/icon.svg",
  );
  assert.equal(assertRegistryRelativePath("./extensions/a", "source"), "extensions/a");
  assert.equal(assertRegistryRelativePath("a/b/c.txt", "p"), "a/b/c.txt");
});

test("assertRegistryRelativePath rejects .. segments", () => {
  assert.throws(() => assertRegistryRelativePath("../escape", "p"), /\.\./);
  assert.throws(() => assertRegistryRelativePath("a/../../escape", "p"), /\.\./);
  assert.throws(() => assertRegistryRelativePath("./..", "p"), /\.\./);
});

test("assertRegistryRelativePath rejects absolute paths", () => {
  assert.throws(() => assertRegistryRelativePath("/abs/path", "p"), /absolute/);
  assert.throws(() => assertRegistryRelativePath("//unc/share", "p"), /absolute/);
  assert.throws(() => assertRegistryRelativePath("C:\\\\abs", "p"), /POSIX/);
  assert.throws(() => assertRegistryRelativePath("C:/abs", "p"), /absolute/);
});

test("assertRegistryRelativePath rejects backslashes, empty and dot segments", () => {
  assert.throws(() => assertRegistryRelativePath("a\\\\b", "p"), /POSIX/);
  assert.throws(() => assertRegistryRelativePath("", "p"), /non-empty/);
  assert.throws(() => assertRegistryRelativePath("a//b", "p"), /empty or/);
  assert.throws(() => assertRegistryRelativePath("a/./b", "p"), /empty or/);
  assert.throws(() => assertRegistryRelativePath(".", "p"), /must point at a file/);
  assert.throws(() => assertRegistryRelativePath(42, "p"), /non-empty/);
});

test("resolveRegistryRelativeUrl resolves against the registry root", () => {
  assert.equal(
    resolveRegistryRelativeUrl("https://example.com/market", "extensions/a/icon.svg"),
    "https://example.com/market/extensions/a/icon.svg",
  );
  assert.equal(
    resolveRegistryRelativeUrl("https://example.com/market/", "extensions/a/icon.svg"),
    "https://example.com/market/extensions/a/icon.svg",
  );
});
