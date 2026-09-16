import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { sessionSidebarShellWidth } from "@/lib/desktop-chrome";
import { readSessionSidebarWidthPx } from "@/lib/layout-prefs";

type SessionSidebarChromeContextValue = {
  open: boolean;
  widthPx: number;
  setWidthPx(next: number): void;
  toggle(): void;
  openSidebar(): void;
};

const SessionSidebarChromeContext = createContext<SessionSidebarChromeContextValue | null>(null);

export type SessionSidebarChromeApi = {
  open: boolean;
  openSidebar(): void;
  toggle(): void;
};

export type SessionSidebarChromeProviderProps = {
  children: ReactNode;
  apiRef?: React.MutableRefObject<SessionSidebarChromeApi | null>;
};

export function SessionSidebarChromeProvider({
  children,
  apiRef,
}: SessionSidebarChromeProviderProps) {
  const [open, setOpen] = useState(true);
  const [widthPx, setWidthPxState] = useState(readSessionSidebarWidthPx);

  const setWidthPx = useCallback((next: number) => {
    setWidthPxState(next);
  }, []);

  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const openSidebar = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    if (apiRef) {
      apiRef.current = { open, openSidebar, toggle };
    }
  }, [apiRef, open, openSidebar, toggle]);

  useEffect(() => {
    // The workspace-tools maximized pin (Win/Linux + macOS fullscreen) anchors its fixed left
    // offset to the main content's left edge, i.e. the sidebar shell's current width.
    document.documentElement.style.setProperty(
      "--spirit-session-sidebar-shell-width",
      sessionSidebarShellWidth(open, widthPx),
    );
  }, [open, widthPx]);

  const value = useMemo(
    () => ({
      open,
      widthPx,
      setWidthPx,
      toggle,
      openSidebar,
    }),
    [open, openSidebar, setWidthPx, toggle, widthPx],
  );

  return (
    <SessionSidebarChromeContext.Provider value={value}>
      {children}
    </SessionSidebarChromeContext.Provider>
  );
}

export function useSessionSidebarChrome(): SessionSidebarChromeContextValue {
  const value = useContext(SessionSidebarChromeContext);
  if (!value) {
    throw new Error("useSessionSidebarChrome must be used within SessionSidebarChromeProvider");
  }
  return value;
}
