import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  marketplaceSourceIdForLocator,
  readMarketplaceSourceRegistry,
  writeMarketplaceSourceRegistry,
  type MarketplaceSourceRecord,
} from "./index.js";

function sampleRecord(overrides?: Partial<MarketplaceSourceRecord>): MarketplaceSourceRecord {
  return {
    id: marketplaceSourceIdForLocator("https://example.com/.spirit/marketplace.json"),
    name: "spirit-official",
    displayName: "Spirit Official",
    kind: "http-index",
    locator: "https://example.com/.spirit/marketplace.json",
    addedAtUnixMs: 1725000000000,
    ...overrides,
  };
}

test("source id is base64url of the normalized locator and round-trips", () => {
  const locator = "https://example.com/.spirit/marketplace.json";
  const id = marketplaceSourceIdForLocator(locator);
  assert.equal(Buffer.from(id, "base64url").toString("utf8"), locator);
  assert.match(id, /^[A-Za-z0-9_-]+$/u);
});

test("registry round-trips records", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-store-"));
  try {
    assert.deepEqual(await readMarketplaceSourceRegistry(dir), []);
    const records = [
      sampleRecord(),
      sampleRecord({
        id: marketplaceSourceIdForLocator("/opt/internal"),
        name: "internal",
        displayName: "Internal",
        kind: "local",
        locator: "/opt/internal",
      }),
      sampleRecord({
        id: marketplaceSourceIdForLocator("git@github.com:octocat/Hello-World.git"),
        name: "git-reg",
        displayName: "Git Registry",
        kind: "git",
        locator: "git@github.com:octocat/Hello-World.git",
        ref: "v1.0.0",
      }),
    ];
    await writeMarketplaceSourceRegistry(dir, records);
    assert.deepEqual(await readMarketplaceSourceRegistry(dir), records);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt registry files fail loudly", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-marketplace-store-"));
  try {
    await writeFile(path.join(dir, "marketplaces.json"), "{ nope", "utf8");
    await assert.rejects(readMarketplaceSourceRegistry(dir), /not valid JSON/);

    await writeFile(
      path.join(dir, "marketplaces.json"),
      '{"schemaVersion":2,"sources":[]}',
      "utf8",
    );
    await assert.rejects(readMarketplaceSourceRegistry(dir), /schemaVersion must be 1/);

    await writeFile(
      path.join(dir, "marketplaces.json"),
      '{"schemaVersion":1,"sources":[{"id":"x"}]}',
      "utf8",
    );
    await assert.rejects(readMarketplaceSourceRegistry(dir), /sources\[0\]\.name/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
