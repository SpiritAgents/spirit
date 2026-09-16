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
  readWorkspaceToolsWidthPx,
  workspaceToolsShellWidthExpression,
  workspaceToolsShellWidthWhenOpen,
  writeWorkspaceToolsFullScreen,
  writeWorkspaceToolsFullScreenRestoreOpen,
} from "@/lib/layout-prefs";
import { prefersReducedMotion } from "@/lib/reduce-motion";

/** Matches the SessionSidebarShell / legacy right-panel open/close animation */
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
  toggleFullScreen(): void;
  dismissForNewSession(): void;
  registerNewSessionChrome(): () => void;
};

const WorkspaceToolsChromeOpenContext = createContext(false);
const WorkspaceToolsChromeFullScreenContext = createContext(false);
const WorkspaceToolsChromeFlightContext = createContext<WorkspaceToolsWidthFlight | null>(null);
const WorkspaceToolsChromeActionsContext = createContext<WorkspaceToolsChromeActions | null>(null);
const WorkspaceToolsNewSessionChromeContext = createContext(false);

export type WorkspaceToolsChromeApi = {
  open: boolean;
  fullScreen: boolean;
  toggle(): void;
  toggleFullScreen(): void;
  setOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  dismissForNewSession(): void;
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

function applyWorkspaceToolsShellWidthImmediate(nextOpen: boolean): void {
  const shell = getWorkspaceToolsShell();
  const aside = document.getElementById("workspace-tools-panel");
  if (!shell || !aside) {
    return;
  }
  const widthRaw = aside.style.width;
  const widthPx =
    widthRaw && widthRaw.endsWith("px")
      ? Number.parseInt(widthRaw, 10)
      : readWorkspaceToolsWidthPx();
  const splitWidth = workspaceToolsShellWidthExpression(widthPx);

  // Only open/close uses the width transition; when viewport scaling changes the ratio, the React side keeps no transition to avoid lagging behind window dragging.
  const reduceMotion = prefersReducedMotion();
  shell.style.transition = reduceMotion ? "none" : WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION;
  shell.style.width = workspaceToolsShellWidthWhenOpen(nextOpen, widthPx);
  const split = shell.querySelector("[data-workspace-tools-split]");
  if (split instanceof HTMLElement) {
    split.style.width = splitWidth;
  }

  scheduleShellWidthTransitionSettle(shell, () => {});
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
  const [newSessionChromeCount, setNewSessionChromeCount] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const fullScreenRef = useRef(fullScreen);
  fullScreenRef.current = fullScreen;
  /** Restore snapshot of `open` taken when entering full screen; consumed by any exit path. */
  const restoreOpenRef = useRef(readWorkspaceToolsFullScreenRestoreOpen());

  const settleFlight = useCallback(() => {
    setFlight(null);
  }, []);

  const exitFullScreen = useCallback(
    (toOpen: boolean) => {
      restoreOpenRef.current = false;
      fullScreenRef.current = false;
      openRef.current = toOpen;
      if (prefersReducedMotion()) {
        clearShellWidthTransitionTimer();
        setFlight(null);
      } else {
        const shell = getWorkspaceToolsShell();
        if (shell) {
          setFlight({ kind: "exit" });
          applyExitFullScreenFlight(
            workspaceToolsShellWidthWhenOpen(toOpen, readWorkspaceToolsWidthPx()),
            settleFlight,
          );
        } else {
          setFlight(null);
        }
      }
      setFullScreenState(false);
      setOpenState(toOpen);
      writeWorkspaceToolsFullScreen(false);
    },
    [settleFlight],
  );

  const enterFullScreen = useCallback(() => {
    const wasOpen = openRef.current;
    restoreOpenRef.current = wasOpen;
    writeWorkspaceToolsFullScreen(true);
    writeWorkspaceToolsFullScreenRestoreOpen(wasOpen);
    requestFocusWorkspaceToolsPanelOnOpen();
    fullScreenRef.current = true;
    openRef.current = true;
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
    setFullScreenState(true);
    setOpenState(true);
  }, [settleFlight]);

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
      applyWorkspaceToolsShellWidthImmediate(next);
      setOpenState(next);
    },
    [exitFullScreen],
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
    applyWorkspaceToolsShellWidthImmediate(next);
    setOpenState(next);
  }, [exitFullScreen]);

  const openTools = useCallback(() => {
    if (fullScreenRef.current || openRef.current) {
      // Already open (docked or full screen); never rewrite the full-screen 100% width.
      return;
    }
    applyWorkspaceToolsShellWidthImmediate(true);
    setOpenState(true);
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (fullScreenRef.current) {
      exitFullScreen(restoreOpenRef.current);
      return;
    }
    enterFullScreen();
  }, [enterFullScreen, exitFullScreen]);

  const dismissForNewSession = useCallback(() => {
    // A new session is a new space: a full-screen panel collapses instantly (no reverse animation)
    // so the old space's tools do not linger. A docked panel is workspace-level and stays open, so
    // callers can invoke this on every new-session path without checking the state first.
    if (!fullScreenRef.current) {
      return;
    }
    restoreOpenRef.current = false;
    fullScreenRef.current = false;
    openRef.current = false;
    clearShellWidthTransitionTimer();
    const shell = getWorkspaceToolsShell();
    if (shell) {
      shell.style.removeProperty("transition");
    }
    setFlight(null);
    setFullScreenState(false);
    setOpenState(false);
    writeWorkspaceToolsFullScreen(false);
  }, []);

  const registerNewSessionChrome = useCallback(() => {
    setNewSessionChromeCount((count) => count + 1);
    return () => setNewSessionChromeCount((count) => count - 1);
  }, []);

  const actions = useMemo(
    () => ({
      setOpen,
      toggle,
      openTools,
      toggleFullScreen,
      dismissForNewSession,
      registerNewSessionChrome,
    }),
    [dismissForNewSession, openTools, registerNewSessionChrome, setOpen, toggle, toggleFullScreen],
  );

  useEffect(() => {
    if (apiRef) {
      apiRef.current = {
        open,
        fullScreen,
        toggle,
        toggleFullScreen,
        setOpen,
        dismissForNewSession,
      };
    }
  }, [apiRef, open, fullScreen, setOpen, toggle, toggleFullScreen, dismissForNewSession]);

  return (
    <WorkspaceToolsChromeActionsContext.Provider value={actions}>
      <WorkspaceToolsChromeOpenContext.Provider value={open}>
        <WorkspaceToolsChromeFullScreenContext.Provider value={fullScreen}>
          <WorkspaceToolsChromeFlightContext.Provider value={flight}>
            <WorkspaceToolsNewSessionChromeContext.Provider value={newSessionChromeCount > 0}>
              {children}
            </WorkspaceToolsNewSessionChromeContext.Provider>
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

export function useWorkspaceToolsNewSessionChrome(): boolean {
  return useContext(WorkspaceToolsNewSessionChromeContext);
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
  dismissForNewSession: WorkspaceToolsChromeActions["dismissForNewSession"];
  registerNewSessionChrome: WorkspaceToolsChromeActions["registerNewSessionChrome"];
} {
  const open = useWorkspaceToolsChromeOpen();
  const fullScreen = useWorkspaceToolsChromeFullScreen();
  const flight = useWorkspaceToolsChromeWidthFlight();
  const {
    setOpen,
    toggle,
    openTools,
    toggleFullScreen,
    dismissForNewSession,
    registerNewSessionChrome,
  } = useWorkspaceToolsChromeActions();
  return {
    open,
    fullScreen,
    chromePinned: fullScreen || flight !== null,
    setOpen,
    toggle,
    openTools,
    toggleFullScreen,
    dismissForNewSession,
    registerNewSessionChrome,
  };
}
