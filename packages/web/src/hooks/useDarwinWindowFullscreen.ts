import { useSyncExternalStore } from "react";

function subscribeDarwinFullscreenClass(onStoreChange: () => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarwinFullscreenFromDocument(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.classList.contains("spirit-desktop-darwin-fullscreen");
}

/**
 * macOS fullscreen state: synced with the `spirit-desktop-darwin-fullscreen` class written by `useDesktopShellEffects`,
 * without re-subscribing to Electron IPC (the traffic-light safe-area CSS is still maintained by shell effects).
 */
export function useDarwinWindowFullscreen(enabled: boolean): boolean {
  return useSyncExternalStore(
    enabled ? subscribeDarwinFullscreenClass : () => () => {},
    () => (enabled ? getDarwinFullscreenFromDocument() : false),
    () => false,
  );
}
