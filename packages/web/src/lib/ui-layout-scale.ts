import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export const UI_LAYOUT_SCALE_STORAGE_KEY = "spirit-desktop-ui-layout-scale" as const;
export const UI_LAYOUT_SCALE_ROOT_ID = "spirit-ui-scale-root" as const;
export const DEFAULT_UI_LAYOUT_SCALE = 1;
export const UI_LAYOUT_SCALE_MIN = 0.8;
export const UI_LAYOUT_SCALE_MAX = 1.25;
export const UI_LAYOUT_SCALE_STEP = 0.1;

export function clampUiLayoutScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return Math.min(UI_LAYOUT_SCALE_MAX, Math.max(UI_LAYOUT_SCALE_MIN, scale));
}

export function normalizeUiLayoutScale(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  const parsed = typeof raw === "number" ? raw : Number.parseFloat(String(raw).trim());
  if (!Number.isFinite(parsed)) {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return clampUiLayoutScale(parsed);
}

export function getStoredUiLayoutScale(): number {
  if (typeof localStorage === "undefined") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return normalizeUiLayoutScale(localStorage.getItem(UI_LAYOUT_SCALE_STORAGE_KEY));
}

export function setStoredUiLayoutScale(scale: number): void {
  const normalized = clampUiLayoutScale(scale);
  if (normalized === DEFAULT_UI_LAYOUT_SCALE) {
    localStorage.removeItem(UI_LAYOUT_SCALE_STORAGE_KEY);
  } else {
    localStorage.setItem(UI_LAYOUT_SCALE_STORAGE_KEY, String(normalized));
  }
  flushDesktopRendererStorage();
}

/*
 * macOS traffic lights: the native cluster is 54×14px and does not follow page zoom.
 * Electron hiddenInset defaults to (12, 11), which sits tighter to the frame than Apple apps
 * and places the red button left of the sidebar item icons.
 * At scale=1, origin (16, 16) matches typical Apple chrome inset and puts the red button on
 * the same vertical axis as those icons (container px-1.5 + sm button px-2.5 + size-3.5/2).
 * After zooming, x keeps that red-button/icon alignment; y scales the top inset.
 */
const DARWIN_TRAFFIC_LIGHTS_BUTTON_SIZE = 14;
/** Sidebar item icon center at scale=1. */
const DARWIN_SIDEBAR_ITEM_ICON_CENTER_X = 23;
const DARWIN_TRAFFIC_LIGHTS_INSET_Y = 16;

export function computeDarwinTrafficLightPosition(scale: number): { x: number; y: number } {
  const s = clampUiLayoutScale(scale);
  return {
    x: Math.round(DARWIN_SIDEBAR_ITEM_ICON_CENTER_X * s - DARWIN_TRAFFIC_LIGHTS_BUTTON_SIZE / 2),
    y: Math.round(DARWIN_TRAFFIC_LIGHTS_INSET_Y * s),
  };
}

let darwinTrafficLightSyncFrame: number | null = null;

/**
 * After the zoom is written to the webContents, layout paints on the next frame.
 * Native setWindowButtonPosition is deferred to the same rAF so traffic lights
 * move with the zoomed chrome instead of jumping first.
 * A single pending rAF also coalesces duplicate updater/useLayoutEffect calls within the same keypress.
 */
function syncDarwinTrafficLightPosition(scale: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const api = window.spiritDesktop;
  if (!api || api.platform !== "darwin") {
    return;
  }
  if (darwinTrafficLightSyncFrame !== null) {
    window.cancelAnimationFrame(darwinTrafficLightSyncFrame);
  }
  darwinTrafficLightSyncFrame = window.requestAnimationFrame(() => {
    darwinTrafficLightSyncFrame = null;
    void api.syncTrafficLightPosition(computeDarwinTrafficLightPosition(scale));
  });
}

function getScaleRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById(UI_LAYOUT_SCALE_ROOT_ID);
}

/** Radix overlays are portaled into the scale root so they share the app shell's stacking and clipping context. */
export function getUiLayoutPortalContainer(): HTMLElement | undefined {
  return getScaleRoot() ?? undefined;
}

let lastAppliedUiLayoutScale: number | null = null;

/**
 * Applies the UI layout zoom via the native Chromium page zoom (webFrame.setZoomFactor in the
 * preload), which lands in the same task as the keypress and re-rasterizes canvas content
 * (xterm WebGL renderer, Monaco minimap, image previews) at the zoomed resolution. A CSS
 * transform scale would instead bitmap-scale canvases and blur them while DOM text stays sharp.
 */
export function applyUiLayoutScale(scale: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = clampUiLayoutScale(scale);
  if (lastAppliedUiLayoutScale === normalized) {
    return;
  }
  lastAppliedUiLayoutScale = normalized;
  syncDarwinTrafficLightPosition(normalized);
  void window.spiritDesktop?.setUiLayoutScale(normalized);
}

export function stepUiLayoutScale(current: number, direction: "in" | "out"): number {
  const base = clampUiLayoutScale(current);
  const stepped = direction === "in" ? base + UI_LAYOUT_SCALE_STEP : base - UI_LAYOUT_SCALE_STEP;
  return clampUiLayoutScale(stepped);
}

export function formatUiLayoutScalePercent(scale: number): string {
  return `${Math.round(clampUiLayoutScale(scale) * 100)}%`;
}

export function resolveUiLayoutZoomShortcutAction(input: {
  defaultPrevented: boolean;
  modPressed: boolean;
  altKey: boolean;
  key: string;
}): "in" | "out" | "reset" | null {
  if (input.defaultPrevented || !input.modPressed || input.altKey) {
    return null;
  }

  const key = input.key;
  if (key === "=" || key === "+") {
    return "in";
  }
  if (key === "-" || key === "_") {
    return "out";
  }
  if (key === "0") {
    return "reset";
  }
  return null;
}
