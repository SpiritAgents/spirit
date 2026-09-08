import type { DesktopMarketplaceCatalogEntry, DesktopMarketplaceSource } from "@/types";

/**
 * Tab visibility for the marketplace source row. Internal-source tabs
 * (built-in / personal) hide while their catalog is empty for this host;
 * user-added sources always keep their tab — the user added them explicitly.
 * The All pseudo tab shows exactly when any tab shows: it hides only when
 * nothing but empty internal sources remains, taking the whole tab bar with
 * it.
 */
export function filterVisibleMarketplaceSources(
  sources: readonly DesktopMarketplaceSource[],
  catalogs: Record<string, readonly DesktopMarketplaceCatalogEntry[]>,
): DesktopMarketplaceSource[] {
  return sources.filter((source) => {
    if (source.id === "built-in" || source.id === "personal") {
      return (catalogs[source.id] ?? []).length > 0;
    }
    return true;
  });
}
