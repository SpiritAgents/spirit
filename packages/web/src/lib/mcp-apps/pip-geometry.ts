import { resizeCursor } from "@spiritagent/ui/resize-cursor";

export const MCP_APP_PIP_DEFAULT_WIDTH_PX = 380;
export const MCP_APP_PIP_DEFAULT_HEIGHT_PX = 320;
export const MCP_APP_PIP_MIN_WIDTH_PX = 280;
export const MCP_APP_PIP_MIN_HEIGHT_PX = 200;
export const MCP_APP_PIP_VIEWPORT_MARGIN_PX = 8;
export const MCP_APP_PIP_INITIAL_INSET_RIGHT_PX = 16;
export const MCP_APP_PIP_INITIAL_INSET_BOTTOM_PX = 96;
export const MCP_APP_PIP_CASCADE_STEP_PX = 24;

const MCP_APP_PIP_GEOMETRY_STORAGE_KEY = "spirit-desktop-mcp-app-pip-geometry";

export interface McpAppPipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface McpAppPipViewport {
  width: number;
  height: number;
  topInset?: number;
}

export type McpAppPipResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface McpAppPipViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export function readCurrentPipViewport(): McpAppPipViewport {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800, topInset: 0 };
  }
  return {
    width: Math.max(320, window.innerWidth || 1280),
    height: Math.max(240, window.innerHeight || 800),
    topInset: 0,
  };
}

export function computePipViewportBounds(viewport: McpAppPipViewport): McpAppPipViewportBounds {
  const margin = MCP_APP_PIP_VIEWPORT_MARGIN_PX;
  const minX = margin;
  const minY = Math.max(margin, Math.round(viewport.topInset ?? 0) + margin);
  const maxX = Math.max(minX + MCP_APP_PIP_MIN_WIDTH_PX, Math.round(viewport.width) - margin);
  const maxY = Math.max(minY + MCP_APP_PIP_MIN_HEIGHT_PX, Math.round(viewport.height) - margin);
  const availableWidth = Math.max(160, Math.round(viewport.width) - margin * 2);
  const availableHeight = Math.max(140, Math.round(viewport.height) - minY - margin);
  const minWidth = Math.min(MCP_APP_PIP_MIN_WIDTH_PX, availableWidth);
  const minHeight = Math.min(MCP_APP_PIP_MIN_HEIGHT_PX, availableHeight);
  return {
    minX,
    minY,
    maxX: Math.min(Math.round(viewport.width) - margin, Math.max(minX + minWidth, maxX)),
    maxY: Math.min(Math.round(viewport.height) - margin, Math.max(minY + minHeight, maxY)),
    minWidth,
    minHeight,
    maxWidth: availableWidth,
    maxHeight: availableHeight,
  };
}

export function clampPipRect(rect: McpAppPipRect, viewport: McpAppPipViewport): McpAppPipRect {
  const bounds = computePipViewportBounds(viewport);
  const width = Math.round(Math.min(bounds.maxWidth, Math.max(bounds.minWidth, rect.width)));
  const height = Math.round(Math.min(bounds.maxHeight, Math.max(bounds.minHeight, rect.height)));
  const maxLeft = Math.max(bounds.minX, bounds.maxX - width);
  const maxTop = Math.max(bounds.minY, bounds.maxY - height);
  const x = Math.round(Math.min(maxLeft, Math.max(bounds.minX, rect.x)));
  const y = Math.round(Math.min(maxTop, Math.max(bounds.minY, rect.y)));
  return { x, y, width, height };
}

export function computeInitialPipRect(
  viewport: McpAppPipViewport,
  preferred: McpAppPipRect | null = null,
  existingRects: readonly McpAppPipRect[] = [],
): McpAppPipRect {
  const base: McpAppPipRect = preferred
    ? { ...preferred }
    : {
        width: MCP_APP_PIP_DEFAULT_WIDTH_PX,
        height: MCP_APP_PIP_DEFAULT_HEIGHT_PX,
        x: viewport.width - MCP_APP_PIP_DEFAULT_WIDTH_PX - MCP_APP_PIP_INITIAL_INSET_RIGHT_PX,
        y: viewport.height - MCP_APP_PIP_DEFAULT_HEIGHT_PX - MCP_APP_PIP_INITIAL_INSET_BOTTOM_PX,
      };

  let candidate = clampPipRect(base, viewport);
  for (let step = 0; step < 8; step += 1) {
    const collides = existingRects.some(
      (other) => Math.abs(other.x - candidate.x) < 16 && Math.abs(other.y - candidate.y) < 16,
    );
    if (!collides) {
      break;
    }
    const shifted = clampPipRect(
      {
        ...candidate,
        x: candidate.x - MCP_APP_PIP_CASCADE_STEP_PX,
        y: candidate.y - MCP_APP_PIP_CASCADE_STEP_PX,
      },
      viewport,
    );
    if (shifted.x === candidate.x && shifted.y === candidate.y) {
      break;
    }
    candidate = shifted;
  }
  return candidate;
}

