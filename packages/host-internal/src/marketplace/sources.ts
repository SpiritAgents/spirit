import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseMarketplaceIndexText,
} from "@spiritagent/extension-toolkit";

import { ensureGitSourceClone, type MarketplaceGitRunner } from "./git-source.js";
import { readHttpIndexSource, type MarketplaceIndexFetch } from "./http-index-source.js";
import { classifyMarketplaceLocator } from "./locator.js";
import {
  marketplacesDirPath,
  marketplaceSourceIdForLocator,
  readMarketplaceSourceRegistry,
  writeMarketplaceSourceRegistry,
} from "./registry-store.js";
import type { MarketplaceSourceIndexRead, MarketplaceSourceRecord } from "./types.js";

export interface MarketplaceSourceManagerContext {
  spiritDataDir: string;
  /** Injectable fetch (http-index sources); tests must not touch the network. */
  fetchImpl?: MarketplaceIndexFetch;
  /** Injectable git runner; defaults to the system git executable. */
  gitRunner?: MarketplaceGitRunner;
  /** Injectable fs probes for locator classification. */
  pathExists?: (candidate: string) => boolean;
  pathIsFile?: (candidate: string) => boolean;
  /** Base for resolving relative local paths; defaults to process.cwd(). */
  cwd?: string;
  now?: () => number;
}

/**
 * Add a marketplace source: classify the locator, read and validate its
 * marketplace.json (for git sources this performs the first clone), then
 * persist the registry entry. The registry `name` / `displayName` come from
 * marketplace.json — add accepts no override flags.
 */
export async function addMarketplaceSource(
  context: MarketplaceSourceManagerContext,
  input: string,
  options?: { ref?: string },
): Promise<MarketplaceSourceRecord> {
  const classified = classifyMarketplaceLocator(input, {
    ...(context.pathExists ? { pathExists: context.pathExists } : {}),
    ...(context.pathIsFile ? { pathIsFile: context.pathIsFile } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  });

  const ref = options?.ref?.trim();
  if (ref && classified.kind !== "git") {
    throw new Error("--ref is only supported for git marketplace sources.");
  }

  const record: MarketplaceSourceRecord = {
    id: marketplaceSourceIdForLocator(classified.locator),
    // Placeholder until the index is read; the registry stores the
    // marketplace.json name/displayName, not user-supplied flags.
    name: "",
    displayName: "",
    kind: classified.kind,
    locator: classified.locator,
    ...(ref ? { ref } : {}),
    addedAtUnixMs: (context.now ?? (() => Date.now()))(),
  };

  const read = await readMarketplaceSourceIndex(context, record);
  record.name = read.index.name;
  record.displayName = read.index.displayName;

  const existing = await readMarketplaceSourceRegistry(context.spiritDataDir);
  if (existing.some((entry) => entry.id === record.id)) {
    throw new Error(
      `This marketplace is already added as "${existing.find((e) => e.id === record.id)?.name}".`,
    );
  }
  if (existing.some((entry) => entry.name === record.name)) {
    throw new Error(`A marketplace named "${record.name}" is already added.`);
  }

  await writeMarketplaceSourceRegistry(context.spiritDataDir, [...existing, record]);
  return record;
}

/** List user-added sources (built-in / personal are internal and not stored here). */
export async function listMarketplaceSources(
  context: MarketplaceSourceManagerContext,
): Promise<readonly MarketplaceSourceRecord[]> {
  return readMarketplaceSourceRegistry(context.spiritDataDir);
}

/** Remove a user-added source by registry name; cached clones / snapshots are deleted. */
export async function removeMarketplaceSource(
  context: MarketplaceSourceManagerContext,
  name: string,
): Promise<MarketplaceSourceRecord> {
  const existing = await readMarketplaceSourceRegistry(context.spiritDataDir);
  const record = existing.find((entry) => entry.name === name);
  if (!record) {
    throw new Error(`No marketplace named "${name}" is added.`);
  }
  await writeMarketplaceSourceRegistry(
    context.spiritDataDir,
    existing.filter((entry) => entry.id !== record.id),
  );
  await rm(path.join(marketplacesDirPath(context.spiritDataDir), record.id), {
    recursive: true,
    force: true,
  });
  return record;
}

/**
 * Read a source's marketplace.json with refresh semantics: git sources fetch
 * and reset to the configured ref, http-index sources re-fetch (falling back
 * to the last snapshot), local sources are read in place (always fresh).
 */
export async function readMarketplaceSourceIndex(
  context: MarketplaceSourceManagerContext,
  record: MarketplaceSourceRecord,
): Promise<MarketplaceSourceIndexRead> {
  switch (record.kind) {
    case "local": {
      const indexPath = path.join(
        record.locator,
        MARKETPLACE_SPIRIT_DIR_NAME,
        MARKETPLACE_INDEX_FILE_NAME,
      );
      let raw: string;
      try {
        raw = await readFile(indexPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `Marketplace "${record.name || record.locator}" has no ${MARKETPLACE_SPIRIT_DIR_NAME}/${MARKETPLACE_INDEX_FILE_NAME}: ${indexPath}`,
          );
        }
        throw error;
      }
      return {
        source: record,
        index: parseMarketplaceIndexText(raw),
        registryRoot: { kind: "path", path: record.locator },
      };
    }
    case "git": {
      const { repoDir, warning } = await ensureGitSourceClone(
        context.spiritDataDir,
        record,
        context.gitRunner ? { gitRunner: context.gitRunner } : undefined,
      );
      const indexPath = path.join(
        repoDir,
        MARKETPLACE_SPIRIT_DIR_NAME,
        MARKETPLACE_INDEX_FILE_NAME,
      );
      let raw: string;
      try {
        raw = await readFile(indexPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            `Marketplace repository ${record.locator} has no ${MARKETPLACE_SPIRIT_DIR_NAME}/${MARKETPLACE_INDEX_FILE_NAME}.`,
          );
        }
        throw error;
      }
      return {
        source: record,
        index: parseMarketplaceIndexText(raw),
        registryRoot: { kind: "path", path: repoDir },
        ...(warning ? { warning } : {}),
      };
    }
    case "http-index": {
      const { raw, warning } = await readHttpIndexSource(
        context.spiritDataDir,
        record,
        context.fetchImpl ? { fetchImpl: context.fetchImpl } : undefined,
      );
      return {
        source: record,
        index: parseMarketplaceIndexText(raw),
        registryRoot: { kind: "url", url: new URL("../", record.locator).href },
        ...(warning ? { warning } : {}),
      };
    }
  }
}
