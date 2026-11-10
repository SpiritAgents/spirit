import type { MarqueeRect } from "@/lib/browser-element-picker";
import type { PaneDropZone, PaneRepositionZone } from "@/lib/conversation-split-layout";

/** 2×2 grid: TL above, TR after, BL before, BR below. Used when pane reorder has no adjacent source. */
export const PANE_DROP_ZONE_ORDER: readonly PaneRepositionZone[] = [
  "above",
  "after",
  "before",
  "below",
];

/**
 * Sidebar session drag: left/right edge columns (full height) + center column (above/below).
 * Indicators tile the full left/right/top/bottom half — not quadrant corners.
 */
export const SIDEBAR_SESSION_DROP_ZONE_ORDER: readonly PaneRepositionZone[] = [
  "before",
  "above",
  "after",
  "below",
];

export function visiblePaneDropZonesForSidebarSessionDrag(): readonly PaneRepositionZone[] {
  return SIDEBAR_SESSION_DROP_ZONE_ORDER;
}

export const PANE_DROP_ZONE_GRID_CLASS: Record<PaneRepositionZone, string> = {
  above: "col-start-1 row-start-1",
  after: "col-start-2 row-start-1",
  before: "col-start-1 row-start-2",
  below: "col-start-2 row-start-2",
};

const PANE_DROP_ZONE_SIDEBAR_SPLIT_CLASS: Record<PaneRepositionZone, string> = {
  before: "col-start-1 row-span-2 row-start-1",
  above: "col-start-2 row-start-1",
  after: "col-start-3 row-span-2 row-start-1",
  below: "col-start-2 row-start-2",
};

const PANE_DROP_ZONE_TRIPLE_ROW_CLASS: Record<"above" | "swap" | "below", string> = {
  above: "col-start-1 row-start-1",
  swap: "col-start-1 row-start-2",
  below: "col-start-1 row-start-3",
};

const PANE_DROP_ZONE_TRIPLE_COL_CLASS: Record<"before" | "swap" | "after", string> = {
  before: "col-start-1 row-start-1",
  swap: "col-start-2 row-start-1",
  after: "col-start-3 row-start-1",
};

/** Two-pane drag: hide the target edge facing the source (e.g. source on the right → hide after + below). */
export function hiddenPaneDropZonesForTwoPaneDrag(
  sourceRect: DOMRect,
  targetRect: DOMRect,
): ReadonlySet<PaneRepositionZone> {
  const sourceCx = sourceRect.left + sourceRect.width / 2;
  const sourceCy = sourceRect.top + sourceRect.height / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;
  const dx = sourceCx - targetCx;
  const dy = sourceCy - targetCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) {
      return new Set(["after", "below"]);
    }
    return new Set(["above", "before"]);
  }

  if (dy > 0) {
    return new Set(["before", "below"]);
  }
  return new Set(["above", "after"]);
}

function twoPaneAdjacencyOrientation(
  sourceRect: DOMRect,
  targetRect: DOMRect,
): "horizontal" | "vertical" {
  const sourceCx = sourceRect.left + sourceRect.width / 2;
  const sourceCy = sourceRect.top + sourceRect.height / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;
  const dx = Math.abs(sourceCx - targetCx);
  const dy = Math.abs(sourceCy - targetCy);
  return dx >= dy ? "horizontal" : "vertical";
}

const ADJACENCY_TOLERANCE_PX = 4;

