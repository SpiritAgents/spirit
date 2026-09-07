// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Sparkles } from "lucide-react";

import {
  joinMarketplaceSectionNames,
  truncateMarketplaceSection,
} from "@/lib/marketplace-section-truncation";
import type { DesktopMarketplaceCatalogEntry } from "@/types";

interface MarketplaceCatalogSectionProps {
  ariaLabel: string;
  title: string;
  items: DesktopMarketplaceCatalogEntry[];
  className?: string;
  renderRow: (item: DesktopMarketplaceCatalogEntry) => ReactNode;
}

/**
 * One marketplace list section (Featured / category / Other). Rows beyond
 * MARKETPLACE_SECTION_VISIBLE_LIMIT collapse behind a see-more entry that
 * names — and stacks the icons of — the first hidden rows, so the entry
 * previews exactly what it reveals. Sections within the limit render no entry.
 */
export function MarketplaceCatalogSection({
  ariaLabel,
  title,
  items,
  className,
  renderRow,
}: MarketplaceCatalogSectionProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden, named, restCount } = truncateMarketplaceSection(items);
  const namedNames = joinMarketplaceSectionNames(
    named.map((item) => item.displayName),
    i18n.language,
  );

  return (
    <section aria-label={ariaLabel} className={className}>
      <h2 className="mb-2 text-base font-medium text-foreground">{title}</h2>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {(expanded ? items : visible).map(renderRow)}
      </div>
      {hidden.length > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          // Same edge bleed as the rows above. gap-1.5 follows the project's
          // text-xs rows with small leading icons (git changes), not the row's
          // gap-3, which is sized for the size-10 icon. The hover text
          // brightening switches instantly (no color transition).
          className="mt-1 flex -ml-2 w-[calc(100%+1rem)] items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:w-[calc(100%+0.5rem)]"
        >
          {expanded ? (
            t("marketplace.showLess")
          ) : (
            <>
              <span className="flex shrink-0 -space-x-1.5">
                {named.map((item) => (
                  // The row icon box scaled to size-4; rounded-[4px] not rounded-md:
                  // --radius-md (8px) is half of 16px and would render a circle
                  // (the size-4 checkbox uses rounded-[4px] for the same reason).
                  <span
                    key={item.id}
                    className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border/50 bg-muted text-muted-foreground"
                  >
                    {item.iconUrl ? (
                      <img
                        src={item.iconUrl}
                        alt=""
                        className="size-full object-cover"
                        aria-hidden
                      />
                    ) : (
                      <Sparkles className="size-1.5" aria-hidden />
                    )}
                  </span>
                ))}
              </span>
              <span className="min-w-0 truncate">
                {restCount > 0
                  ? t("marketplace.seeMoreWithCount", { names: namedNames, count: restCount })
                  : t("marketplace.seeMoreNamed", { names: namedNames })}
              </span>
            </>
          )}
        </button>
      ) : null}
    </section>
  );
}
