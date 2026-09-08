/**
 * Dump → registry entry conversion, shared by `extension-toolkit publish`
 * and the host's ZIP import: identity, display, and manifest fields carry
 * over; schemaVersion / sourceId drop; the icon path is re-pointed from
 * dump-relative to registry-root-relative (`extensions/<name>/`). Curation
 * fields (featured / defaultInstalled) belong to the registry operator and
 * are never synthesized here.
 */

import type {
  MarketplaceExtensionDump,
  MarketplaceExtensionEntry,
  MarketplaceExtensionSource,
  MarketplaceReviewStatus,
} from "./schema.js";

export interface BuildMarketplaceEntryFromDumpOptions {
  source: MarketplaceExtensionSource;
  /** Defaults to "unverified": self-declared content starts unreviewed. */
  reviewStatus?: MarketplaceReviewStatus;
}

export function buildMarketplaceEntryFromDump(
  dump: MarketplaceExtensionDump,
  options: BuildMarketplaceEntryFromDumpOptions,
): MarketplaceExtensionEntry {
  return {
    name: dump.name,
    version: dump.version,
    source: options.source,
    // The dump icon is install-dir-relative; the entry re-points it at the
    // content directory inside the registry root.
    ...(dump.icon ? { icon: `extensions/${dump.name}/${dump.icon}` } : {}),
    displayName: dump.displayName,
    description: dump.description,
    ...(dump.author ? { author: dump.author } : {}),
    ...(dump.category ? { category: dump.category } : {}),
    ...(dump.keywords?.length ? { keywords: [...dump.keywords] } : {}),
    ...(dump.homepage ? { homepage: dump.homepage } : {}),
    reviewStatus: options.reviewStatus ?? "unverified",
    manifest: dump.manifest,
  };
}