/** True when two pane hosts share a screen edge (siblings in the layout chrome). */
export function arePaneHostsAdjacent(sourceRect: DOMRect, targetRect: DOMRect): boolean {
  const overlapX =
    Math.min(sourceRect.right, targetRect.right) - Math.max(sourceRect.left, targetRect.left);
  const overlapY =
    Math.min(sourceRect.bottom, targetRect.bottom) - Math.max(sourceRect.top, targetRect.top);
  const verticalEdgeTouch =
    Math.abs(sourceRect.right - targetRect.left) <= ADJACENCY_TOLERANCE_PX ||
    Math.abs(sourceRect.left - targetRect.right) <= ADJACENCY_TOLERANCE_PX;
  const horizontalEdgeTouch =
    Math.abs(sourceRect.bottom - targetRect.top) <= ADJACENCY_TOLERANCE_PX ||
    Math.abs(sourceRect.top - targetRect.bottom) <= ADJACENCY_TOLERANCE_PX;

  if (verticalEdgeTouch && overlapY > ADJACENCY_TOLERANCE_PX) {
    return true;
  }
  if (horizontalEdgeTouch && overlapX > ADJACENCY_TOLERANCE_PX) {
    return true;
  }
  return false;
}

export function visiblePaneDropZonesForDrag(input: {
  paneCount: number;
  sourcePaneHost: HTMLElement | null;
  targetPaneHost: HTMLElement | null;
}): readonly PaneDropZone[] {
  if (!input.sourcePaneHost || !input.targetPaneHost) {
    return PANE_DROP_ZONE_ORDER;
  }

  const sourceRect = input.sourcePaneHost.getBoundingClientRect();
  const targetRect = input.targetPaneHost.getBoundingClientRect();
  if (!arePaneHostsAdjacent(sourceRect, targetRect)) {
    return PANE_DROP_ZONE_ORDER;
  }

  if (twoPaneAdjacencyOrientation(sourceRect, targetRect) === "horizontal") {
    return ["above", "swap", "below"];
  }
  return ["before", "swap", "after"];
}

type VisibleZoneLayout =
  | "top-bottom"
  | "left-right"
  | "triple-row"
  | "triple-col"
  | "sidebar-split";

function isSidebarSplitZoneSet(visibleZones: readonly PaneDropZone[]): boolean {
  const set = new Set(visibleZones);
  return (
    visibleZones.length === 4 &&
    set.has("before") &&
    set.has("after") &&
    set.has("above") &&
    set.has("below") &&
    !set.has("swap")
  );
}

function visibleZoneLayout(visibleZones: readonly PaneDropZone[]): VisibleZoneLayout | null {
  if (isSidebarSplitZoneSet(visibleZones)) {
    return "sidebar-split";
  }
  const set = new Set(visibleZones);
  if (set.has("swap") && set.has("above") && set.has("below")) {
    return "triple-row";
  }
  if (set.has("swap") && set.has("before") && set.has("after")) {
    return "triple-col";
  }
  if (visibleZones.length !== 2) {
    return null;
  }
  if (set.has("above") && set.has("before")) {
    return "top-bottom";
  }
  if (set.has("after") && set.has("below")) {
    return "top-bottom";
  }
  if (set.has("above") && set.has("after")) {
    return "left-right";
  }
  if (set.has("before") && set.has("below")) {
    return "left-right";
  }
  return null;
}

/**
 * When two zones are expanded to a half-pane pair, grid cell labels (e.g. below = BR)
 * no longer match reposition semantics (below = vertical). Map to before/after/above/below.
 */
export function effectiveRepositionZone(
  zone: PaneDropZone,
  visibleZones: readonly PaneDropZone[],
): PaneRepositionZone {
  if (zone === "swap") {
    throw new Error("effectiveRepositionZone does not apply to swap");
  }
  const layout = visibleZoneLayout(visibleZones);
  if (layout === "left-right") {
    if (zone === "above" || zone === "before") {
      return "before";
    }
    if (zone === "after" || zone === "below") {
      return "after";
    }
  }
  if (layout === "top-bottom") {
    if (zone === "above" || zone === "after") {
      return "above";
    }
    if (zone === "before" || zone === "below") {
      return "below";
    }
  }
  return zone;
}

/** Hit-target band weights: edges 2fr each, swap center 1fr → 40% / 20% / 40%. */
const TRIPLE_EDGE_FR = 2;
const SWAP_BAND_FR = 1;
const TRIPLE_BAND_TOTAL_FR = TRIPLE_EDGE_FR * 2 + SWAP_BAND_FR;

