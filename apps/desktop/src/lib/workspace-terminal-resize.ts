import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

const RESIZE_DEBOUNCE_MS = 100;
const MIN_TERMINAL_WIDTH_PX = 48;
const MIN_TERMINAL_HEIGHT_PX = 48;

function isContainerMeasurable(container: HTMLElement): boolean {
  if (!container.isConnected) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  return rect.width >= MIN_TERMINAL_WIDTH_PX && rect.height >= MIN_TERMINAL_HEIGHT_PX;
}

export type WorkspaceTerminalResizeController = {
  /** Triggers a fit once the layout is stable (e.g. after a sidebar drag ends). */
  scheduleFit: () => void;
  dispose: () => void;
};

export function attachWorkspaceTerminalResizeObserver(options: {
  container: HTMLElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  webglAddon?: WebglAddon | null;
  /** When true, ResizeObserver events are ignored (e.g. while the sidebar is still being dragged). */
  isSuspended?: () => boolean;
}): WorkspaceTerminalResizeController {
  const { container, terminal, fitAddon, webglAddon, isSuspended } = options;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const runFit = (): void => {
    if (disposed || isSuspended?.()) {
      return;
    }
    if (!isContainerMeasurable(container)) {
      return;
    }

    const beforeCols = terminal.cols;
    const beforeRows = terminal.rows;
    fitAddon.fit();

    if (terminal.cols === beforeCols && terminal.rows === beforeRows) {
      return;
    }

    try {
      webglAddon?.clearTextureAtlas();
    } catch {
      /* ignore */
    }
    try {
      terminal.clearTextureAtlas();
    } catch {
      /* ignore */
    }
  };

  // Leading edge: the first size change fits on the next animation frame (UI zoom, panel ratio
  // changes); further events within the debounce window are coalesced (continuous resizes).
  const scheduleFit = (): void => {
    if (disposed) {
      return;
    }
    if (debounceTimer === undefined) {
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
      }, RESIZE_DEBOUNCE_MS);
      requestAnimationFrame(runFit);
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      requestAnimationFrame(runFit);
    }, RESIZE_DEBOUNCE_MS);
  };

  const resizeObserver = new ResizeObserver(() => {
    scheduleFit();
  });
  resizeObserver.observe(container);

  return {
    scheduleFit,
    dispose: () => {
      disposed = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      resizeObserver.disconnect();
    },
  };
}
