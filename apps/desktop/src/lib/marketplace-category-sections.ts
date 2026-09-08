import type { DesktopMarketplaceCatalogEntry } from "@/types";

/**
 * A category group in the marketplace list. `category` undefined marks the
 * trailing uncategorized section, which the list renders as "Other".
 */
export interface MarketplaceCategorySection {
  category?: string;
  items: DesktopMarketplaceCatalogEntry[];
}

/**
 * Group marketplace rows by their single category. Each group keeps the
 * incoming (host-sorted) row order; groups sort by category name with en
 * collation. Uncategorized rows form one trailing section, which exists only
 * to follow real category sections — when nothing is categorized at all the
 * result is empty and the list stays flat.
 */
export function groupMarketplaceEntriesByCategory(
  items: readonly DesktopMarketplaceCatalogEntry[],
): MarketplaceCategorySection[] {
  const byCategory = new Map<string, DesktopMarketplaceCatalogEntry[]>();
  const uncategorized: DesktopMarketplaceCatalogEntry[] = [];
  for (const item of items) {
    const category = item.category?.trim();
    if (!category) {
      uncategorized.push(item);
      continue;
    }
    const group = byCategory.get(category);
    if (group) {
      group.push(item);
    } else {
      byCategory.set(category, [item]);
    }
  }
  const sections: MarketplaceCategorySection[] = [...byCategory.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([category, sectionItems]) => ({ category, items: sectionItems }));
  if (sections.length > 0 && uncategorized.length > 0) {
    sections.push({ items: uncategorized });
  }
  return sections;
}
