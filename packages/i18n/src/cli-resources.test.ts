import assert from "node:assert/strict";
import { test } from "vitest";

import { cliResources } from "./cli-resources.js";

function placeholders(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return [...value.matchAll(/%\{([A-Za-z0-9_]+)\}/gu)].map((match) => match[1]!).sort();
}

test("CLI locales expose the same keys and interpolation variables", () => {
  const expectedKeys = Object.keys(cliResources.en).sort();
  assert.ok(expectedKeys.length > 0);
  for (const [locale, resource] of Object.entries(cliResources)) {
    assert.deepEqual(Object.keys(resource).sort(), expectedKeys, locale);
    for (const key of expectedKeys) {
      const expected = placeholders(cliResources.en[key as keyof typeof cliResources.en]);
      const actual = placeholders(resource[key as keyof typeof resource]);
      assert.deepEqual(actual, expected, `${locale}:${key}`);
    }
  }
});
