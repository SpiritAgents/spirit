import assert from "node:assert/strict";
import { test } from "vitest";

import { resources } from "./resources.js";

test("all locales expose the same translation keys", () => {
  const expected = Object.keys(resources.en.translation).sort();
  for (const locale of Object.values(resources)) {
    assert.deepEqual(Object.keys(locale.translation).sort(), expected);
  }
});

test("trigger authorization hints localize their navigation link with the contribution name", () => {
  for (const [locale, { translation }] of Object.entries(resources)) {
    const message = translation.automations.trigger.authorizationRequired;
    assert.equal(message.match(/<authorize>/g)?.length, 1, locale);
    assert.equal(message.match(/<\/authorize>/g)?.length, 1, locale);
    assert.match(message, /<authorize>[^<]*{{name}}[^<]*<\/authorize>/, locale);
  }
});
