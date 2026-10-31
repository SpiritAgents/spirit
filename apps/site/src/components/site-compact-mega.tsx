"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";

import { protectBrandTokens } from "@/components/no-translate";
import {
  DOCS_MOBILE_MEGA_CLOSE_EVENT,
  DOCS_MOBILE_MEGA_OPEN_EVENT,
  SITE_MEGA_PANEL_DURATION_MS,
  SITE_MEGA_PANEL_HEIGHT_TRANSITION,
  SITE_NAV_COMPACT_COLLAPSE_QUERY,
} from "@/lib/site-layout";
import { SITE_NAV_MENU_KEYS, type SiteNavMenu, type SiteNavMenuKey } from "@/lib/site-nav-menus";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { cn } from "@/lib/utils";

type CompactPanelKey = "root" | SiteNavMenuKey;

const COMPACT_PANEL_KEYS: CompactPanelKey[] = ["root", ...SITE_NAV_MENU_KEYS];
const ROOT_PANEL_KEYS: CompactPanelKey[] = ["root"];

const MEGA_ITEM_CLASS = cn(
  `block w-fit cursor-pointer rounded-sm text-[28px] ${FONT_WEIGHT_NORMAL} leading-[1.2] tracking-[-0.01em] text-foreground`,
  "transition-colors duration-150 hover:text-foreground/60",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
);

/**
 * Narrow-viewport mega menu: Explore (Features / Resources) plus optional extra
 * root content (docs tree). Nested panels cross-fade while height interpolates,
 * matching the desktop nav mega. The height box stays mounted at height 0 when
 * closed so the next open can animate from 0 instead of jumping to full height.
 */
