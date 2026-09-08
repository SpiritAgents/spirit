// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

// Information section for the extension detail page: label / value rows
// without a card surface; rows without data are omitted.

import { useTranslation } from "react-i18next";

import { formatTitleFromId } from "@spiritagent/host-internal/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/host-internal/well-known-casing";

import type { DesktopMarketplaceCatalogEntry } from "@/types";

/** Display text for a website link: strip the protocol scheme and trailing slashes. */
function websiteDisplayText(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function MarketplaceInformationSection({ item }: { item: DesktopMarketplaceCatalogEntry }) {
  const { t } = useTranslation();

  const rows: { key: string; label: string; value: string; href?: string }[] = [];
  const authorName = item.author?.name?.trim();
  if (authorName) {
    rows.push({ key: "author", label: t("marketplace.infoAuthor"), value: authorName });
  }
  const category = item.category?.trim();
  if (category) {
    rows.push({
      key: "category",
      label: t("marketplace.infoCategory"),
      // Same well-known casing table as the marketplace list's section headers
      // (ai → AI, not Ai).
      value: formatTitleFromId(category, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }),
    });
  }
  // Version is always present on a catalog entry.
  rows.push({ key: "version", label: t("marketplace.infoVersion"), value: item.version });
  // The Website row is the project homepage; author.url is the author's own
  // page and stays unused here.
  const websiteUrl = item.homepage?.trim();
  if (websiteUrl) {
    rows.push({
      key: "website",
      label: t("marketplace.infoWebsite"),
      value: websiteDisplayText(websiteUrl),
      href: websiteUrl,
    });
  }

  return (
    <section aria-label={t("marketplace.information")} className="space-y-3">
      <p className="text-base font-medium text-foreground">{t("marketplace.information")}</p>
      <div className="space-y-2 text-sm">
        {rows.map(({ key, label, value, href }) => (
          <div key={key} className="flex items-baseline">
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            {href ? (
              <button
                type="button"
                className="text-foreground underline underline-offset-2 hover:text-sidebar-foreground/80"
                onClick={() => void window.spiritDesktop?.openExternalUrl(href)}
              >
                {value}
              </button>
            ) : (
              <span className="text-foreground">{value}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
