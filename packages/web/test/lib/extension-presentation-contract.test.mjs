import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const webRoot = new URL("../../", import.meta.url);

const files = [
  "src/components/marketplace-contribution-groups.tsx",
  "src/components/marketplace-information-section.tsx",
  "src/components/marketplace-installed-extension-actions.tsx",
  "src/components/marketplace-view.tsx",
];

test("extension marketplace presentation never guesses labels from identifiers", async () => {
  for (const file of files) {
    const source = await readFile(new URL(file, webRoot), "utf8");
    assert.equal(source.includes("formatTitleFromId"), false, file);
    assert.equal(source.includes("WELL_KNOWN_CASING_OVERRIDES"), false, file);
  }
});
