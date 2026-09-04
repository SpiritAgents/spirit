import type { MarketplaceExtensionEntry } from "@spiritagent/marketplace-toolkit";
import { isMarketplaceVersionNewer } from "@spiritagent/marketplace-toolkit";

import {
  builtInMarketplaceSourceRecord,
  readBuiltInMarketplaceIndex,
} from "../built-in/extensions.js";
import { listInstalledExtensions, type HostInstalledExtension } from "../extensions.js";
import type { ExtensionHostKind } from "../storage.js";
import { MarketplaceReviewAcknowledgementRequiredError } from "./errors.js";
import type { MarketplaceGitRunner } from "./git-source.js";
import type { MarketplaceIndexFetch } from "./http-index-source.js";
import { installMarketplaceExtensionEntry } from "./install.js";
import { personalSourceRecord, readPersonalMarketplaceIndex } from "./personal.js";
import { readMarketplaceSourceRegistry } from "./registry-store.js";
import { readMarketplaceSourceIndex } from "./sources.js";
import {
  BUILT_IN_MARKETPLACE_SOURCE_ID,
  PERSONAL_MARKETPLACE_SOURCE_ID,
  type MarketplaceRegistryRoot,
  type MarketplaceSourceRecord,
} from "./types.js";

/** Host-side context for marketplace reads and installs. */
export interface MarketplaceHostContext {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  fetchImpl?: MarketplaceIndexFetch;
  gitRunner?: MarketplaceGitRunner;
}

export interface MarketplaceResolvedEntry {
  source: MarketplaceSourceRecord;
  registryRoot: MarketplaceRegistryRoot;
  entry: MarketplaceExtensionEntry;
  /** Refresh fallback warnings collected while reading the winning source. */
  warning?: string;
}

/** All configured sources: the two internal sources plus user-added ones. */
export async function listAllMarketplaceSources(
  context: MarketplaceHostContext,
): Promise<MarketplaceSourceRecord[]> {
  const userSources = await readMarketplaceSourceRegistry(context.spiritDataDir);
  return [
    builtInMarketplaceSourceRecord(),
    personalSourceRecord(context.spiritDataDir),
    ...userSources,
  ];
}

/**
 * Read one source's index with refresh semantics. Internal sources read their
 * local registry roots; the Personal registry reads as empty before the first
 * ZIP import creates it.
 */
export async function readMarketplaceIndexForSource(
  context: MarketplaceHostContext,
  source: MarketplaceSourceRecord,
): Promise<{
  index: MarketplaceExtensionEntry[];
  registryRoot: MarketplaceRegistryRoot;
  warning?: string;
}> {
  if (source.id === BUILT_IN_MARKETPLACE_SOURCE_ID) {
    const index = await readBuiltInMarketplaceIndex();
    return {
      index: index.extensions,
      registryRoot: { kind: "path", path: source.locator },
    };
  }
  if (source.id === PERSONAL_MARKETPLACE_SOURCE_ID) {
    const index = await readPersonalMarketplaceIndex(context.spiritDataDir);
    return {
      index: index.extensions,
      registryRoot: { kind: "path", path: source.locator },
    };
  }
  const read = await readMarketplaceSourceIndex(context, source);
  return {
    index: read.index.extensions,
    registryRoot: read.registryRoot,
    ...(read.warning ? { warning: read.warning } : {}),
  };
}

/**
 * Resolve an extension name across all configured sources. Same-name entries
 * in multiple sources are an explicit conflict (no implicit priority);
 * `marketplace` (a source name) disambiguates.
 */
export async function resolveMarketplaceExtensionEntry(
  context: MarketplaceHostContext,
  name: string,
  options?: { marketplace?: string },
): Promise<MarketplaceResolvedEntry> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("The extension name must not be empty.");
  }

  const sources = await listAllMarketplaceSources(context);
  const matches: MarketplaceResolvedEntry[] = [];
  for (const source of sources) {
    let read;
    try {
      read = await readMarketplaceIndexForSource(context, source);
    } catch {
      // A source that cannot be read (offline without snapshot, broken local
      // path) does not block resolving from the remaining sources.
      continue;
    }
    const entry = read.index.find((candidate) => candidate.name === normalizedName);
    if (entry) {
      matches.push({
        source,
        registryRoot: read.registryRoot,
        entry,
        ...(read.warning ? { warning: read.warning } : {}),
      });
    }
  }

  const marketplaceFilter = options?.marketplace?.trim();
  if (marketplaceFilter) {
    const inSource = matches.filter((match) => match.source.name === marketplaceFilter);
    if (inSource.length > 0) {
      return inSource[0]!;
    }
    const knownSource = sources.some((source) => source.name === marketplaceFilter);
    if (!knownSource) {
      throw new Error(`No marketplace named "${marketplaceFilter}" is added.`);
    }
    throw new Error(
      `Marketplace "${marketplaceFilter}" does not have an extension named "${normalizedName}".`,
    );
  }

  if (matches.length === 0) {
    throw new Error(`Extension "${normalizedName}" was not found in any configured marketplace.`);
  }
  if (matches.length > 1) {
    const conflict = matches.map((match) => match.source.name).join(", ");
    throw new Error(
      `Extension "${normalizedName}" is provided by multiple marketplaces: ${conflict}. Re-run with --marketplace <name> to choose one.`,
    );
  }
  return matches[0]!;
}

