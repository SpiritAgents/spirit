import assert from "node:assert/strict";
import { test } from "vitest";

import { truncateOuterHtml } from "@spiritagent/ui/composer";

test("truncateOuterHtml keeps short html unchanged", () => {
  const html = "<div>ok</div>";
  assert.equal(truncateOuterHtml(html), html);
});

test("truncateOuterHtml truncates by code points without splitting surrogate pairs", () => {
  // Prefix is 4095 code units; units 4096/4097 form a surrogate pair
  const html = `<div>${"a".repeat(4090)}🎉🎉🎉</div>`;
  const truncated = truncateOuterHtml(html);
  assert.equal(truncated.endsWith("…"), true);
  assert.equal(truncated.isWellFormed(), true);
  assert.equal([...truncated].length, 4096 + 1);
});
