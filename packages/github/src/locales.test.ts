import assert from "node:assert/strict";
import { test } from "vitest";

import { flattenMessageCatalog } from "@spiritagent/extension-toolkit";
import { VALID_LANGUAGES } from "@spiritagent/i18n";

import { resources } from "./locales.js";

test("GitHub owns complete catalogs for every Spirit locale", () => {
  assert.deepEqual(Object.keys(resources).sort(), [...VALID_LANGUAGES].sort());
  const expectedKeys = Object.keys(flattenMessageCatalog(resources.en.translation)).sort();
  for (const [locale, { translation }] of Object.entries(resources)) {
    assert.deepEqual(Object.keys(flattenMessageCatalog(translation)).sort(), expectedKeys, locale);
  }
});

test("GitHub locale messages preserve interpolation and rich-text placeholders", () => {
  const expected = placeholders(resources.en.translation);
  for (const [locale, { translation }] of Object.entries(resources)) {
    assert.deepEqual(placeholders(translation), expected, locale);
  }
});

test("PR authorization hints localize the complete sentence and preserve its navigation link", () => {
  for (const [locale, { translation }] of Object.entries(resources)) {
    const message = translation.workspace.prGitHubAuthorizationRequired;
    assert.equal(message.match(/<authorize>/g)?.length, 1, locale);
    assert.equal(message.match(/<\/authorize>/g)?.length, 1, locale);
    assert.match(message, /<authorize>[^<]*GitHub[^<]*<\/authorize>/, locale);
  }
});

function placeholders(catalog: Parameters<typeof flattenMessageCatalog>[0]) {
  return Object.fromEntries(
    Object.entries(flattenMessageCatalog(catalog)).map(([key, message]) => [
      key,
      [
        ...(message.match(/\{\{\s*[^{}]+\s*\}\}/gu) ?? []),
        ...(message.match(/<\/?[A-Za-z][^>]*>/gu) ?? []),
      ].sort(),
    ]),
  );
}
