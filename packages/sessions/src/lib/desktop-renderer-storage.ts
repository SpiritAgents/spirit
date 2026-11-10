/**
 * Chromium buffers localStorage and typically only flushes LevelDB on graceful shutdown.
 * SIGINT/Ctrl+C skips that flush, so persist-intent writes must flush immediately.
 */
export function flushDesktopRendererStorage(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.spiritDesktop?.flushRendererStorage?.();
}
