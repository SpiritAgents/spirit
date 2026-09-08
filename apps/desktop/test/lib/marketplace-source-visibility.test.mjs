import assert from "node:assert/strict";
import { test } from "vitest";

import { filterVisibleMarketplaceSources } from "../../src/lib/marketplace-source-visibility.ts";

function makeSource(id, internal) {
  return {
    id,
    name: id,
    displayName: id,
    kind: "local",
    locator: "",
    internal,
  };
}

function makeCatalog(entries) {
  return entries;
}

test("internal-source tabs hide while their catalog is empty", () => {
  const sources = [makeSource("built-in", true), makeSource("personal", true)];
  const visible = filterVisibleMarketplaceSources(sources, {
    "built-in": makeCatalog([{ id: "built-in/demo" }]),
    personal: makeCatalog([]),
  });
  assert.deepEqual(
    visible.map((source) => source.id),
    ["built-in"],
  );
});

test("user-added sources keep their tab even when empty", () => {
  const sources = [
    makeSource("built-in", true),
    makeSource("personal", true),
    makeSource("abc123", false),
  ];
  const visible = filterVisibleMarketplaceSources(sources, {
    "built-in": makeCatalog([]),
    personal: makeCatalog([]),
    abc123: makeCatalog([]),
  });
  assert.deepEqual(
    visible.map((source) => source.id),
    ["abc123"],
  );
});

test("nothing but empty internal sources hides every tab, including All", () => {
  const sources = [makeSource("built-in", true), makeSource("personal", true)];
  const visible = filterVisibleMarketplaceSources(sources, {
    "built-in": makeCatalog([]),
    personal: makeCatalog([]),
  });
  assert.equal(visible.length, 0);
});

test("a missing catalog entry reads as empty", () => {
  const sources = [makeSource("personal", true)];
  const visible = filterVisibleMarketplaceSources(sources, {});
  assert.equal(visible.length, 0);
});
