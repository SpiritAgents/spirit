/**
 * Forwards uncaught renderer errors/rejections (with stacks) to the main process,
 * which keeps them in a ring buffer for the crash page log.
 *
 * The listeners must live in the renderer's main world: with contextIsolation on,
 * preload-world error listeners never fire for page exceptions. This module
 * self-installs on import so it can be placed first in the entry's import list
 * and also catch errors thrown by later import side effects.
 */

function reportRendererError(report: {
  kind: "error" | "unhandledrejection";
  message: string;
  stack?: string;
}): void {
  try {
    window.spiritDesktop?.reportRendererError(report);
  } catch {
    // Never let crash reporting break the page.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    reportRendererError({
      kind: "error",
      message: event.message,
      ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {}),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    reportRendererError({
      kind: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
    });
  });
}
