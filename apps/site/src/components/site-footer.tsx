"use client";

import type { SVGProps } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { protectBrandTokens } from "@/components/no-translate";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { DOCS_FRAME_CLASS, HAS_PUBLISHED_DOCS, SITE_FRAME_CLASS } from "@/lib/site-layout";
import { SPIRIT_GITHUB_REPO_URL, SPIRIT_RELEASES_URL } from "@/lib/github-links";
import { cn } from "@/lib/utils";

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c.85.004 1.705.115 2.496.337 2.292-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

type FooterItem = {
  label: string;
  href: string;
  external?: boolean;
};

type FooterColumnDef = {
  id: string;
  titleKey: "features" | "resources";
  items: FooterItem[];
};

const itemClassName =
  "inline-flex font-sans text-sm text-foreground outline-none transition-colors duration-200 hover:text-site-muted focus-visible:text-site-muted focus-visible:underline focus-visible:underline-offset-4";

const externalIconLinkClassName =
  "inline-flex rounded-md p-0.5 text-foreground/50 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Site-wide footer: sectioned layout. Section titles are sentence-case, text-sm, muted;
 * links default to the body color and shift to muted on hover.
 */
export function SiteFooter() {
  const pathname = usePathname();
  const isDocs = HAS_PUBLISHED_DOCS && /\/docs(?:\/|$)/.test(pathname);
  const { messages, localizedPath } = useI18n();
  const fm = messages.footer;
  const nav = messages.hero.nav;

  const columnDefs: FooterColumnDef[] = [
    {
      id: "features",
      titleKey: "features",
      items: [
        { label: nav.agent, href: localizedPath("#agent") },
        { label: nav.byok, href: localizedPath("#features") },
      ],
    },
    {
      id: "resources",
      titleKey: "resources",
      items: [
        { label: nav.docs, href: localizedPath("/docs") },
        { label: fm.changelog, href: SPIRIT_RELEASES_URL, external: true },
        { label: fm.openSourceLicenses, href: "/notice.md" },
      ],
    },
  ];

  const columns = columnDefs.map((col) => ({
    ...col,
    title: fm.columns[col.titleKey],
  }));

  return (
    <footer className="relative z-10 shrink-0 bg-background pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16 sm:pt-20">
      <div
        className={cn(
          isDocs ? DOCS_FRAME_CLASS : `${SITE_FRAME_CLASS} mx-auto px-5 sm:px-10 md:px-12`,
        )}
      >
        <nav className="grid grid-cols-2 gap-x-8 gap-y-12" aria-label={fm.navAria}>
          {columns.map((col) => (
            <div key={col.id} className="min-w-0">
              <p
                className={`mb-4 font-sans text-sm ${FONT_WEIGHT_NORMAL} tracking-tight text-site-muted`}
              >
                {col.title}
              </p>
              <ul className="flex flex-col gap-3">
                {col.items.map((item) => (
                  <li key={`${col.id}-${item.label}`}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={itemClassName}
                      >
                        {/* BYOK: Safari mistranslates to nonsense like “比OK”; drop when quality improves. */}
                        {protectBrandTokens(item.label)}
                      </a>
                    ) : (
                      <a href={item.href} className={itemClassName}>
                        {/* BYOK: Safari mistranslates to nonsense like “比OK”; drop when quality improves. */}
                        {protectBrandTokens(item.label)}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-16 pt-2">
          <div className="relative flex flex-col gap-4 sm:min-h-7 sm:flex-row sm:items-center sm:justify-between">
            <p className="order-2 text-left font-sans text-xs text-foreground/40 sm:order-1">
              {protectBrandTokens(fm.copyrightLine(CURRENT_YEAR))}
            </p>
            <ul
              className="order-1 flex list-none flex-wrap items-center justify-end sm:order-2"
              aria-label={fm.externalAria}
            >
              <li>
                <a
                  href={SPIRIT_GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className={externalIconLinkClassName}
                >
                  <GitHubMark className="size-4" aria-hidden />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
