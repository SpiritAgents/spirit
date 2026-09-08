import assert from "node:assert/strict";

import { test } from "vitest";

import { buildMarketplaceEntryFromDump } from "./entry-from-dump.js";
import { parseExtensionDumpText } from "./schema.js";

function dump(overrides: Record<string, unknown> = {}) {
  return parseExtensionDumpText(
    `${JSON.stringify({
      schemaVersion: 1,
      name: "demo-ext",
      version: "1.2.0",
      sourceId: "self-declared",
      displayName: "Demo",
      description: "Demo extension.",
      icon: "icon.svg",
      author: { name: "Alice", email: "alice@example.com" },
      category: "developer-tools",
      keywords: ["demo"],
      homepage: "https://example.com/demo-ext",
      manifest: {
        supportedHosts: ["cli"],
        requestedCapabilities: ["skills"],
        contributes: { skills: true },
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
  assert.equal(entry.displayName, "Demo");
  assert.equal(entry.description, "Demo extension.");
  assert.deepEqual(entry.author, { name: "Alice", email: "alice@example.com" });
  assert.equal(entry.category, "developer-tools");
  assert.deepEqual(entry.keywords, ["demo"]);
  assert.equal(entry.homepage, "https://example.com/demo-ext");
  assert.deepEqual(entry.manifest.contributes, { skills: true });
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
