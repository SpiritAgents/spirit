"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import { usePathname } from "next/navigation";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { DocsSearch } from "@/components/docs-search";
import { SiteCompactMega } from "@/components/site-compact-mega";
import { SpiritDownloadButton } from "@/components/spirit-download-button";
import { NoTranslate, protectBrandTokens } from "@/components/no-translate";
import { useI18n } from "@/i18n/provider";
import {
  DOCS_FRAME_CLASS,
  HAS_PUBLISHED_DOCS,
  DOCS_MOBILE_MEGA_ROOT_ID,
  DOCS_MOBILE_MEGA_OPEN_EVENT,
  DOCS_MOBILE_MEGA_CLOSE_EVENT,
  requestDocsMegaToggle,
  SITE_FRAME_CLASS,
  SITE_MEGA_PANEL_DURATION_MS,
  SITE_MEGA_PANEL_HEIGHT_TRANSITION,
  SITE_NAV_MENU_OPEN_EVENT,
} from "@/lib/site-layout";
import { getSiteNavMenus, SITE_NAV_MENU_KEYS, type SiteNavMenuKey } from "@/lib/site-nav-menus";
import { SPIRIT_GITHUB_REPO_URL } from "@/lib/github-links";
import { cn } from "@/lib/utils";

const GITHUB_REPO_URL = SPIRIT_GITHUB_REPO_URL;

function CompactMenuIcon({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="relative size-4 opacity-50 transition-opacity duration-150 group-hover:opacity-100"
    >
      <span
        className={cn(
          "absolute inset-x-0 top-1/2 h-[1.5px] bg-current transition-transform duration-400 ease-[cubic-bezier(0.32,0.72,0.24,1)]",
          open ? "-translate-y-1/2 rotate-45" : "-translate-y-[3.5px] rotate-0",
        )}
      />
      <span
        className={cn(
          "absolute inset-x-0 top-1/2 h-[1.5px] bg-current transition-transform duration-400 ease-[cubic-bezier(0.32,0.72,0.24,1)]",
          open ? "-translate-y-1/2 -rotate-45" : "translate-y-[2px] rotate-0",
        )}
      />
    </span>
  );
}

