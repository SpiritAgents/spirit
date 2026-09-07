import type { DesktopMarketplaceCatalogEntry } from "@/types";

/** A section shows at most this many rows; the rest collapse behind the see-more entry. */
export const MARKETPLACE_SECTION_VISIBLE_LIMIT = 6;

/** The see-more entry names — and stacks the icons of — at most this many hidden rows. */
export const MARKETPLACE_SECTION_NAMED_LIMIT = 3;

export interface MarketplaceSectionTruncation {
  /** Rows rendered while collapsed; the full list when it fits the limit. */
  visible: DesktopMarketplaceCatalogEntry[];
  /** Rows behind the see-more entry while collapsed; empty when nothing is truncated. */
  hidden: DesktopMarketplaceCatalogEntry[];
  /**
   * The hidden rows the entry names and stacks icons for — the same items in
   * the same order, so the stacked icons always match the label.
   */
  named: DesktopMarketplaceCatalogEntry[];
  /** Hidden rows beyond the named ones; 0 means the label names everything hidden. */
  restCount: number;
}

/**
 * Split a marketplace section into the rows shown while collapsed and the
 * rows behind its see-more entry. The entry label names `named` and adds
 * "and N more" only when `restCount` is non-zero — a single hidden row reads
 * "See {name}" with one icon, no stack.
 */
export function truncateMarketplaceSection(
  items: readonly DesktopMarketplaceCatalogEntry[],
): MarketplaceSectionTruncation {
  const visible = items.slice(0, MARKETPLACE_SECTION_VISIBLE_LIMIT);
  const hidden = items.slice(MARKETPLACE_SECTION_VISIBLE_LIMIT);
  const named = hidden.slice(0, MARKETPLACE_SECTION_NAMED_LIMIT);
  return { visible, hidden, named, restCount: hidden.length - named.length };
}

/**
 * Join the see-more entry's extension names. CJK enumeration uses "、", other
 * locales ", ". Intl.ListFormat is not used: its unit/conjunction styles are
 * inconsistent across the app's locales (zh-CN unit joins with no separator
 * at all; de/fr/es unit-long inject a conjunction that would duplicate the
 * label template's own "and").
 */
export function joinMarketplaceSectionNames(names: readonly string[], language: string): string {
  const separator = language.startsWith("zh") || language.startsWith("ja") ? "、" : ", ";
  return names.join(separator);
}
