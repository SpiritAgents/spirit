import assert from "node:assert/strict";
import { test } from "vitest";

import { matchPermissionPattern } from "./matcher.js";

test("star matches across path separators", () => {
  assert.equal(matchPermissionPattern("*/.env*", "/home/user/project/.env.local"), true);
  assert.equal(matchPermissionPattern("/home/*/secret", "/home/a/b/c/secret"), true);
});

test("star matches zero characters", () => {
  assert.equal(matchPermissionPattern("a*b", "ab"), true);
  assert.equal(matchPermissionPattern("*", ""), true);
  assert.equal(matchPermissionPattern("git*", "git"), true);
});

test("trailing space-star also matches the bare command", () => {
  assert.equal(matchPermissionPattern("git *", "git"), true);
  assert.equal(matchPermissionPattern("git *", "git status"), true);
  assert.equal(matchPermissionPattern("git *", "git status --short"), true);
  // Without the trailing " *", the bare pattern is strict.
  assert.equal(matchPermissionPattern("git", "git status"), false);
  assert.equal(matchPermissionPattern("git", "git"), true);
  // The trailing rule does not leak into other strings sharing the prefix.
  assert.equal(matchPermissionPattern("git *", "gitx"), false);
  assert.equal(matchPermissionPattern("git *", "gitx status"), false);
});

test("full-string anchoring: no substring or prefix semantics", () => {
  assert.equal(matchPermissionPattern("status", "git status"), false);
  assert.equal(matchPermissionPattern("git", "git status"), false);
  assert.equal(matchPermissionPattern("git status", "git"), false);
});

test("matching is case-sensitive", () => {
  assert.equal(matchPermissionPattern("Git *", "git status"), false);
  assert.equal(matchPermissionPattern("*.TXT", "notes.txt"), false);
  assert.equal(matchPermissionPattern("*.TXT", "notes.TXT"), true);
});

test("non-star metacharacters are literal", () => {
  assert.equal(matchPermissionPattern("a?b", "a?b"), true);
  assert.equal(matchPermissionPattern("a?b", "axb"), false);
  assert.equal(matchPermissionPattern("a[bc]d", "a[bc]d"), true);
  assert.equal(matchPermissionPattern("a[bc]d", "abd"), false);
  assert.equal(matchPermissionPattern(String.raw`a\b`, String.raw`a\b`), true);
});

test("multiple stars with backtracking", () => {
  assert.equal(matchPermissionPattern("*rm*rf*", "x rm -rf x"), true);
  assert.equal(matchPermissionPattern("*a*b*c*", "abc"), true);
  assert.equal(matchPermissionPattern("*a*b*c*", "acb"), false);
});
