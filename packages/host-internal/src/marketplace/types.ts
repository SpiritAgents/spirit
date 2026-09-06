import type { MarketplaceIndex } from "@spiritagent/extension-toolkit";

/** Reserved ids for internal sources (never stored in marketplaces.json). */
export const BUILT_IN_MARKETPLACE_SOURCE_ID = "built-in";
export const PERSONAL_MARKETPLACE_SOURCE_ID = "personal";

/**
 * Reserved id for the UI-level "All" pseudo source: a merged, display-only
 * view over every added source. Never stored in marketplaces.json and never
 * an install identity; the catalog RPC resolves it before source lookup.
 */
export const ALL_MARKETPLACE_SOURCE_ID = "all";

export type MarketplaceSourceKind = "local" | "git" | "http-index";

/**
 * A user-added marketplace source (marketplaces.json entry).
 * `locator` is normalized per kind: absolute registry-root path (local),
 * clone URL (git), or the full marketplace.json URL (http-index).
 */
export interface MarketplaceSourceRecord {
  /** base64url of the normalized locator (same style as pkg- directories). */
  id: string;
  /** Registry `name` from marketplace.json. */
  name: string;
  /** Registry `displayName` from marketplace.json. */
  displayName: string;
  kind: MarketplaceSourceKind;
  locator: string;
  /** Git only: tag / branch / commit. Defaults to the remote default branch. */
  ref?: string;
  addedAtUnixMs: number;
}

/** Base that registry-relative paths (icon, local source) resolve against. */
export type MarketplaceRegistryRoot = { kind: "path"; path: string } | { kind: "url"; url: string };

export interface MarketplaceSourceIndexRead {
  source: MarketplaceSourceRecord;
  index: MarketplaceIndex;
  registryRoot: MarketplaceRegistryRoot;
  /** Set when a refresh failed and stale data (clone / snapshot) was used. */
  warning?: string;
}
