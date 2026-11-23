import { createContext, useContext, type ReactNode } from "react";

export interface AsyncBlockHeightCache {
  get(key: string): number | undefined;
  set(key: string, heightPx: number): void;
  clear(): void;
}

export function createAsyncBlockHeightCache(maxEntries = 400): AsyncBlockHeightCache {
  const map = new Map<string, number>();
  return {
    get(key: string): number | undefined {
      const value = map.get(key);
      if (value === undefined) {
        return undefined;
      }
      // Refresh LRU recency.
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key: string, heightPx: number): void {
      if (!Number.isFinite(heightPx) || heightPx <= 0) {
        return;
      }
      const rounded = Math.round(heightPx);
      map.delete(key);
      map.set(key, rounded);
      if (map.size > maxEntries) {
        const oldestKey = map.keys().next().value;
        if (oldestKey !== undefined) {
          map.delete(oldestKey);
        }
      }
    },
    clear(): void {
      map.clear();
    },
  };
}

export interface PendingAsyncRowResize {
  compensate: boolean;
  expiresAt: number;
}

/**
 * Single-source scroll-position adjustment decision for virtualized conversation rows.
 *
 * Normal rows keep TanStack Virtual's default policy unchanged. Rows with an active async
 * embedded-block height transition (Mermaid SVG resolution, MCP App size-changed) compensate
 * whenever the block started above the viewport's top edge—even during backward scroll—so
 * text below the async block never jumps downward when scrolling up.
 */
export function decideVirtualRowScrollAdjustment(params: {
  pendingAsyncResize: PendingAsyncRowResize | undefined;
  now: number;
  isFirstMeasure: boolean;
  itemStart: number;
  itemEnd: number;
  scrollOffsetWithAdj: number;
  scrollDirection: "forward" | "backward" | null;
}): boolean {
  if (params.pendingAsyncResize && params.now <= params.pendingAsyncResize.expiresAt) {
    return params.pendingAsyncResize.compensate;
  }
  return params.isFirstMeasure
    ? params.itemStart < params.scrollOffsetWithAdj
    : params.itemEnd <= params.scrollOffsetWithAdj && params.scrollDirection !== "backward";
}

export interface AsyncBlockScrollAnchorValue {
  /** Read the last measured rendered height (px) for a stable block key. */
  getCachedHeight(blockKey: string): number | undefined;
  /** Record the settled rendered height (px) so future virtual remounts reserve the exact size. */
  setCachedHeight(blockKey: string, heightPx: number): void;
  /**
   * Notify the virtualized list right before an async embedded block commits a height change.
   * Passing the block's DOM element lets the list check whether its top edge sits above the
   * scroll viewport's top edge before layout shifts.
   */
  notifyAsyncBlockWillResize(element: HTMLElement | null): void;
}

const AsyncBlockScrollAnchorContext = createContext<AsyncBlockScrollAnchorValue | null>(null);

export function AsyncBlockScrollAnchorProvider({
  value,
  children,
}: {
  value: AsyncBlockScrollAnchorValue;
  children: ReactNode;
}) {
  return (
    <AsyncBlockScrollAnchorContext.Provider value={value}>
      {children}
    </AsyncBlockScrollAnchorContext.Provider>
  );
}

export function useAsyncBlockScrollAnchor(): AsyncBlockScrollAnchorValue | null {
  return useContext(AsyncBlockScrollAnchorContext);
}
