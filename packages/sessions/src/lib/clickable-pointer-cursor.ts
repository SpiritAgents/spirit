import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export const CLICKABLE_POINTER_CURSOR_STORAGE_KEY = "spirit-desktop-clickable-pointer" as const;

export const CLICKABLE_POINTER_CURSOR_CLASS = "spirit-clickable-pointer" as const;

/**
 * The workbench defaults to the arrow cursor on every host, matching native
 * desktop application conventions rather than browser-page conventions.
 */
export function defaultClickablePointerCursor(): boolean {
  return false;
}

export function getStoredClickablePointerCursor(): boolean {
  if (typeof localStorage === "undefined") {
    return defaultClickablePointerCursor();
  }
  const stored = localStorage.getItem(CLICKABLE_POINTER_CURSOR_STORAGE_KEY);
  if (stored === null) {
    return defaultClickablePointerCursor();
  }
  return stored === "true";
}

export function setStoredClickablePointerCursor(enabled: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(CLICKABLE_POINTER_CURSOR_STORAGE_KEY, enabled ? "true" : "false");
  flushDesktopRendererStorage();
}

export function applyClickablePointerCursorToDocument(enabled: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(CLICKABLE_POINTER_CURSOR_CLASS, enabled);
}
