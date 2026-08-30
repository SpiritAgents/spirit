import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export const UI_LAYOUT_SCALE_STORAGE_KEY = "spirit-desktop-ui-layout-scale" as const;
export const SPIRIT_UI_LAYOUT_SCALE_VAR = "--spirit-ui-layout-scale" as const;
export const UI_LAYOUT_SCALE_ROOT_ID = "spirit-ui-scale-root" as const;
export const UI_LAYOUT_SCALED_BODY_CLASS = "spirit-ui-layout-scaled" as const;
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
 * macOS traffic lights: the native cluster is 54×14px and does not follow CSS layout scale.
 * Electron hiddenInset defaults to (12, 11), which sits tighter to the frame than Apple apps
 * and places the red button left of the sidebar item icons.
 * At scale=1, origin (16, 16) matches typical Apple chrome inset and puts the red button on
 * the same vertical axis as those icons (container px-1.5 + sm button px-2.5 + size-3.5/2).
 * After scaling, x keeps that red-button/icon alignment; y scales the top inset.
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
 * After CSS scaling is written to the DOM, layout paints on the next frame.
 * Native setWindowButtonPosition is deferred to the same rAF so traffic lights
 * move with the scaled chrome instead of jumping first.
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

function shouldApplyWin32TitleBarCounterZoom(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const electron = Boolean(window.spiritDesktop) || /\bElectron\//.test(navigator.userAgent);
  if (!electron) {
    return false;
  }
  // Aligned with isWin32ElectronShell: preload platform first, otherwise UA fallback
  return window.spiritDesktop?.platform === "win32" || /Windows/i.test(navigator.userAgent);
}

function getScaleRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById(UI_LAYOUT_SCALE_ROOT_ID);
}

/** Radix overlays must be portaled into the same scale root as the main UI, otherwise a body transform offsets fixed positioning. */
export function getUiLayoutPortalContainer(): HTMLElement | undefined {
  return getScaleRoot() ?? undefined;
}

export function getCurrentUiLayoutScale(): number {
  if (typeof document === "undefined") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(SPIRIT_UI_LAYOUT_SCALE_VAR)
    .trim();
  const parsed = raw ? Number.parseFloat(raw) : DEFAULT_UI_LAYOUT_SCALE;
  return Number.isFinite(parsed) ? parsed : DEFAULT_UI_LAYOUT_SCALE;
}

/** Whether the scale root carries a transform (`.spirit-ui-layout-scaled`); without a transform, fixed elements inside it use viewport coordinates. */
export function isUiLayoutScaleTransformActive(): boolean {
  const scaleRoot = getScaleRoot();
  if (!scaleRoot) {
    return false;
  }
  return scaleRoot.classList.contains(UI_LAYOUT_SCALED_BODY_CLASS);
}

/** Viewport coordinates → position:fixed local coordinates inside the scale root (conversion only needed when the transform is active). */
export function viewportPointToScaleRootLocal(
  viewportTop: number,
  viewportLeft: number,
): { top: number; left: number } {
  const scaleRoot = getScaleRoot();
  const isScaled = isUiLayoutScaleTransformActive();
  if (!scaleRoot || !isScaled) {
    return { top: viewportTop, left: viewportLeft };
  }
  const scale = getCurrentUiLayoutScale();
  const scaleRootRect = scaleRoot.getBoundingClientRect();
  return {
    top: (viewportTop - scaleRootRect.top) / scale,
    left: (viewportLeft - scaleRootRect.left) / scale,
  };
}

export type ViewportBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Viewport rect → fixed anchor box inside the scale root (custom Radix triggers must use the same conversion as tooltip). */
export function viewportRectToScaleRootLocal(rect: ViewportBox): ViewportBox {
  if (!isUiLayoutScaleTransformActive()) {
    return rect;
  }
  const scale = getCurrentUiLayoutScale();
  const { top, left } = viewportPointToScaleRootLocal(rect.top, rect.left);
  return {
    left,
    top,
    width: Math.max(rect.width / scale, 1),
    height: Math.max(rect.height / scale, 1),
  };
}

/** getBoundingClientRect deltas / edge lengths within the same scale root → local CSS lengths (for shell divider positioning). */
export function viewportLengthToScaleRootLocal(length: number): number {
  if (!isUiLayoutScaleTransformActive()) {
    return length;
  }
  return length / getCurrentUiLayoutScale();
}

function syncWin32ChromeClass(root: HTMLElement): void {
  root.classList.toggle("spirit-desktop-win32", shouldApplyWin32TitleBarCounterZoom());
}

let lastAppliedUiLayoutScale: number | null = null;
let pendingUiLayoutScaleResizeFrame: number | null = null;

function scheduleUiLayoutScaleResize(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (pendingUiLayoutScaleResizeFrame !== null) {
    return;
  }
  pendingUiLayoutScaleResizeFrame = window.requestAnimationFrame(() => {
    pendingUiLayoutScaleResizeFrame = null;
    window.dispatchEvent(new Event("resize"));
  });
}

export function applyUiLayoutScaleToDocument(scale: number): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = clampUiLayoutScale(scale);
  const root = document.documentElement;
  const scaleRoot = getScaleRoot();

  syncWin32ChromeClass(root);

  if (!scaleRoot) {
    return;
  }

  if (lastAppliedUiLayoutScale === normalized) {
    return;
  }

  syncDarwinTrafficLightPosition(normalized);

  if (normalized === DEFAULT_UI_LAYOUT_SCALE) {
    root.style.removeProperty(SPIRIT_UI_LAYOUT_SCALE_VAR);
    scaleRoot.classList.remove(UI_LAYOUT_SCALED_BODY_CLASS);
  } else {
    root.style.setProperty(SPIRIT_UI_LAYOUT_SCALE_VAR, String(normalized));
    scaleRoot.classList.add(UI_LAYOUT_SCALED_BODY_CLASS);
  }
  lastAppliedUiLayoutScale = normalized;
  scheduleUiLayoutScaleResize();
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
