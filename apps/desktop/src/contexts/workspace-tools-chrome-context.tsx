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
  readWorkspaceToolsMaximized,
  readWorkspaceToolsMaximizedRestoreOpen,
  readWorkspaceToolsWidthPx,
  workspaceToolsShellWidthExpression,
  workspaceToolsShellWidthWhenOpen,
  writeWorkspaceToolsMaximized,
  writeWorkspaceToolsMaximizedRestoreOpen,
} from "@/lib/layout-prefs";
import { prefersReducedMotion } from "@/lib/reduce-motion";

/** Matches the SessionSidebarShell / legacy right-panel open/close animation */
const WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION = "width 300ms cubic-bezier(0.22, 1, 0.36, 1)";
const WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION_MS = 300;

/**
 * In-flight maximized width animation. "enter" carries the measured conversation-row width so the
 * shell transitions between definite px endpoints before settling to 100% (a percentage width on
 * the shell would be cyclic while the dock wrapper is still content-sized mid-flight).
 */
export type WorkspaceToolsWidthFlight = { kind: "enter"; targetPx: number } | { kind: "exit" };

type WorkspaceToolsChromeActions = {
  setOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  toggle(): void;
  openTools(): void;
  toggleMaximized(): void;
  dismissForNewSession(): void;
  registerNewSessionChrome(): () => void;
};

const WorkspaceToolsChromeOpenContext = createContext(false);
const WorkspaceToolsChromeMaximizedContext = createContext(false);
const WorkspaceToolsChromeFlightContext = createContext<WorkspaceToolsWidthFlight | null>(null);
const WorkspaceToolsChromeActionsContext = createContext<WorkspaceToolsChromeActions | null>(null);
const WorkspaceToolsNewSessionChromeContext = createContext(false);