function tripleBandSizes(length: number): { edge: number; swap: number } {
  const swap = length * (SWAP_BAND_FR / TRIPLE_BAND_TOTAL_FR);
  const edge = (length - swap) / 2;
  return { edge, swap };
}

function sidebarSplitColBandSizes(width: number): { edge: number; center: number } {
  const center = width * (SWAP_BAND_FR / TRIPLE_BAND_TOTAL_FR);
  const edge = (width - center) / 2;
  return { edge, center };
}

function sidebarSplitHitRect(hostRect: DOMRect, zone: PaneRepositionZone): MarqueeRect {
  const left = hostRect.left;
  const top = hostRect.top;
  const width = hostRect.width;
  const height = hostRect.height;
  const { edge: edgeW, center: centerW } = sidebarSplitColBandSizes(width);
  const halfH = height / 2;
  const centerLeft = left + edgeW;

  switch (zone) {
    case "before":
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(edgeW),
        height: Math.round(height),
      };
    case "after":
      return {
        x: Math.round(left + edgeW + centerW),
        y: Math.round(top),
        width: Math.round(edgeW),
        height: Math.round(height),
      };
    case "above":
      return {
        x: Math.round(centerLeft),
        y: Math.round(top),
        width: Math.round(centerW),
        height: Math.round(halfH),
      };
    case "below":
      return {
        x: Math.round(centerLeft),
        y: Math.round(top + halfH),
        width: Math.round(centerW),
        height: Math.round(halfH),
      };
  }
}

function sidebarSplitIndicatorRect(hostRect: DOMRect, zone: PaneRepositionZone): MarqueeRect {
  const left = hostRect.left;
  const top = hostRect.top;
  const width = hostRect.width;
  const height = hostRect.height;
  const halfW = width / 2;
  const halfH = height / 2;

  switch (zone) {
    case "before":
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(halfW),
        height: Math.round(height),
      };
    case "after":
      return {
        x: Math.round(left + halfW),
        y: Math.round(top),
        width: Math.round(halfW),
        height: Math.round(height),
      };
    case "above":
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(halfH),
      };
    case "below":
      return {
        x: Math.round(left),
        y: Math.round(top + halfH),
        width: Math.round(width),
        height: Math.round(halfH),
      };
  }
}

export function paneDropZoneGridLayoutClass(visibleZones: readonly PaneDropZone[]): string {
  const layout = visibleZoneLayout(visibleZones);
  if (layout === "sidebar-split") {
    return `grid-cols-[${TRIPLE_EDGE_FR}fr_${SWAP_BAND_FR}fr_${TRIPLE_EDGE_FR}fr] grid-rows-2`;
  }
  if (layout === "triple-row" || layout === "top-bottom") {
    return `grid-cols-1 grid-rows-[${TRIPLE_EDGE_FR}fr_${SWAP_BAND_FR}fr_${TRIPLE_EDGE_FR}fr]`;
  }
  if (layout === "triple-col" || layout === "left-right") {
    return `grid-cols-[${TRIPLE_EDGE_FR}fr_${SWAP_BAND_FR}fr_${TRIPLE_EDGE_FR}fr] grid-rows-1`;
  }
  return "grid-cols-2 grid-rows-2";
}

export function paneDropZoneGridCellClass(
  zone: PaneDropZone,
  visibleZones: readonly PaneDropZone[],
): string | undefined {
  const layout = visibleZoneLayout(visibleZones);
  if (
    layout === "sidebar-split" &&
    (zone === "before" || zone === "above" || zone === "after" || zone === "below")
  ) {
    return PANE_DROP_ZONE_SIDEBAR_SPLIT_CLASS[zone];
  }
  if (layout === "triple-row" && (zone === "above" || zone === "swap" || zone === "below")) {
    return PANE_DROP_ZONE_TRIPLE_ROW_CLASS[zone];
  }
  if (layout === "triple-col" && (zone === "before" || zone === "swap" || zone === "after")) {
    return PANE_DROP_ZONE_TRIPLE_COL_CLASS[zone];
  }
  if (zone === "swap") {
    return undefined;
  }
  return PANE_DROP_ZONE_GRID_CLASS[zone];
}

