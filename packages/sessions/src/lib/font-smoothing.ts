import { flushDesktopRendererStorage } from "./desktop-renderer-storage";
import { isMacDesktopPlatform } from "./desktop-shell";

export const FONT_SMOOTHING_STORAGE_KEY = "spirit-desktop-font-smoothing" as const;

export const FONT_SMOOTHING_CLASS = "spirit-font-smoothing" as const;

/**
 * macOS desktop defaults on; other platforms stay off until explicitly enabled.
 * iOS / iPadOS are not macOS desktop (`isMacDesktopPlatform`): they already use
 * grayscale antialiasing, so `-webkit-font-smoothing: antialiased` does not change
 * rendering and the Settings row must stay hidden.
 */
export function defaultFontSmoothing(): boolean {
  return isMacDesktopPlatform();
}

export function getStoredFontSmoothing(): boolean {
  if (typeof localStorage === "undefined") {
    return defaultFontSmoothing();
  }
  const stored = localStorage.getItem(FONT_SMOOTHING_STORAGE_KEY);
  if (stored === null) {
    return defaultFontSmoothing();
  }
  return stored === "true";
}

export function setStoredFontSmoothing(enabled: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(FONT_SMOOTHING_STORAGE_KEY, enabled ? "true" : "false");
  flushDesktopRendererStorage();
}

export function applyFontSmoothingToDocument(enabled: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(FONT_SMOOTHING_CLASS, enabled);
}