export type WorkspaceToolsChromeApi = {
  open: boolean;
  maximized: boolean;
  toggle(): void;
  toggleMaximized(): void;
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

/** The conversation row (dock wrapper's parent) is the flex container the maximized shell fills. */
function measureWorkspaceToolsRowWidthPx(shell: HTMLElement): number | null {
  const row = shell.parentElement?.parentElement;
  if (!row) {
    return null;
  }
  const width = row.getBoundingClientRect().width;
  return width > 0 ? width : null;
}

function applyEnterMaximizedFlight(targetPx: number, onSettle: () => void): void {
  const shell = getWorkspaceToolsShell();
  if (!shell) {
    return;
  }
  shell.style.transition = WORKSPACE_TOOLS_SHELL_WIDTH_TRANSITION;
  shell.style.width = `${targetPx}px`;
  scheduleShellWidthTransitionSettle(shell, onSettle);
}

function applyExitMaximizedFlight(targetWidth: string, onSettle: () => void): void {
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
  const [maximized, setMaximizedState] = useState(readWorkspaceToolsMaximized);
  const [open, setOpenState] = useState(() => readWorkspaceToolsMaximized());
  const [flight, setFlight] = useState<WorkspaceToolsWidthFlight | null>(null);
  const [newSessionChromeCount, setNewSessionChromeCount] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const maximizedRef = useRef(maximized);
  maximizedRef.current = maximized;
  /** Restore snapshot of `open` taken when entering maximized; consumed by any exit path. */
  const restoreOpenRef = useRef(readWorkspaceToolsMaximizedRestoreOpen());

  const settleFlight = useCallback(() => {
    setFlight(null);
  }, []);

  const exitMaximized = useCallback(
    (toOpen: boolean) => {
      restoreOpenRef.current = false;
      maximizedRef.current = false;
      openRef.current = toOpen;
      if (prefersReducedMotion()) {
        clearShellWidthTransitionTimer();
        setFlight(null);
      } else {
        const shell = getWorkspaceToolsShell();
        if (shell) {
          setFlight({ kind: "exit" });
          applyExitMaximizedFlight(
            workspaceToolsShellWidthWhenOpen(toOpen, readWorkspaceToolsWidthPx()),
            settleFlight,
          );
        } else {
          setFlight(null);
        }
      }
      setMaximizedState(false);
      setOpenState(toOpen);
      writeWorkspaceToolsMaximized(false);
    },
    [settleFlight],
  );

  const enterMaximized = useCallback(() => {
    const wasOpen = openRef.current;
    restoreOpenRef.current = wasOpen;
    writeWorkspaceToolsMaximized(true);
    writeWorkspaceToolsMaximizedRestoreOpen(wasOpen);
    requestFocusWorkspaceToolsPanelOnOpen();
    maximizedRef.current = true;
    openRef.current = true;
    if (prefersReducedMotion()) {
      clearShellWidthTransitionTimer();
      setFlight(null);
    } else {
      const shell = getWorkspaceToolsShell();
      const rowWidthPx = shell ? measureWorkspaceToolsRowWidthPx(shell) : null;
      if (shell && rowWidthPx !== null) {
        setFlight({ kind: "enter", targetPx: rowWidthPx });
        applyEnterMaximizedFlight(rowWidthPx, settleFlight);
      } else {
        setFlight(null);
      }
    }
    setMaximizedState(true);
    setOpenState(true);
  }, [settleFlight]);

  const setOpen = useCallback(
    (updater: boolean | ((current: boolean) => boolean)) => {
      const current = openRef.current;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) {
        return;
      }
      if (maximizedRef.current) {
        // Only reachable as setOpen(false) from maximized: collapse from fullscreen to 0 in one flight.
        exitMaximized(false);
        return;
      }
      applyWorkspaceToolsShellWidthImmediate(next);
      setOpenState(next);
    },
    [exitMaximized],
  );

  const toggle = useCallback(() => {
    if (maximizedRef.current) {
      // Cmd/Ctrl+Alt+B from maximized only drops back to the dock (open=true), even when the
      // maximize gesture started from collapsed; a second press collapses as usual.
      exitMaximized(true);
      return;
    }
    const next = !openRef.current;
    if (next) {
      requestFocusWorkspaceToolsPanelOnOpen();
    }
    applyWorkspaceToolsShellWidthImmediate(next);
    setOpenState(next);
  }, [exitMaximized]);

  const openTools = useCallback(() => {
    if (maximizedRef.current || openRef.current) {
      // Already open (docked or maximized); never rewrite the maximized 100% width.
      return;
    }
    applyWorkspaceToolsShellWidthImmediate(true);
    setOpenState(true);
  }, []);

  const toggleMaximized = useCallback(() => {
    if (maximizedRef.current) {
      exitMaximized(restoreOpenRef.current);
      return;
    }
    enterMaximized();
  }, [enterMaximized, exitMaximized]);

  const dismissForNewSession = useCallback(() => {
    // A new session is a new space: collapse the panel instantly (no reverse animation) so the old
    // space's tools do not linger. Workspace-level tabs are left untouched.
    restoreOpenRef.current = false;
    maximizedRef.current = false;
    openRef.current = false;
    clearShellWidthTransitionTimer();
    const shell = getWorkspaceToolsShell();
    if (shell) {
      shell.style.removeProperty("transition");
    }
    setFlight(null);
    setMaximizedState(false);
    setOpenState(false);
    writeWorkspaceToolsMaximized(false);
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
      toggleMaximized,
      dismissForNewSession,
      registerNewSessionChrome,
    }),
    [dismissForNewSession, openTools, registerNewSessionChrome, setOpen, toggle, toggleMaximized],
  );

  useEffect(() => {
    if (apiRef) {
      apiRef.current = { open, maximized, toggle, toggleMaximized, setOpen, dismissForNewSession };
    }
  }, [apiRef, open, maximized, setOpen, toggle, toggleMaximized, dismissForNewSession]);

  return (
    <WorkspaceToolsChromeActionsContext.Provider value={actions}>
      <WorkspaceToolsChromeOpenContext.Provider value={open}>
        <WorkspaceToolsChromeMaximizedContext.Provider value={maximized}>
          <WorkspaceToolsChromeFlightContext.Provider value={flight}>
            <WorkspaceToolsNewSessionChromeContext.Provider value={newSessionChromeCount > 0}>
              {children}
            </WorkspaceToolsNewSessionChromeContext.Provider>
          </WorkspaceToolsChromeFlightContext.Provider>
        </WorkspaceToolsChromeMaximizedContext.Provider>
      </WorkspaceToolsChromeOpenContext.Provider>
    </WorkspaceToolsChromeActionsContext.Provider>
  );
}

export function useWorkspaceToolsChromeOpen(): boolean {
  return useContext(WorkspaceToolsChromeOpenContext);
}

export function useWorkspaceToolsChromeMaximized(): boolean {
  return useContext(WorkspaceToolsChromeMaximizedContext);
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
  maximized: boolean;
  /** True from the first maximize frame through the exit settle, so pinned chrome holds for the strict reverse animation. */
  chromePinned: boolean;
  setOpen: WorkspaceToolsChromeActions["setOpen"];
  toggle: WorkspaceToolsChromeActions["toggle"];
  openTools: WorkspaceToolsChromeActions["openTools"];
  toggleMaximized: WorkspaceToolsChromeActions["toggleMaximized"];
  dismissForNewSession: WorkspaceToolsChromeActions["dismissForNewSession"];
  registerNewSessionChrome: WorkspaceToolsChromeActions["registerNewSessionChrome"];
} {
  const open = useWorkspaceToolsChromeOpen();
  const maximized = useWorkspaceToolsChromeMaximized();
  const flight = useWorkspaceToolsChromeWidthFlight();
  const {
    setOpen,
    toggle,
    openTools,
    toggleMaximized,
    dismissForNewSession,
    registerNewSessionChrome,
  } = useWorkspaceToolsChromeActions();
  return {
    open,
    maximized,
    chromePinned: maximized || flight !== null,
    setOpen,
    toggle,
    openTools,
    toggleMaximized,
    dismissForNewSession,
    registerNewSessionChrome,
  };
}
