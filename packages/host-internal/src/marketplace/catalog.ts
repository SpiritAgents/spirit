import {
  isMarketplaceVersionNewer,
  resolveRegistryRelativeUrl,
  type MarketplaceExtensionEntry,
} from "@spiritagent/marketplace-toolkit";
import path from "node:path";

import { listInstalledExtensions } from "../extensions.js";
import {
  listAllMarketplaceSources,
  readMarketplaceIndexForSource,
  type MarketplaceHostContext,
} from "./resolve.js";
import {
  BUILT_IN_MARKETPLACE_SOURCE_ID,
  PERSONAL_MARKETPLACE_SOURCE_ID,
  type MarketplaceRegistryRoot,
  type MarketplaceSourceRecord,
} from "./types.js";

/** A catalog row: registry entry merged with the install state for this host. */
export interface MarketplaceCatalogItem {
  source: MarketplaceSourceRecord;
  entry: MarketplaceExtensionEntry;
  /** Renderable icon: absolute path (local/git registries) or https URL (index direct-links). */
  iconUrl?: string;
  /**
   * Locally readable content directory: the install dir for installed entries,
   * or the registry content dir for local/git sources. Undefined for remote
   * npm artifacts until installed.
   */
  contentDir?: string;
  installed: boolean;
  enabled?: boolean;
  installedVersion?: string;
  /** Registry-driven manual update available; always false for built-in and Personal. */
  updateAvailable: boolean;
}

function resolveIconUrl(
  registryRoot: MarketplaceRegistryRoot,
  icon: string | undefined,
): string | undefined {
  if (!icon) {
    return undefined;
  }
  if (registryRoot.kind === "path") {
    return path.join(registryRoot.path, ...icon.split("/"));
  }
  return resolveRegistryRelativeUrl(registryRoot.url, icon);
}

/** Locally readable content dir for an entry: registry content dir for local sources on path roots. */
function resolveEntryContentDir(
  registryRoot: MarketplaceRegistryRoot,
  entry: MarketplaceExtensionEntry,
): string | undefined {
  if (registryRoot.kind !== "path" || typeof entry.source !== "string") {
    return undefined;
  }
  return path.join(registryRoot.path, ...entry.source.split("/"));
}

/**
 * Read one source's catalog: refresh the source, merge install state, and
 * compute per-entry update availability. Reading never crosses sources.
 */
export async function readMarketplaceCatalogForSource(
  context: MarketplaceHostContext,
  source: MarketplaceSourceRecord,
): Promise<{ items: MarketplaceCatalogItem[]; warning?: string }> {
  const read = await readMarketplaceIndexForSource(context, source);
  const installed = await listInstalledExtensions(context);
  const installedByName = new Map(
    installed
      .filter((item) => item.sourceId === source.id)
      .map((item) => [item.manifest.name, item] as const),
  );

  const items = read.index
    .filter((entry) => entry.manifest.supportedHosts.includes(context.hostKind))
    .map((entry) => {
      const installedItem = installedByName.get(entry.name);
      const iconUrl = resolveIconUrl(read.registryRoot, entry.icon);
      const contentDir =
        installedItem?.directoryPath ?? resolveEntryContentDir(read.registryRoot, entry);
      const updateAvailable =
        installedItem !== undefined &&
        source.id !== BUILT_IN_MARKETPLACE_SOURCE_ID &&
        source.id !== PERSONAL_MARKETPLACE_SOURCE_ID &&
        isMarketplaceVersionNewer(entry.version, installedItem.manifest.version);
      return {
        source,
        entry,
        ...(iconUrl ? { iconUrl } : {}),
        ...(contentDir ? { contentDir } : {}),
        installed: installedItem !== undefined,
        ...(installedItem ? { enabled: installedItem.enabled } : {}),
        ...(installedItem ? { installedVersion: installedItem.manifest.version } : {}),
        updateAvailable,
      } satisfies MarketplaceCatalogItem;
    });

  return { items, ...(read.warning ? { warning: read.warning } : {}) };
}

/** Catalog rows for every configured source (built-in, Personal, user-added). */
export async function readMarketplaceCatalog(
  context: MarketplaceHostContext,
): Promise<{ items: MarketplaceCatalogItem[]; warnings: string[] }> {
  const sources = await listAllMarketplaceSources(context);
  const items: MarketplaceCatalogItem[] = [];
  const warnings: string[] = [];
  for (const source of sources) {
    try {
      const read = await readMarketplaceCatalogForSource(context, source);
      items.push(...read.items);
      if (read.warning) {
        warnings.push(read.warning);
      }
    } catch {
      // A source that cannot be read at all does not block the others.
      continue;
    }
  }
  return { items, warnings };
}

/** Detail read: one entry in one source, with install state. */
export async function getMarketplaceExtensionDetail(
  context: MarketplaceHostContext,
  sourceId: string,
  name: string,
): Promise<MarketplaceCatalogItem> {
  const sources = await listAllMarketplaceSources(context);
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new Error(`No marketplace with id "${sourceId}" is configured.`);
  }
  const read = await readMarketplaceCatalogForSource(context, source);
  const item = read.items.find((candidate) => candidate.entry.name === name);
  if (!item) {
    throw new Error(`Marketplace "${source.name}" does not have an extension named "${name}".`);
  }
  return item;
}
