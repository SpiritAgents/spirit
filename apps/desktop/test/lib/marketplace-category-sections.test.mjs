import assert from "node:assert/strict";
import { test } from "vitest";

import { groupMarketplaceEntriesByCategory } from "../../src/lib/marketplace-category-sections.ts";

function makeEntry(id, category) {
  return { id, displayName: id, category };
}

function summarize(sections) {
  return sections.map((section) => [section.category, section.items.map((item) => item.id)]);
}

test("groups rows by category, groups sorted by name, input order kept within a group", () => {
  const sections = groupMarketplaceEntriesByCategory([
    makeEntry("b1", "beta"),
    makeEntry("a1", "alpha"),
    makeEntry("b2", "beta"),
  ]);
  assert.deepEqual(summarize(sections), [
    ["alpha", ["a1"]],
    ["beta", ["b1", "b2"]],
  ]);
});

test("uncategorized rows form a trailing section only when categories exist", () => {
  const sections = groupMarketplaceEntriesByCategory([
    makeEntry("a1", "alpha"),
    makeEntry("u1", undefined),
    makeEntry("u2", "  "),
  ]);
  assert.deepEqual(summarize(sections), [
    ["alpha", ["a1"]],
    [undefined, ["u1", "u2"]],
  ]);
});

test("no categorized rows yields no sections so the list stays flat", () => {
  assert.deepEqual(groupMarketplaceEntriesByCategory([makeEntry("u1", undefined)]), []);
});

test("fully categorized rows yield no uncategorized section", () => {
  const sections = groupMarketplaceEntriesByCategory([makeEntry("a1", "alpha")]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].category, "alpha");
});