function assertReviewAcknowledged(
  source: MarketplaceSourceRecord,
  entry: MarketplaceExtensionEntry,
  reviewAcknowledged: boolean | undefined,
): void {
  // The built-in source is part of the app and trusted with it.
  if (source.id === BUILT_IN_MARKETPLACE_SOURCE_ID) {
    return;
  }
  if (entry.reviewStatus !== "verified" && reviewAcknowledged !== true) {
    throw new MarketplaceReviewAcknowledgementRequiredError(
      `${source.id}/${entry.name}`,
      entry.reviewStatus,
    );
  }
}

/** Resolve + review-gate + install an extension by name from the configured sources. */
export async function installMarketplaceExtensionByName(
  context: MarketplaceHostContext,
  name: string,
  options?: { marketplace?: string; reviewAcknowledged?: boolean },
): Promise<HostInstalledExtension> {
  const resolved = await resolveMarketplaceExtensionEntry(context, name, options);
  assertReviewAcknowledged(resolved.source, resolved.entry, options?.reviewAcknowledged);
  return installMarketplaceExtensionEntry(context, {
    source: resolved.source,
    registryRoot: resolved.registryRoot,
    entry: resolved.entry,
  });
}

export interface MarketplaceExtensionUpdate {
  source: MarketplaceSourceRecord;
  registryRoot: MarketplaceRegistryRoot;
  entry: MarketplaceExtensionEntry;
  installedVersion: string;
  warning?: string;
}

/**
 * Registry-driven update check: re-resolve the entry from the source recorded
 * in the install identity. Built-in entries update automatically at startup
 * and Personal entries have no update semantics, so both yield undefined.
 * Errors when the source was removed or the entry disappeared — no cross-source
 * drift.
 */
export async function checkExtensionUpdate(
  context: MarketplaceHostContext,
  extensionId: string,
): Promise<MarketplaceExtensionUpdate | undefined> {
  const installed = (await listInstalledExtensions(context)).find(
    (item) => item.id === extensionId,
  );
  if (!installed) {
    throw new Error(`Extension not found: ${extensionId}`);
  }
  if (
    installed.sourceId === BUILT_IN_MARKETPLACE_SOURCE_ID ||
    installed.sourceId === PERSONAL_MARKETPLACE_SOURCE_ID
  ) {
    return undefined;
  }

  const sources = await readMarketplaceSourceRegistry(context.spiritDataDir);
  const source = sources.find((entry) => entry.id === installed.sourceId);
  if (!source) {
    throw new Error(
      `The marketplace source of ${extensionId} is no longer added; reinstall the extension or re-add the source.`,
    );
  }

  const read = await readMarketplaceSourceIndex(context, source);
  const entry = read.index.extensions.find(
    (candidate) => candidate.name === installed.manifest.name,
  );
  if (!entry) {
    throw new Error(
      `Extension ${installed.manifest.name} no longer exists in marketplace "${source.name}".`,
    );
  }
  if (!isMarketplaceVersionNewer(entry.version, installed.manifest.version)) {
    return undefined;
  }
  return {
    source,
    registryRoot: read.registryRoot,
    entry,
    installedVersion: installed.manifest.version,
    ...(read.warning ? { warning: read.warning } : {}),
  };
}

/** Update = the same install pipeline with overwrite, routed through the recorded source. */
export async function updateExtensionById(
  context: MarketplaceHostContext,
  extensionId: string,
  options?: { reviewAcknowledged?: boolean },
): Promise<HostInstalledExtension | undefined> {
  const update = await checkExtensionUpdate(context, extensionId);
  if (!update) {
    return undefined;
  }
  assertReviewAcknowledged(update.source, update.entry, options?.reviewAcknowledged);
  return installMarketplaceExtensionEntry(context, {
    source: update.source,
    registryRoot: update.registryRoot,
    entry: update.entry,
    replaceExisting: true,
  });
}
