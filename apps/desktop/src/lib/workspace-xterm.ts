import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import {
  notifyEditCommandTargetsChanged,
  registerEditCommandTarget,
} from "@/lib/edit-command-targets";
import { configureWorkspaceTerminalLinks } from "@/lib/workspace-terminal-links";
import { attachWorkspaceTerminalResizeObserver } from "@/lib/workspace-terminal-resize";
import { readTerminalThemeFromDocument, trackTerminalTheme } from "@/lib/workspace-terminal-theme";

/** On Windows, prefer the system Cascadia / Consolas; do not put a webfont at the front of the stack, so installed system monospace fonts are not overridden. */
export const WORKSPACE_TERMINAL_FONT_FAMILY =
  '"Cascadia Code", "Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';

const WORKSPACE_TERMINAL_FONT_SIZE = 12;
const WORKSPACE_TERMINAL_LINE_HEIGHT = 1;
const WORKSPACE_TERMINAL_LETTER_SPACING = 0;

/** Loads WebGL after open + fit; falls back to the default renderer on failure or context loss. */
export function loadWorkspaceTerminalWebgl(term: Terminal): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      console.warn("[workspace-xterm] WebGL context lost; falling back to default renderer.");
      webgl.dispose();
    });
    term.loadAddon(webgl);
    return webgl;
  } catch (error) {
    console.warn("[workspace-xterm] WebGL addon failed to load; using default renderer.", error);
    return null;
  }
}

/** With a selection: copy; without a selection: paste (consistent with common integrated terminals, no menu popup). */
function writeClipboard(text: string): void {
  const b = window.spiritDesktop;
  if (b?.writeClipboardText) {
    b.writeClipboardText(text);
    return;
  }
  void navigator.clipboard.writeText(text);
}

function readClipboardSync(): string | null {
  const b = window.spiritDesktop;
  if (b?.readClipboardText) {
    try {
      return b.readClipboardText();
    } catch {
      return null;
    }
  }
  return null;
}

export type WorkspaceTerminalPtyBridge = Pick<
  NonNullable<typeof window.spiritDesktop>,
  "ptyCreate" | "ptyWrite" | "ptyResize" | "ptyKill" | "ptySubscribe"
>;

export type CreateWorkspaceTerminalOptions = {
  container: HTMLElement;
  cwd: string;
  bridge: WorkspaceTerminalPtyBridge;
  onTitleChange?: (title: string | undefined) => void;
  onEmbedError: (message: string) => void;
  shellExitedMessage: (exitCode: number) => string;
  /** Pauses fit during continuous layout changes such as sidebar dragging, so PTY and renderer sizes stay in sync. */
  isResizeSuspended?: () => boolean;
};

export type WorkspaceTerminalSession = {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Manually triggers a fit once the layout is stable (e.g. after a sidebar drag ends). */
  scheduleFit: () => void;
  dispose: () => void;
};

