"use client";

import type { Item, Node } from "fumadocs-core/page-tree";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTreeContext } from "fumadocs-ui/contexts/tree";
import { useSidebar } from "fumadocs-ui/components/sidebar/base";

import { SiteCompactMega } from "@/components/site-compact-mega";
import { useI18n } from "@/i18n/provider";
import {
  DOCS_FRAME_CLASS,
  DOCS_MOBILE_MEGA_ROOT_ID,
  DOCS_MOBILE_MEGA_TOGGLE_EVENT,
  consumeDocsMegaToggleIfPending,
  DOCS_SIDEBAR_DRAWER_COLLAPSE_QUERY,
  DOCS_SIDEBAR_DRAWER_QUERY,
  SITE_NAV_COMPACT_QUERY,
  SITE_NAV_MENU_OPEN_EVENT,
} from "@/lib/site-layout";
import { getSiteNavMenus } from "@/lib/site-nav-menus";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

function subscribeToMegaRoot(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function DocsMobileSidebarHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      id="nd-subnav"
      className={cn(
        "[grid-area:header] pointer-events-none z-30 md:hidden max-md:layout:[--fd-header-height:0px]",
        className,
      )}
      {...props}
    >
      <DocsMobileMega />
    </header>
  );
}

function DocsMobileMega() {
  const { open, setOpen } = useSidebar();
  const { root } = useTreeContext();
  const { messages, localizedPath } = useI18n();
  const megaRoot = useSyncExternalStore(
    subscribeToMegaRoot,
    () => document.getElementById(DOCS_MOBILE_MEGA_ROOT_ID),
    () => null,
  );
  const includeExplore = useMediaQuery(SITE_NAV_COMPACT_QUERY);
  const isDrawer = useMediaQuery(DOCS_SIDEBAR_DRAWER_QUERY);
  const menus = getSiteNavMenus(messages.hero.nav, localizedPath);

  const closeOnDesktop = useEffectEvent(() => {
    if (open) {
      setOpen(false);
    }
  });
  useEffect(() => {
    if (isDrawer || !open) {
      return;
    }
    const frame = requestAnimationFrame(() => closeOnDesktop());
    return () => cancelAnimationFrame(frame);
  }, [isDrawer, open]);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(SITE_NAV_MENU_OPEN_EVENT, close);
    return () => window.removeEventListener(SITE_NAV_MENU_OPEN_EVENT, close);
  }, [setOpen]);

  useEffect(() => {
    const toggle = () => {
      consumeDocsMegaToggleIfPending();
      setOpen((current) => !current);
    };
    window.addEventListener(DOCS_MOBILE_MEGA_TOGGLE_EVENT, toggle);
    if (consumeDocsMegaToggleIfPending()) setOpen((current) => !current);
    return () => window.removeEventListener(DOCS_MOBILE_MEGA_TOGGLE_EVENT, toggle);
  }, [setOpen]);

  if (!megaRoot || !isDrawer) return null;

  return createPortal(
    <SiteCompactMega
      open={open}
      onClose={() => setOpen(false)}
      menus={includeExplore ? menus : []}
      exploreLabel={messages.hero.nav.explore}
      backLabel={messages.hero.nav.back}
      frameClass={DOCS_FRAME_CLASS}
      collapseQuery={DOCS_SIDEBAR_DRAWER_COLLAPSE_QUERY}
      rootExtra={<DocsMobileMegaNodes nodes={root.children} onNavigate={() => setOpen(false)} />}
    />,
    megaRoot,
  );
}

function DocsMobileMegaLink({ item, onNavigate }: { item: Item; onNavigate: () => void }) {
  return (
    <a
      href={item.url}
      onClick={onNavigate}
      {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        `block w-fit rounded-sm text-[28px] ${FONT_WEIGHT_NORMAL} leading-[1.2] tracking-[-0.01em] text-foreground`,
        "transition-colors duration-150 hover:text-foreground/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {item.name}
    </a>
  );
}

function DocsMobileMegaNodes({ nodes, onNavigate }: { nodes: Node[]; onNavigate: () => void }) {
  const parts: ReactNode[] = [];
  let batch: Item[] = [];

  const flush = (key: string) => {
    if (batch.length === 0) return;
    const items = batch;
    batch = [];
    parts.push(
      <ul key={key} className="mt-4 flex flex-col items-start gap-2 first:mt-0">
        {items.map((item) => (
          <li key={item.url}>
            <DocsMobileMegaLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>,
    );
  };

  nodes.forEach((node, index) => {
    if (node.type === "page") {
      batch.push(node);
      return;
    }
    flush(`pages-${index}`);
    if (node.type === "separator") {
      parts.push(
        <p
          key={node.$id ?? `sep-${index}`}
          className={`mt-6 text-[13px] first:mt-0 ${FONT_WEIGHT_NORMAL} leading-none text-site-muted`}
        >
          {node.name}
        </p>,
      );
      return;
    }
    parts.push(
      <div key={node.$id ?? `folder-${index}`} className="mt-6 first:mt-0">
        <p className={`text-[13px] ${FONT_WEIGHT_NORMAL} leading-none text-site-muted`}>
          {node.name}
        </p>
        {node.index ? (
          <ul className="mt-4 flex flex-col items-start gap-2">
            <li>
              <DocsMobileMegaLink item={node.index} onNavigate={onNavigate} />
            </li>
          </ul>
        ) : null}
        <DocsMobileMegaNodes nodes={node.children} onNavigate={onNavigate} />
      </div>,
    );
  });
  flush("pages-end");
  return parts;
}