export function SiteCompactMega({
  open,
  onClose,
  menus = [],
  exploreLabel,
  backLabel,
  frameClass,
  rootExtra,
  collapseQuery = SITE_NAV_COMPACT_COLLAPSE_QUERY,
}: {
  open: boolean;
  onClose: () => void;
  menus?: SiteNavMenu[];
  exploreLabel: string;
  backLabel: string;
  frameClass: string;
  rootExtra?: ReactNode;
  collapseQuery?: string;
}) {
  const [panel, setPanel] = useState<CompactPanelKey>("root");
  const [visiblePanel, setVisiblePanel] = useState<CompactPanelKey>("root");
  const [panelHeights, setPanelHeights] = useState<Record<CompactPanelKey, number>>({
    root: 0,
    features: 0,
    resources: 0,
  });
  const panelRefs = useRef<Record<CompactPanelKey, HTMLDivElement | null>>({
    root: null,
    features: null,
    resources: null,
  });
  const wasOpenRef = useRef(open);
  const [overlayTarget, setOverlayTarget] = useState<HTMLElement | null>(null);
  const hasExplore = menus.length > 0;
  const panelKeys = hasExplore ? COMPACT_PANEL_KEYS : ROOT_PANEL_KEYS;
  const activePanel: CompactPanelKey =
    panel !== "root" && !menus.some((menu) => menu.key === panel) ? "root" : panel;
  const visibleKey: CompactPanelKey =
    visiblePanel !== "root" && !menus.some((menu) => menu.key === visiblePanel)
      ? "root"
      : visiblePanel;

  useLayoutEffect(() => {
    setOverlayTarget(document.body);
  }, []);

  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      setPanel("root");
      setVisiblePanel("root");
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setVisiblePanel(panel);
      return;
    }
    const timer = window.setTimeout(() => {
      setPanel("root");
      setVisiblePanel("root");
    }, SITE_MEGA_PANEL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [open, panel]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setPanelHeights((current) => {
        let changed = false;
        const next = { ...current };
        for (const key of panelKeys) {
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
    for (const key of panelKeys) {
      const el = panelRefs.current[key];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [hasExplore]);

  useEffect(() => {
    if (open) {
      window.dispatchEvent(new Event(DOCS_MOBILE_MEGA_OPEN_EVENT));
    } else {
      window.dispatchEvent(new Event(DOCS_MOBILE_MEGA_CLOSE_EVENT));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const media = window.matchMedia(collapseQuery);
    const onChange = () => {
      if (media.matches) onClose();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [onClose, collapseQuery]);

  return (
    <>
      <div
        id="site-compact-mega"
        className="overflow-hidden"
        style={{
          height: open ? panelHeights[activePanel] : 0,
          maxHeight: "calc(100dvh - var(--site-nav-height))",
          transition: SITE_MEGA_PANEL_HEIGHT_TRANSITION,
        }}
      >
        <div className={cn("relative", frameClass)}>
          {panelKeys.map((key) => {
            const isOpen = open && activePanel === key;
            const isVisible = visibleKey === key;
            const menu = key === "root" ? undefined : menus.find((item) => item.key === key);
            if (key !== "root" && !menu) return null;
            return (
              <div
                key={key}
                ref={(el) => {
                  panelRefs.current[key] = el;
                }}
                aria-hidden={!isOpen}
                inert={isOpen ? undefined : true}
                className={cn(
                  "absolute inset-x-0 top-0 max-h-[calc(100dvh-var(--site-nav-height))] overflow-y-auto overscroll-contain pb-10 pt-6 transition-opacity duration-[250ms] ease-out",
                  isVisible ? "opacity-100" : "invisible opacity-0",
                  !isOpen && "pointer-events-none",
                )}
              >
                {key === "root" || !menu ? (
                  <CompactRootPanel
                    menus={menus}
                    exploreLabel={exploreLabel}
                    rootExtra={rootExtra}
                    onOpenMenu={setPanel}
                  />
                ) : (
                  <CompactNestedPanel
                    menu={menu}
                    backLabel={backLabel}
                    onBack={() => setPanel("root")}
                    onNavigate={onClose}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {overlayTarget
        ? createPortal(
            <div
              aria-hidden="true"
              onClick={onClose}
              className={cn(
                "fixed inset-0 z-30 bg-black/50 backdrop-blur-md transition-opacity duration-300",
                open ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            />,
            overlayTarget,
          )
        : null}
    </>
  );
}

function CompactRootPanel({
  menus,
  exploreLabel,
  rootExtra,
  onOpenMenu,
}: {
  menus: SiteNavMenu[];
  exploreLabel: string;
  rootExtra?: ReactNode;
  onOpenMenu: (key: SiteNavMenuKey) => void;
}) {
  return (
    <>
      {menus.length > 0 ? (
        <>
          <p className={`text-[13px] ${FONT_WEIGHT_NORMAL} leading-none text-site-muted`}>
            {exploreLabel}
          </p>
          <ul className="mt-4 flex flex-col items-start gap-2">
            {menus.map((menu) => (
              <li key={menu.key}>
                <button
                  type="button"
                  onClick={() => onOpenMenu(menu.key)}
                  className={MEGA_ITEM_CLASS}
                >
                  {menu.trigger}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rootExtra ? <div className={menus.length > 0 ? "mt-6" : undefined}>{rootExtra}</div> : null}
    </>
  );
}

function CompactNestedPanel({
  menu,
  backLabel,
  onBack,
  onNavigate,
}: {
  menu: SiteNavMenu;
  backLabel: string;
  onBack: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className={cn(
          `inline-flex items-center gap-2 rounded-sm text-[20px] ${FONT_WEIGHT_NORMAL} leading-[1.2] tracking-[-0.01em] text-foreground`,
          "cursor-pointer transition-colors duration-150 hover:text-foreground/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <ArrowLeft className="size-4" aria-hidden strokeWidth={1.75} />
        {backLabel}
      </button>
      <ul className="mt-4 flex flex-col items-start gap-2">
        {menu.links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              onClick={onNavigate}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={MEGA_ITEM_CLASS}
            >
              {protectBrandTokens(link.label)}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