export function createWorkspaceTerminalSession(
  options: CreateWorkspaceTerminalOptions,
): WorkspaceTerminalSession {
  const {
    container,
    cwd,
    bridge,
    onTitleChange,
    onEmbedError,
    shellExitedMessage,
    isResizeSuspended,
  } = options;

  let termDisposed = false;
  let ptyId: string | undefined;
  let resizeController: ReturnType<typeof attachWorkspaceTerminalResizeObserver> | undefined;
  let resizePtyDisposable: { dispose(): void } | undefined;
  let unsubPty: (() => void) | undefined;
  let sessionAlive = true;
  let activePtyId: string | null = null;
  let untrackTheme: (() => void) | undefined;

  const term = new Terminal({
    cursorBlink: true,
    fontSize: WORKSPACE_TERMINAL_FONT_SIZE,
    lineHeight: WORKSPACE_TERMINAL_LINE_HEIGHT,
    letterSpacing: WORKSPACE_TERMINAL_LETTER_SPACING,
    fontFamily: WORKSPACE_TERMINAL_FONT_FAMILY,
    fontWeight: "normal",
    theme: readTerminalThemeFromDocument(),
    scrollback: 8000,
  });
  untrackTheme = trackTerminalTheme(term);
  configureWorkspaceTerminalLinks(term);

  term.onTitleChange((title) => {
    onTitleChange?.(title || undefined);
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  const webglAddon = loadWorkspaceTerminalWebgl(term);
  fitAddon.fit();

  const selectionDisposable = term.onSelectionChange(() => {
    notifyEditCommandTargetsChanged();
  });
  const unregisterEditCommand = registerEditCommandTarget({
    kind: "terminal",
    root: container,
    query: () => ({
      editable: true,
      canUndo: false,
      canRedo: false,
      hasSelection: term.hasSelection(),
    }),
    dispatch: (command) => {
      if (command === "copy") {
        const selected = term.getSelection();
        if (selected) {
          writeClipboard(selected);
        }
        return;
      }
      if (command === "paste") {
        const sync = readClipboardSync();
        if (sync != null) {
          term.paste(sync);
          return;
        }
        void navigator.clipboard.readText().then((text) => {
          if (text) {
            term.paste(text);
          }
        });
        return;
      }
      if (command === "selectAll") {
        term.selectAll();
      }
    },
  });

  resizeController = attachWorkspaceTerminalResizeObserver({
    container,
    terminal: term,
    fitAddon,
    webglAddon,
    isSuspended: isResizeSuspended,
  });

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const sel = term.getSelection();
    if (sel.length > 0) {
      writeClipboard(sel);
      term.clearSelection();
      return;
    }
    const sync = readClipboardSync();
    if (sync != null) {
      term.paste(sync);
      return;
    }
    void navigator.clipboard.readText().then((text) => {
      if (text) {
        term.paste(text);
      }
    });
  };
  container.addEventListener("contextmenu", onContextMenu, true);

  unsubPty = bridge.ptySubscribe({
    onData: (payload) => {
      if (payload.id === activePtyId) {
        term.write(payload.data);
      }
    },
    onProcessTitle: (payload) => {
      if (payload.id !== activePtyId) {
        return;
      }
      onTitleChange?.(payload.title);
    },
    onExit: (payload) => {
      if (payload.id === activePtyId) {
        term.write(`\r\n\x1b[90m[${shellExitedMessage(payload.exitCode)}]\x1b[0m\r\n`);
        activePtyId = null;
      }
    },
  });

  const disposeTerminal = (): void => {
    if (termDisposed) {
      return;
    }
    termDisposed = true;
    untrackTheme?.();
    untrackTheme = undefined;
    term.dispose();
  };

  const teardown = (): void => {
    sessionAlive = false;
    container.removeEventListener("contextmenu", onContextMenu, true);
    selectionDisposable.dispose();
    unregisterEditCommand();
    unsubPty?.();
    unsubPty = undefined;
    resizeController?.dispose();
    resizeController = undefined;
    resizePtyDisposable?.dispose();
    resizePtyDisposable = undefined;
    if (ptyId) {
      void bridge.ptyKill(ptyId);
      ptyId = undefined;
    }
    disposeTerminal();
    activePtyId = null;
  };

  void (async () => {
    const created = await bridge.ptyCreate({
      cwd,
      cols: term.cols,
      rows: term.rows,
    });

    if (!sessionAlive) {
      if (created.ok) {
        void bridge.ptyKill(created.id);
      }
      return;
    }

    if (!created.ok) {
      onEmbedError(created.error);
      teardown();
      return;
    }

    ptyId = created.id;
    activePtyId = created.id;
    onTitleChange?.(created.shellDisplayName);
    term.onData((data) => {
      bridge.ptyWrite(created.id, data);
    });

    resizePtyDisposable = term.onResize(({ cols, rows }) => {
      bridge.ptyResize(created.id, cols, rows);
    });
    resizeController?.scheduleFit();

    queueMicrotask(() => {
      if (sessionAlive) {
        term.focus();
      }
    });
  })();

  return {
    terminal: term,
    fitAddon,
    scheduleFit: () => {
      resizeController?.scheduleFit();
    },
    dispose: teardown,
  };
}
