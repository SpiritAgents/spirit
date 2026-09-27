import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { configureWorkspaceTerminalLinks } from "@/lib/workspace-terminal-links";
import { attachWorkspaceTerminalResizeObserver } from "@/lib/workspace-terminal-resize";
import { readTerminalThemeFromDocument, trackTerminalTheme } from "@/lib/workspace-terminal-theme";
import {
  loadWorkspaceTerminalWebgl,
  WORKSPACE_TERMINAL_FONT_FAMILY,
  type WorkspaceTerminalPtyBridge,
} from "@/lib/workspace-xterm";

export type WorkspaceTaskTerminalInvocation = {
  file: string;
  args: string[];
};

export type WorkspaceTaskTerminalStartOptions = {
  cwd: string;
  env?: Record<string, string>;
  /** Written into the terminal as one line right after spawn (e.g. the echoed command line). */
  echoLine?: string;
};

export type CreateWorkspaceTaskTerminalOptions = {
  container: HTMLElement;
  bridge: WorkspaceTerminalPtyBridge;
  onTitleChange?: (title: string | undefined) => void;
  /** Pauses fit during continuous layout changes such as sidebar dragging. */
  isResizeSuspended?: () => boolean;
};

export type WorkspaceTaskTerminalSession = {
  terminal: Terminal;
  /** Spawns a process on the (single) xterm instance; resolves with the exit code. */
  start: (
    invocation: WorkspaceTaskTerminalInvocation,
    opts: WorkspaceTaskTerminalStartOptions,
  ) => Promise<number>;
  /** Terminal-reuse primitive: same as start, named for pool semantics. */
  respawn: (
    invocation: WorkspaceTaskTerminalInvocation,
    opts: WorkspaceTaskTerminalStartOptions,
  ) => Promise<number>;
  clear: () => void;
  focus: () => void;
  isRunning: () => boolean;
  dispose: () => void;
};

// One xterm instance, zero or one live process: the pty is spawned explicitly per run
// (never at mount, never auto-focused), and after exit the xterm stays alive for respawn.
export function createWorkspaceTaskTerminalSession(
  options: CreateWorkspaceTaskTerminalOptions,
): WorkspaceTaskTerminalSession {
  const { container, bridge, onTitleChange, isResizeSuspended } = options;

  let sessionAlive = true;
  let activePtyId: string | null = null;
  let settleExit: ((exitCode: number) => void) | undefined;

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    lineHeight: 1,
    letterSpacing: 0,
    fontFamily: WORKSPACE_TERMINAL_FONT_FAMILY,
    fontWeight: "normal",
    theme: readTerminalThemeFromDocument(),
    scrollback: 8000,
  });
  const untrackTheme = trackTerminalTheme(term);
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

  const resizeController = attachWorkspaceTerminalResizeObserver({
    container,
    terminal: term,
    fitAddon,
    webglAddon,
    isSuspended: isResizeSuspended,
  });

  const dataDisposable = term.onData((data) => {
    if (activePtyId !== null) {
      bridge.ptyWrite(activePtyId, data);
    }
  });
  const resizeDisposable = term.onResize(({ cols, rows }) => {
    if (activePtyId !== null) {
      bridge.ptyResize(activePtyId, cols, rows);
    }
  });

  const unsubPty = bridge.ptySubscribe({
    onData: (payload) => {
      if (payload.id === activePtyId) {
        term.write(payload.data);
      }
    },
    onExit: (payload) => {
      if (payload.id === activePtyId) {
        activePtyId = null;
        const settle = settleExit;
        settleExit = undefined;
        settle?.(payload.exitCode);
      }
    },
  });

  const start = async (
    invocation: WorkspaceTaskTerminalInvocation,
    opts: WorkspaceTaskTerminalStartOptions,
  ): Promise<number> => {
    if (!sessionAlive) {
      throw new Error("task terminal session is disposed");
    }
    if (activePtyId !== null) {
      throw new Error("task terminal already has a running process");
    }
    const exitPromise = new Promise<number>((resolve) => {
      settleExit = resolve;
    });
    const created = await bridge.ptyCreate({
      cwd: opts.cwd,
      cols: term.cols,
      rows: term.rows,
      file: invocation.file,
      args: invocation.args,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
    if (!created.ok) {
      settleExit = undefined;
      throw new Error(created.error);
    }
    if (!sessionAlive) {
      settleExit = undefined;
      void bridge.ptyKill(created.id);
      throw new Error("task terminal session is disposed");
    }
    activePtyId = created.id;
    if (opts.echoLine !== undefined) {
      term.write(`${opts.echoLine}\r\n`);
    }
    return exitPromise;
  };

  const dispose = (): void => {
    if (!sessionAlive) {
      return;
    }
    sessionAlive = false;
    const ptyId = activePtyId;
    activePtyId = null;
    // Settle a pending start() before unsubscribing: disposal is user termination and the
    // real exit event is intentionally dropped, so resolve with a placeholder code.
    const settle = settleExit;
    settleExit = undefined;
    settle?.(0);
    if (ptyId !== null) {
      void bridge.ptyKill(ptyId);
    }
    unsubPty();
    dataDisposable.dispose();
    resizeDisposable.dispose();
    resizeController.dispose();
    untrackTheme();
    term.dispose();
  };

  return {
    terminal: term,
    start,
    respawn: start,
    clear: () => term.clear(),
    focus: () => term.focus(),
    isRunning: () => activePtyId !== null,
    dispose,
  };
}
