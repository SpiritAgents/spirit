import assert from "node:assert/strict";

import { test } from "vitest";

import { buildMarketplaceEntryFromDump } from "./entry-from-dump.js";
import { parseExtensionDumpText } from "./schema.js";
import { localizedTestFields } from "./test-localization.js";

function dump(overrides: Record<string, unknown> = {}) {
  return parseExtensionDumpText(
    `${JSON.stringify({
      schemaVersion: 1,
      name: "demo-ext",
      version: "1.2.0",
      sourceId: "self-declared",
      ...localizedTestFields(),
      icon: "icon.svg",
      author: { name: "Alice", email: "alice@example.com" },
      category: "development",
      homepage: "https://example.com/demo-ext",
      manifest: {
        supportedHosts: ["cli"],
        requestedCapabilities: ["skills"],
        contributes: {
          skills: [
            {
              name: "demo",
              displayName: { message: "skills.demo.displayName" },
              summary: { message: "skills.demo.summary" },
            },
          ],
        },
      },
      ...overrides,
    })}\n`,
  );
}

test("carries identity, display, and manifest; drops schemaVersion and sourceId", () => {
  const entry = buildMarketplaceEntryFromDump(dump(), { source: "./extensions/demo-ext" });

  assert.equal(entry.name, "demo-ext");
  assert.equal(entry.version, "1.2.0");
  assert.equal(entry.source, "./extensions/demo-ext");
  assert.deepEqual(entry.displayName, { message: "metadata.displayName" });
  assert.deepEqual(entry.description, { message: "metadata.description" });
  assert.deepEqual(entry.author, { name: "Alice", email: "alice@example.com" });
  assert.equal(entry.category, "development");
  assert.deepEqual(entry.keywords, [{ message: "metadata.keyword" }]);
  assert.equal(entry.homepage, "https://example.com/demo-ext");
  assert.equal(entry.manifest.contributes?.skills?.[0]?.name, "demo");
  assert.equal(entry.reviewStatus, "unverified");
  assert.ok(!("schemaVersion" in entry));
  assert.ok(!("sourceId" in entry));
});

test("re-points the dump-relative icon at the registry content directory", () => {
  const entry = buildMarketplaceEntryFromDump(dump({ icon: "assets/icon.svg" }), {
    source: "./extensions/demo-ext",
  });
  assert.equal(entry.icon, "extensions/demo-ext/assets/icon.svg");

  const noIcon = buildMarketplaceEntryFromDump(dump({ icon: undefined }), {
    source: "./extensions/demo-ext",
  });
  assert.ok(!("icon" in noIcon));
});

test("omits an empty keywords array and honors an explicit reviewStatus", () => {
  const entry = buildMarketplaceEntryFromDump(dump({ keywords: [] }), {
    source: { source: "npm", package: "@scope/demo-ext@1.2.0" },
    reviewStatus: "verified",
  });
  assert.ok(!("keywords" in entry));
  assert.equal(entry.reviewStatus, "verified");
  assert.deepEqual(entry.source, { source: "npm", package: "@scope/demo-ext@1.2.0" });
});
