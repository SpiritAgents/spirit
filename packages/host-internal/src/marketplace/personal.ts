import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseMarketplaceIndexText,
  type MarketplaceExtensionEntry,
  type MarketplaceIndex,
} from "@spiritagent/marketplace-toolkit";

import { marketplacesDirPath } from "./registry-store.js";
import { PERSONAL_MARKETPLACE_SOURCE_ID, type MarketplaceSourceRecord } from "./types.js";

/**
 * Personal is a built-in source (reserved id `personal`): the default
 * registry for extensions imported without a marketplace (ZIP import). Its
 * directory is the registry root; it is created on the first ZIP import.
 */
export function personalRegistryRoot(spiritDataDir: string): string {
  return path.join(marketplacesDirPath(spiritDataDir), PERSONAL_MARKETPLACE_SOURCE_ID);
}

export function personalSourceRecord(spiritDataDir: string): MarketplaceSourceRecord {
  return {
    id: PERSONAL_MARKETPLACE_SOURCE_ID,
    name: PERSONAL_MARKETPLACE_SOURCE_ID,
    displayName: "Personal",
    kind: "local",
    locator: personalRegistryRoot(spiritDataDir),
    addedAtUnixMs: 0,
  };
}

function emptyPersonalIndex(): MarketplaceIndex {
  return {
    schemaVersion: 1,
    name: PERSONAL_MARKETPLACE_SOURCE_ID,
    displayName: "Personal",
    extensions: [],
  };
}

/** Read the Personal registry index; a not-yet-created registry reads as empty. */
export async function readPersonalMarketplaceIndex(
  spiritDataDir: string,
): Promise<MarketplaceIndex> {
  const indexPath = path.join(
    personalRegistryRoot(spiritDataDir),
    MARKETPLACE_SPIRIT_DIR_NAME,
    MARKETPLACE_INDEX_FILE_NAME,
  );
  if (!existsSync(indexPath)) {
    return emptyPersonalIndex();
  }
  return parseMarketplaceIndexText(await readFile(indexPath, "utf8"));
}

/**
 * Insert or replace an entry in the Personal registry index. Personal entries
 * carry no update semantics: the index is written at import time and the entry
 * version always equals the installed version.
 */
export async function upsertPersonalRegistryEntry(
  spiritDataDir: string,
  entry: MarketplaceExtensionEntry,
): Promise<void> {
  const root = personalRegistryRoot(spiritDataDir);
  const spiritDir = path.join(root, MARKETPLACE_SPIRIT_DIR_NAME);
  await mkdir(spiritDir, { recursive: true });

  const index = await readPersonalMarketplaceIndex(spiritDataDir);
  const extensions = [
    ...index.extensions.filter((existing) => existing.name !== entry.name),
    entry,
  ];
  const document: MarketplaceIndex = { ...index, extensions };
  await writeFile(
    path.join(spiritDir, MARKETPLACE_INDEX_FILE_NAME),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}