export function movePipRect(
  startRect: McpAppPipRect,
  deltaX: number,
  deltaY: number,
  viewport: McpAppPipViewport,
): McpAppPipRect {
  return clampPipRect(
    {
      x: startRect.x + deltaX,
      y: startRect.y + deltaY,
      width: startRect.width,
      height: startRect.height,
    },
    viewport,
  );
}

export function resizePipRect(
  startRect: McpAppPipRect,
  edge: McpAppPipResizeEdge,
  deltaX: number,
  deltaY: number,
  viewport: McpAppPipViewport,
): McpAppPipRect {
  const bounds = computePipViewportBounds(viewport);
  const startRight = startRect.x + startRect.width;
  const startBottom = startRect.y + startRect.height;

  let x = startRect.x;
  let y = startRect.y;
  let width = startRect.width;
  let height = startRect.height;

  if (edge.includes("e")) {
    const maxW = Math.min(bounds.maxWidth, bounds.maxX - startRect.x);
    width = Math.round(Math.min(maxW, Math.max(bounds.minWidth, startRect.width + deltaX)));
  } else if (edge.includes("w")) {
    const maxW = Math.min(bounds.maxWidth, startRight - bounds.minX);
    width = Math.round(Math.min(maxW, Math.max(bounds.minWidth, startRect.width - deltaX)));
    x = Math.round(startRight - width);
  }

  if (edge.includes("s")) {
    const maxH = Math.min(bounds.maxHeight, bounds.maxY - startRect.y);
    height = Math.round(Math.min(maxH, Math.max(bounds.minHeight, startRect.height + deltaY)));
  } else if (edge.includes("n")) {
    const maxH = Math.min(bounds.maxHeight, startBottom - bounds.minY);
    height = Math.round(Math.min(maxH, Math.max(bounds.minHeight, startRect.height - deltaY)));
    y = Math.round(startBottom - height);
  }

  return clampPipRect({ x, y, width, height }, viewport);
}

/**
 * Compute the native macOS-friendly resize cursor for each PiP edge/corner.
 * Side edges reuse `@spiritagent/ui/resize-cursor` so hitting the minimum/maximum
 * size or viewport edge flips to a single-headed blocked cursor (`e/w/n/s-resize`).
 */
export function pipResizeEdgeCursor(
  rect: McpAppPipRect,
  edge: McpAppPipResizeEdge,
  viewport: McpAppPipViewport,
): string {
  const bounds = computePipViewportBounds(viewport);
  const maxWidthE = Math.min(bounds.maxWidth, bounds.maxX - rect.x);
  const maxWidthW = Math.min(bounds.maxWidth, rect.x + rect.width - bounds.minX);
  const maxHeightS = Math.min(bounds.maxHeight, bounds.maxY - rect.y);
  const maxHeightN = Math.min(bounds.maxHeight, rect.y + rect.height - bounds.minY);

  if (edge === "e") {
    return resizeCursor(rect.width, bounds.minWidth, maxWidthE, "right");
  }
  if (edge === "w") {
    return resizeCursor(rect.width, bounds.minWidth, maxWidthW, "left");
  }
  if (edge === "s") {
    return resizeCursor(rect.height, bounds.minHeight, maxHeightS, "down");
  }
  if (edge === "n") {
    return resizeCursor(rect.height, bounds.minHeight, maxHeightN, "up");
  }

  const xGrow = edge.includes("e") ? "right" : "left";
  const yGrow = edge.includes("s") ? "down" : "up";
  const xMax = xGrow === "right" ? maxWidthE : maxWidthW;
  const yMax = yGrow === "down" ? maxHeightS : maxHeightN;
  const xLocked = bounds.minWidth >= xMax;
  const yLocked = bounds.minHeight >= yMax;
  if (xLocked && yLocked) {
    return "default";
  }
  if (xLocked) {
    return resizeCursor(rect.height, bounds.minHeight, yMax, yGrow);
  }
  if (yLocked) {
    return resizeCursor(rect.width, bounds.minWidth, xMax, xGrow);
  }
  return edge === "nw" || edge === "se" ? "nwse-resize" : "nesw-resize";
}

export function readMcpAppPipGeometry(storage?: Pick<Storage, "getItem">): McpAppPipRect | null {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    if (!store) {
      return null;
    }
    const raw = store.getItem(MCP_APP_PIP_GEOMETRY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<McpAppPipRect> | null;
    if (
      !parsed ||
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height) ||
      parsed.width <= 0 ||
      parsed.height <= 0
    ) {
      return null;
    }
    return {
      x: Math.round(parsed.x),
      y: Math.round(parsed.y),
      width: Math.round(parsed.width),
      height: Math.round(parsed.height),
    };
  } catch {
    return null;
  }
}

export function writeMcpAppPipGeometry(
  rect: McpAppPipRect,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    if (!store) {
      return;
    }
    store.setItem(
      MCP_APP_PIP_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }),
    );
  } catch {
    // ignore storage quota/availability failures
  }
}
