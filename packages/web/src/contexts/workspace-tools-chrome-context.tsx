import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  readWorkspaceToolsFullScreen,
  readWorkspaceToolsFullScreenRestoreOpen,
  WORKSPACE_TOOLS_WIDTH_CSS_PROPERTY,
  workspaceToolsShellWidthExpression,
  workspaceToolsShellWidthWhenOpen,
  writeWorkspaceToolsFullScreen,
  writeWorkspaceToolsFullScreenRestoreOpen,
} from "@/lib/layout-prefs";
import { prefersReducedMotion } from "@/lib/reduce-motion";

/** Matches the ThreadSidebarShell / legacy right-panel open/close animation */
const WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION = "width 300ms cubic-bezier(0.22, 1, 0.36, 1)";
const WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION_MS = 300;

/**
 * In-flight full-screen width animation. "enter" carries the measured conversation-row width so the
 * shell transitions between definite px endpoints before settling to 100% (a percentage width on
 * the shell would be cyclic while the dock wrapper is still content-sized mid-flight).
 */
export type WorkspaceToolsWidthFlight = { kind: "enter"; targetPx: number } | { kind: "exit" };

type WorkspaceToolsChromeActions = {
  setOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  toggle(): void;
  openTools(): void;
  enterFullScreen(): void;
  toggleFullScreen(): void;
  dismissForNewThread(): void;
  registerNewThreadChrome(): () => void;
};

const WorkspaceToolsChromeOpenContext = createContext(false);
const WorkspaceToolsChromeFullScreenContext = createContext(false);
const WorkspaceToolsChromeFlightContext = createContext<WorkspaceToolsWidthFlight | null>(null);
const WorkspaceToolsChromeActionsContext = createContext<WorkspaceToolsChromeActions | null>(null);
const WorkspaceToolsNewThreadChromeContext = createContext(false);

export type WorkspaceToolsChromeApi = {
  open: boolean;
  fullScreen: boolean;
  toggle(): void;
  enterFullScreen(): void;
  toggleFullScreen(): void;
  setOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  dismissForNewThread(): void;
};

export type WorkspaceToolsChromeProviderProps = {
  children: ReactNode;
  apiRef?: React.MutableRefObject<WorkspaceToolsChromeApi | null>;
};

let workspaceToolsShellWidthTransitionClearTimer = 0;
let focusWorkspaceToolsPanelOnOpen = false;

function requestFocusWorkspaceToolsPanelOnOpen(): void {
  focusWorkspaceToolsPanelOnOpen = true;
}

export function consumeFocusWorkspaceToolsPanelOnOpen(): boolean {
  const requested = focusWorkspaceToolsPanelOnOpen;
  focusWorkspaceToolsPanelOnOpen = false;
  return requested;
}

function getWorkspaceToolsShell(): HTMLElement | null {
  return document.getElementById("workspace-tools-panel-shell");
}

function clearShellWidthTransitionTimer(): void {
  if (workspaceToolsShellWidthTransitionClearTimer !== 0) {
    window.clearTimeout(workspaceToolsShellWidthTransitionClearTimer);
    workspaceToolsShellWidthTransitionClearTimer = 0;
  }
}

function scheduleShellWidthTransitionSettle(shell: HTMLElement, onSettle: () => void): void {
  clearShellWidthTransitionTimer();
  workspaceToolsShellWidthTransitionClearTimer = window.setTimeout(() => {
    workspaceToolsShellWidthTransitionClearTimer = 0;
    if (shell.isConnected) {
      shell.style.removeProperty("transition");
    }
    onSettle();
  }, WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION_MS + 20);
}

function applyWorkspaceToolsShellWidthImmediate(nextOpen: boolean, onSettle: () => void): void {
  const shell = getWorkspaceToolsShell();
  if (!shell) {
    return;
  }
  const dockedWidth = `var(${WORKSPACE_TOOLS_WIDTH_CSS_PROPERTY})`;
  const splitWidth = workspaceToolsShellWidthExpression(dockedWidth);

  // Only open/close uses a width transition; docked viewport changes resolve through CSS.
  const reduceMotion = prefersReducedMotion();
  shell.style.transition = reduceMotion ? "none" : WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION;
  shell.style.width = workspaceToolsShellWidthWhenOpen(nextOpen, dockedWidth);
  const split = shell.querySelector("[data-workspace-tools-split]");
  if (split instanceof HTMLElement) {
    split.style.width = splitWidth;
  }

  // This animation supersedes any in-flight full-screen flight and re-arms the shared settle
  // timer, so it must inherit the flight-clearing settle — otherwise the orphaned flight state
  // would keep chromePinned/fillMode stuck on after the panel lands docked.
  scheduleShellWidthTransitionSettle(shell, onSettle);
}

/** The conversation row (dock wrapper's parent) is the flex container the full-screen shell fills. */
function measureWorkspaceToolsRowWidthPx(shell: HTMLElement): number | null {
  const row = shell.parentElement?.parentElement;
  if (!row) {
    return null;
  }
  const width = row.getBoundingClientRect().width;
  return width > 0 ? width : null;
}

