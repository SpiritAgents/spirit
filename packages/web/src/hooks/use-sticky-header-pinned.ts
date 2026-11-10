import { useEffect, useState, type ComponentRef, type RefObject } from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";

export function scrollAreaViewport(
  root: ComponentRef<typeof ScrollArea> | null,
): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

/**
 * Tracks whether a sticky header is currently pinned to the top of its scroll
 * viewport. Place a zero-height sentinel (`h-px -mb-px`) immediately before the
 * sticky element; when the sentinel scrolls out of the viewport, the header is
 * pinned. `enabled` must toggle across unmount/remount cycles (e.g. view
 * switches) so the observer re-attaches to the new DOM nodes.
 */
export function useStickyHeaderPinned(
  sentinelRef: RefObject<HTMLElement | null>,
  getScrollViewport: () => HTMLElement | null,
  enabled: boolean,
): boolean {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPinned(false);
      return;
    }

    const sentinel = sentinelRef.current;
    const root = getScrollViewport();
    if (!sentinel || !root) {
      setPinned(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPinned(!entry.isIntersecting);
      },
      { root, threshold: [0] },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, getScrollViewport, sentinelRef]);

  return pinned;
}