export function paneDropZoneRect(
  hostRect: DOMRect,
  zone: PaneDropZone,
  visibleZones: readonly PaneDropZone[] = PANE_DROP_ZONE_ORDER,
): MarqueeRect {
  const left = hostRect.left;
  const top = hostRect.top;
  const width = hostRect.width;
  const height = hostRect.height;
  const halfW = width / 2;
  const halfH = height / 2;
  const layout = visibleZoneLayout(visibleZones);

  if (layout === "sidebar-split" && zone !== "swap") {
    return sidebarSplitHitRect(hostRect, zone);
  }

  if (layout === "triple-row") {
    const { edge: edgeH, swap: swapH } = tripleBandSizes(height);
    if (zone === "above") {
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(edgeH),
      };
    }
    if (zone === "below") {
      return {
        x: Math.round(left),
        y: Math.round(top + edgeH + swapH),
        width: Math.round(width),
        height: Math.round(edgeH),
      };
    }
    if (zone === "swap") {
      return {
        x: Math.round(left),
        y: Math.round(top + edgeH),
        width: Math.round(width),
        height: Math.round(swapH),
      };
    }
    return {
      x: Math.round(left),
      y: Math.round(top + edgeH),
      width: Math.round(width),
      height: Math.round(swapH),
    };
  }

  if (layout === "triple-col") {
    const { edge: edgeW, swap: swapW } = tripleBandSizes(width);
    if (zone === "before") {
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(edgeW),
        height: Math.round(height),
      };
    }
    if (zone === "after") {
      return {
        x: Math.round(left + edgeW + swapW),
        y: Math.round(top),
        width: Math.round(edgeW),
        height: Math.round(height),
      };
    }
    if (zone === "swap") {
      return {
        x: Math.round(left + edgeW),
        y: Math.round(top),
        width: Math.round(swapW),
        height: Math.round(height),
      };
    }
    return {
      x: Math.round(left + edgeW),
      y: Math.round(top),
      width: Math.round(swapW),
      height: Math.round(height),
    };
  }

  if (layout === "top-bottom") {
    if (zone === "above" || zone === "after") {
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(halfH),
      };
    }
    return {
      x: Math.round(left),
      y: Math.round(top + halfH),
      width: Math.round(width),
      height: Math.round(halfH),
    };
  }

  if (layout === "left-right") {
    if (zone === "above" || zone === "before") {
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(halfW),
        height: Math.round(height),
      };
    }
    return {
      x: Math.round(left + halfW),
      y: Math.round(top),
      width: Math.round(halfW),
      height: Math.round(height),
    };
  }

  switch (zone) {
    case "above":
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(halfW),
        height: Math.round(halfH),
      };
    case "after":
      return {
        x: Math.round(left + halfW),
        y: Math.round(top),
        width: Math.round(halfW),
        height: Math.round(halfH),
      };
    case "before":
      return {
        x: Math.round(left),
        y: Math.round(top + halfH),
        width: Math.round(halfW),
        height: Math.round(halfH),
      };
    case "below":
      return {
        x: Math.round(left + halfW),
        y: Math.round(top + halfH),
        width: Math.round(halfW),
        height: Math.round(halfH),
      };
    case "swap":
      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      };
  }
}

/** Indicator geometry: swap always highlights the full target pane. */
export function paneDropIndicatorRect(
  hostRect: DOMRect,
  zone: PaneDropZone,
  visibleZones: readonly PaneDropZone[],
): MarqueeRect {
  if (zone === "swap") {
    return {
      x: Math.round(hostRect.left),
      y: Math.round(hostRect.top),
      width: Math.round(hostRect.width),
      height: Math.round(hostRect.height),
    };
  }
  if (visibleZoneLayout(visibleZones) === "sidebar-split") {
    return sidebarSplitIndicatorRect(hostRect, zone);
  }
  return paneDropZoneRect(hostRect, zone, visibleZones);
}