/**
 * The bar itself extends downward into one continuous background-colored surface; only its
 * height animates.
 * Content cross-fades while height interpolates between menu panels, and on close it is
 * clipped by the shrinking surface — the collapse duration doubles as the hide delay.
 */

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c.85.004 1.705.115 2.496.337 2.292-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function SiteNav() {
  const { messages, localizedPath } = useI18n();
  const pathname = usePathname();
  const isDocs = HAS_PUBLISHED_DOCS && /\/docs(?:\/|$)/.test(pathname);
  const nav = messages.hero.nav;
  const frameClass = isDocs ? DOCS_FRAME_CLASS : `${SITE_FRAME_CLASS} mx-auto`;

  const [openMenu, setOpenMenu] = useState<SiteNavMenuKey | null>(null);
  const [compactOpen, setCompactOpen] = useState(false);
  const [docsMegaOpen, setDocsMegaOpen] = useState(false);
  // The panel whose content is rendered at full opacity. Follows openMenu instantly
  // when opening/switching, but trails it on close so the collapsing bar clips the
  // text instead of the text fading out before the collapse finishes.
  const [visibleMenu, setVisibleMenu] = useState<SiteNavMenuKey | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<SiteNavMenuKey | null>(null);
  // One trigger reads as current: the hovered one, falling back to the open one.
  // Every other trigger dims. Hovering the gap between triggers matches nothing,
  // so a closed bar stays all-foreground and an open bar keeps its trigger foreground.
  const currentMenu = hoveredMenu ?? openMenu;
  const [panelHeights, setPanelHeights] = useState<Record<SiteNavMenuKey, number>>({
    features: 0,
    resources: 0,
  });
  const panelRefs = useRef<Record<SiteNavMenuKey, HTMLDivElement | null>>({
    features: null,
    resources: null,
  });
  const triggerRefs = useRef<Record<SiteNavMenuKey, HTMLButtonElement | null>>({
    features: null,
    resources: null,
  });

  const menus = getSiteNavMenus(nav, localizedPath);

  // Measure each panel's natural height once and on layout changes, so the bar can
  // animate its height straight from one menu to the next without collapsing first.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setPanelHeights((current) => {
        let changed = false;
        const next = { ...current };
        for (const key of SITE_NAV_MENU_KEYS) {
          const el = panelRefs.current[key];
          if (!el) continue;
          const height = el.offsetHeight;
          if (next[key] !== height) {
            next[key] = height;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    for (const key of SITE_NAV_MENU_KEYS) {
      const el = panelRefs.current[key];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // Keep the last-open panel fully visible for the duration of the collapse, then
  // hide it. Reopening mid-collapse cancels the pending hide, so nothing flickers.
  useEffect(() => {
    if (openMenu !== null) {
      return;
    }
    const timer = window.setTimeout(() => setVisibleMenu(null), SITE_MEGA_PANEL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [openMenu]);
  if (openMenu !== null && visibleMenu !== openMenu) {
    setVisibleMenu(openMenu);
  }

  useEffect(() => {
    if (!openMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        triggerRefs.current[openMenu]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== null) {
      window.dispatchEvent(new Event(SITE_NAV_MENU_OPEN_EVENT));
    }
  }, [openMenu]);

  useEffect(() => {
    const onOpen = () => {
      setOpenMenu(null);
      setDocsMegaOpen(true);
    };
    const onClose = () => setDocsMegaOpen(false);
    window.addEventListener(DOCS_MOBILE_MEGA_OPEN_EVENT, onOpen);
    window.addEventListener(DOCS_MOBILE_MEGA_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(DOCS_MOBILE_MEGA_OPEN_EVENT, onOpen);
      window.removeEventListener(DOCS_MOBILE_MEGA_CLOSE_EVENT, onClose);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (!media.matches) setOpenMenu(null);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 bg-background"
        onMouseLeave={() => setOpenMenu(null)}
      >
        <div>
          <div className={cn("flex items-center justify-between py-3.5 sm:py-4", frameClass)}>
            <div className="flex min-w-0 items-center gap-6 sm:gap-7">
              <a
                href={localizedPath()}
                aria-label={messages.hero.homeAria}
                className="shrink-0 text-foreground"
              >
                <span
                  className={`whitespace-nowrap text-[15px] ${FONT_WEIGHT_NORMAL} leading-none tracking-[-0.02em] text-foreground/96`}
                >
                  <NoTranslate>{messages.common.brand}</NoTranslate>
                </span>
              </a>
              <nav className="hidden md:block" aria-label={messages.hero.primaryNavAria}>
                <ul className="flex list-none items-center gap-5">
                  {menus.map((menu) => (
                    <li key={menu.key}>
                      <button
                        ref={(el) => {
                          triggerRefs.current[menu.key] = el;
                        }}
                        type="button"
                        aria-expanded={openMenu === menu.key}
                        aria-controls={`site-nav-panel-${menu.key}`}
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "mouse") return;
                          setHoveredMenu(menu.key);
                          setOpenMenu(menu.key);
                        }}
                        onPointerLeave={(event) => {
                          if (event.pointerType === "mouse") setHoveredMenu(null);
                        }}
                        onClick={() =>
                          setOpenMenu((current) => (current === menu.key ? null : menu.key))
                        }
                        className={cn(
                          `cursor-pointer rounded-sm text-[13px] ${FONT_WEIGHT_NORMAL} leading-none text-foreground`,
                          "transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          currentMenu !== null && currentMenu !== menu.key && "text-foreground/60",
                        )}
                      >
                        {menu.trigger}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-4 sm:gap-5">
              {isDocs ? <DocsSearch /> : null}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={nav.github}
                className="inline-flex rounded-md p-0.5 text-foreground/50 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <GitHubMark className="size-4" />
              </a>
              <SpiritDownloadButton className="h-8 gap-1 rounded-full px-3 text-[13px] [&_svg]:size-3" />
              {isDocs ? (
                <button
                  type="button"
                  aria-expanded={docsMegaOpen}
                  aria-controls="site-compact-mega"
                  aria-label={docsMegaOpen ? messages.docs.closeMenu : messages.docs.openMenu}
                  onClick={() => {
                    setOpenMenu(null);
                    requestDocsMegaToggle();
                  }}
                  className={cn(
                    "group hidden size-8 cursor-pointer items-center justify-center rounded-md text-foreground outline-none max-lg:inline-flex",
                    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <CompactMenuIcon open={docsMegaOpen} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-expanded={compactOpen}
                  aria-controls="site-compact-mega"
                  aria-label={compactOpen ? nav.closeMenu : nav.openMenu}
                  onClick={() => {
                    setOpenMenu(null);
                    setCompactOpen((current) => !current);
                  }}
                  className={cn(
                    "group hidden size-8 cursor-pointer items-center justify-center rounded-md text-foreground outline-none max-md:inline-flex",
                    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <CompactMenuIcon open={compactOpen} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div id={DOCS_MOBILE_MEGA_ROOT_ID}>
          {isDocs ? null : (
            <SiteCompactMega
              open={compactOpen}
              onClose={() => setCompactOpen(false)}
              menus={menus}
              exploreLabel={nav.explore}
              backLabel={nav.back}
              frameClass={frameClass}
            />
          )}
        </div>
        <div
          className="overflow-hidden max-md:hidden"
          style={{
            height: openMenu ? panelHeights[openMenu] : 0,
            transition: SITE_MEGA_PANEL_HEIGHT_TRANSITION,
          }}
        >
          <div>
            <div className={cn("relative", frameClass)}>
              {menus.map((menu) => {
                const isOpen = openMenu === menu.key;
                const isVisible = visibleMenu === menu.key;
                return (
                  <div
                    key={menu.key}
                    ref={(el) => {
                      panelRefs.current[menu.key] = el;
                    }}
                    id={`site-nav-panel-${menu.key}`}
                    aria-hidden={!isOpen}
                    inert={isOpen ? undefined : true}
                    className={cn(
                      "absolute inset-x-0 top-0 pb-10 pt-6 transition-opacity duration-[250ms] ease-out",
                      isVisible ? "opacity-100" : "invisible opacity-0",
                      !isOpen && "pointer-events-none",
                    )}
                  >
                    <p className={`text-[13px] ${FONT_WEIGHT_NORMAL} leading-none text-site-muted`}>
                      {menu.explore}
                    </p>
                    <ul className="mt-4 flex flex-col items-start gap-2">
                      {menu.links.map((link) => (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            onClick={() => setOpenMenu(null)}
                            {...(link.external
                              ? { target: "_blank", rel: "noopener noreferrer" }
                              : {})}
                            className={cn(
                              `block w-fit rounded-sm text-[28px] ${FONT_WEIGHT_NORMAL} leading-[1.2] tracking-[-0.01em] text-foreground`,
                              "transition-colors duration-150 hover:text-foreground/60",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                            )}
                          >
                            {/* BYOK: Safari mistranslates to nonsense like “比OK”; drop when quality improves. */}
                            {protectBrandTokens(link.label)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>
      <div
        aria-hidden="true"
        onClick={() => setOpenMenu(null)}
        className={cn(
          "fixed inset-0 z-30 bg-black/50 backdrop-blur-md transition-opacity duration-300",
          openMenu ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
    </>
  );
}
