import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseMarketplaceIndexText } from "@spiritagent/extension-toolkit";
import { test } from "vitest";

import { ensurePersonalMarketplace, personalRegistryRoot } from "./personal.js";

function indexPath(spiritDataDir: string): string {
  return path.join(personalRegistryRoot(spiritDataDir), ".spirit", "marketplace.json");
}

test("ensurePersonalMarketplace creates an empty index on first launch", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-personal-marketplace-"));
  try {
    await ensurePersonalMarketplace(spiritDataDir);
    const index = parseMarketplaceIndexText(await readFile(indexPath(spiritDataDir), "utf8"));
    assert.equal(index.name, "personal");
    assert.equal(index.displayName, "Personal");
    assert.deepEqual(index.extensions, []);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("ensurePersonalMarketplace never overwrites an existing index", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-personal-marketplace-"));
  try {
    await ensurePersonalMarketplace(spiritDataDir);
    const marked = `${await readFile(indexPath(spiritDataDir), "utf8")}// user marker\n`;
    await writeFile(indexPath(spiritDataDir), marked, "utf8");
    await ensurePersonalMarketplace(spiritDataDir);
    assert.equal(await readFile(indexPath(spiritDataDir), "utf8"), marked);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
