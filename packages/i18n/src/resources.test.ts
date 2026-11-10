import assert from "node:assert/strict";
import { test } from "vitest";

import { resources } from "./resources.js";

test("all locales expose the same translation keys", () => {
  const expected = Object.keys(resources.en.translation).sort();
  for (const locale of Object.values(resources)) {
    assert.deepEqual(Object.keys(locale.translation).sort(), expected);
  }
});