function applyEnterFullScreenFlight(targetPx: number, onSettle: () => void): void {
  const shell = getWorkspaceToolsShell();
  if (!shell) {
    return;
  }
  shell.style.transition = WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION;
  shell.style.width = `${targetPx}px`;
  scheduleShellWidthTransitionSettle(shell, onSettle);
}

function applyExitFullScreenFlight(targetWidth: string, onSettle: () => void): void {
  const shell = getWorkspaceToolsShell();
  if (!shell) {
    return;
  }
  // The shell sits at 100% of the full-width dock wrapper; pin it to the measured px first so the
  // transition interpolates between definite lengths once the wrapper returns to content sizing.
  const currentPx = shell.getBoundingClientRect().width;
  shell.style.transition = "none";
  shell.style.width = `${currentPx}px`;
  void shell.offsetWidth;
  shell.style.transition = WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION;
  shell.style.width = targetWidth;
  scheduleShellWidthTransitionSettle(shell, onSettle);
}

export function WorkspaceToolsChromeProvider({
  children,
  apiRef,
}: WorkspaceToolsChromeProviderProps) {
  const [fullScreen, setFullScreenState] = useState(readWorkspaceToolsFullScreen);
  const [open, setOpenState] = useState(() => readWorkspaceToolsFullScreen());
  const [flight, setFlight] = useState<WorkspaceToolsWidthFlight | null>(null);
  const [newThreadChromeCount, setNewThreadChromeCount] = useState(0);
  const openRef = useRef(open);
  const fullScreenRef = useRef(fullScreen);
  /** Restore snapshot of `open` taken when entering full screen; consumed by any exit path. */
  const restoreOpenRef = useRef(readWorkspaceToolsFullScreenRestoreOpen());
  const updateOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const updateFullScreen = useCallback((next: boolean) => {
    fullScreenRef.current = next;
    setFullScreenState(next);
  }, []);

  const settleFlight = useCallback(() => {
    setFlight(null);
  }, []);

  const exitFullScreen = useCallback(
    (toOpen: boolean) => {
      restoreOpenRef.current = false;
      if (prefersReducedMotion()) {
        clearShellWidthTransitionTimer();
        setFlight(null);
      } else {
        const shell = getWorkspaceToolsShell();
        if (shell) {
          setFlight({ kind: "exit" });
          applyExitFullScreenFlight(
            workspaceToolsShellWidthWhenOpen(toOpen, `var(${WORKSPACE_TOOLS_WIDTH_CSS_PROPERTY})`),
            settleFlight,
          );
        } else {
          setFlight(null);
        }
      }
      updateFullScreen(false);
      updateOpen(toOpen);
      writeWorkspaceToolsFullScreen(false);
    },
    [settleFlight, updateFullScreen, updateOpen],
  );

  const enterFullScreen = useCallback(() => {
    if (fullScreenRef.current) {
      return;
    }
    const wasOpen = openRef.current;
    restoreOpenRef.current = wasOpen;
    writeWorkspaceToolsFullScreen(true);
    writeWorkspaceToolsFullScreenRestoreOpen(wasOpen);
    requestFocusWorkspaceToolsPanelOnOpen();
    if (prefersReducedMotion()) {
      clearShellWidthTransitionTimer();
      setFlight(null);
    } else {
      const shell = getWorkspaceToolsShell();
      const rowWidthPx = shell ? measureWorkspaceToolsRowWidthPx(shell) : null;
      if (shell && rowWidthPx !== null) {
        setFlight({ kind: "enter", targetPx: rowWidthPx });
        applyEnterFullScreenFlight(rowWidthPx, settleFlight);
      } else {
        setFlight(null);
      }
    }
    updateFullScreen(true);
    updateOpen(true);
  }, [settleFlight, updateFullScreen, updateOpen]);

  const setOpen = useCallback(
    (updater: boolean | ((current: boolean) => boolean)) => {
      const current = openRef.current;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) {
        return;
      }
      if (fullScreenRef.current) {
        // Only reachable as setOpen(false) from full screen: collapse from fullscreen to 0 in one flight.
        exitFullScreen(false);
        return;
      }
      applyWorkspaceToolsShellWidthImmediate(next, settleFlight);
      updateOpen(next);
    },
    [exitFullScreen, settleFlight, updateOpen],
  );

  const toggle = useCallback(() => {
    if (fullScreenRef.current) {
      // Cmd/Ctrl+Alt+B from full screen only drops back to the dock (open=true), even when the
      // full-screen gesture started from collapsed; a second press collapses as usual.
      exitFullScreen(true);
      return;
    }
    const next = !openRef.current;
    if (next) {
      requestFocusWorkspaceToolsPanelOnOpen();
    }
    applyWorkspaceToolsShellWidthImmediate(next, settleFlight);
    updateOpen(next);
  }, [exitFullScreen, settleFlight, updateOpen]);

  const openTools = useCallback(() => {
    if (fullScreenRef.current || openRef.current) {
      // Already open (docked or full screen); never rewrite the full-screen 100% width.
      return;
    }
    applyWorkspaceToolsShellWidthImmediate(true, settleFlight);
    updateOpen(true);
  }, [settleFlight, updateOpen]);

  const toggleFullScreen = useCallback(() => {
    if (fullScreenRef.current) {
      exitFullScreen(restoreOpenRef.current);
      return;
    }
    enterFullScreen();
  }, [enterFullScreen, exitFullScreen]);

  const dismissForNewThread = useCallback(() => {
    // A new session is a new space: a full-screen panel collapses instantly (no reverse animation)
    // so the old space's tools do not linger. A docked panel is workspace-level and stays open, so
    // callers can invoke this on every new-thread path without checking the state first.
    if (!fullScreenRef.current) {
      return;
    }
    restoreOpenRef.current = false;
    clearShellWidthTransitionTimer();
    const shell = getWorkspaceToolsShell();
    if (shell) {
      shell.style.removeProperty("transition");
    }
    setFlight(null);
    updateFullScreen(false);
    updateOpen(false);
    writeWorkspaceToolsFullScreen(false);
  }, [updateFullScreen, updateOpen]);

  const registerNewThreadChrome = useCallback(() => {
    setNewThreadChromeCount((count) => count + 1);
    return () => setNewThreadChromeCount((count) => count - 1);
  }, []);

  const actions = useMemo(
    () => ({
      setOpen,
      toggle,
      openTools,
      enterFullScreen,
      toggleFullScreen,
      dismissForNewThread,
      registerNewThreadChrome,
    }),
    [
      dismissForNewThread,
      enterFullScreen,
      openTools,
      registerNewThreadChrome,
      setOpen,
      toggle,
      toggleFullScreen,
    ],
  );

  useEffect(() => {
    if (apiRef) {
      apiRef.current = {
        open,
        fullScreen,
        toggle,
        enterFullScreen,
        toggleFullScreen,
        setOpen,
        dismissForNewThread,
      };
    }
  }, [
    apiRef,
    open,
    fullScreen,
    setOpen,
    toggle,
    enterFullScreen,
    toggleFullScreen,
    dismissForNewThread,
  ]);

  return (
    <WorkspaceToolsChromeActionsContext.Provider value={actions}>
      <WorkspaceToolsChromeOpenContext.Provider value={open}>
        <WorkspaceToolsChromeFullScreenContext.Provider value={fullScreen}>
          <WorkspaceToolsChromeFlightContext.Provider value={flight}>
            <WorkspaceToolsNewThreadChromeContext.Provider value={newThreadChromeCount > 0}>
              {children}
            </WorkspaceToolsNewThreadChromeContext.Provider>
          </WorkspaceToolsChromeFlightContext.Provider>
        </WorkspaceToolsChromeFullScreenContext.Provider>
      </WorkspaceToolsChromeOpenContext.Provider>
    </WorkspaceToolsChromeActionsContext.Provider>
  );
}

