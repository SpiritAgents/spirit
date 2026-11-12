import assert from "node:assert/strict";
import { test } from "vitest";

import {
  joinMarketplaceSectionNames,
  MARKETPLACE_SECTION_NAMED_LIMIT,
  MARKETPLACE_SECTION_VISIBLE_LIMIT,
  truncateMarketplaceSection,
} from "../../src/lib/marketplace-section-truncation.ts";

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    displayName: `E${index + 1}`,
  }));
}

test("sections within the limit are not truncated", () => {
  const items = makeEntries(MARKETPLACE_SECTION_VISIBLE_LIMIT);
  const { visible, hidden, named, restCount } = truncateMarketplaceSection(items);
  assert.deepEqual(visible, items);
  assert.deepEqual(hidden, []);
  assert.deepEqual(named, []);
  assert.equal(restCount, 0);
});

test("a single hidden row is named in full, with no rest count", () => {
  const items = makeEntries(MARKETPLACE_SECTION_VISIBLE_LIMIT + 1);
  const { visible, hidden, named, restCount } = truncateMarketplaceSection(items);
  assert.equal(visible.length, MARKETPLACE_SECTION_VISIBLE_LIMIT);
  assert.equal(hidden.length, 1);
  assert.deepEqual(named, hidden);
  assert.equal(restCount, 0);
});

test("up to three hidden rows are all named, with no rest count", () => {
  const items = makeEntries(MARKETPLACE_SECTION_VISIBLE_LIMIT + MARKETPLACE_SECTION_NAMED_LIMIT);
  const { hidden, named, restCount } = truncateMarketplaceSection(items);
  assert.equal(hidden.length, MARKETPLACE_SECTION_NAMED_LIMIT);
  assert.deepEqual(named, hidden);
  assert.equal(restCount, 0);
});

test("beyond three hidden rows the entry names three and counts the rest", () => {
  const items = makeEntries(MARKETPLACE_SECTION_VISIBLE_LIMIT + 5);
  const { hidden, named, restCount } = truncateMarketplaceSection(items);
  assert.equal(hidden.length, 5);
  // The named rows are the first hidden rows — same objects, same order — so
  // the stacked icons and the label stay bound to the same extensions.
  assert.deepEqual(named, hidden.slice(0, MARKETPLACE_SECTION_NAMED_LIMIT));
  assert.equal(restCount, 2);
});

test("name joining uses the enumeration comma for CJK locales", () => {
  const names = ["Alpha", "Beta", "Gamma"];
  assert.equal(joinMarketplaceSectionNames(names, "en"), "Alpha, Beta, Gamma");
  assert.equal(joinMarketplaceSectionNames(names, "de"), "Alpha, Beta, Gamma");
  assert.equal(joinMarketplaceSectionNames(names, "ko"), "Alpha, Beta, Gamma");
  assert.equal(joinMarketplaceSectionNames(names, "zh-CN"), "Alpha、Beta、Gamma");
  assert.equal(joinMarketplaceSectionNames(names, "zh-TW"), "Alpha、Beta、Gamma");
  assert.equal(joinMarketplaceSectionNames(names, "ja"), "Alpha、Beta、Gamma");
});