export function useWorkspaceToolsChromeOpen(): boolean {
  return useContext(WorkspaceToolsChromeOpenContext);
}

export function useWorkspaceToolsChromeFullScreen(): boolean {
  return useContext(WorkspaceToolsChromeFullScreenContext);
}

export function useWorkspaceToolsChromeWidthFlight(): WorkspaceToolsWidthFlight | null {
  return useContext(WorkspaceToolsChromeFlightContext);
}

export function useWorkspaceToolsNewThreadChrome(): boolean {
  return useContext(WorkspaceToolsNewThreadChromeContext);
}

export function useWorkspaceToolsChromeActions(): WorkspaceToolsChromeActions {
  const value = useContext(WorkspaceToolsChromeActionsContext);
  if (!value) {
    throw new Error(
      "useWorkspaceToolsChromeActions must be used within WorkspaceToolsChromeProvider",
    );
  }
  return value;
}

/** Top-bar button: needs both open and toggle. */
export function useWorkspaceToolsChrome(): {
  open: boolean;
  fullScreen: boolean;
  /** True from the first full-screen frame through the exit settle, so pinned chrome holds for the strict reverse animation. */
  chromePinned: boolean;
  setOpen: WorkspaceToolsChromeActions["setOpen"];
  toggle: WorkspaceToolsChromeActions["toggle"];
  openTools: WorkspaceToolsChromeActions["openTools"];
  toggleFullScreen: WorkspaceToolsChromeActions["toggleFullScreen"];
  dismissForNewThread: WorkspaceToolsChromeActions["dismissForNewThread"];
  registerNewThreadChrome: WorkspaceToolsChromeActions["registerNewThreadChrome"];
} {
  const open = useWorkspaceToolsChromeOpen();
  const fullScreen = useWorkspaceToolsChromeFullScreen();
  const flight = useWorkspaceToolsChromeWidthFlight();
  const {
    setOpen,
    toggle,
    openTools,
    toggleFullScreen,
    dismissForNewThread,
    registerNewThreadChrome,
  } = useWorkspaceToolsChromeActions();
  return {
    open,
    fullScreen,
    chromePinned: fullScreen || flight !== null,
    setOpen,
    toggle,
    openTools,
    toggleFullScreen,
    dismissForNewThread,
    registerNewThreadChrome,
  };
}
