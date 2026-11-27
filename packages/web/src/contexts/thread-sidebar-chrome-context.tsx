import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { threadSidebarShellWidth } from "@/lib/desktop-chrome";
import { readThreadSidebarWidthPx } from "@/lib/layout-prefs";

type ThreadSidebarChromeContextValue = {
  open: boolean;
  widthPx: number;
  setWidthPx(next: number): void;
  toggle(): void;
  openSidebar(): void;
};

const ThreadSidebarChromeContext = createContext<ThreadSidebarChromeContextValue | null>(null);

export type ThreadSidebarChromeApi = {
  open: boolean;
  openSidebar(): void;
  toggle(): void;
};

export type ThreadSidebarChromeProviderProps = {
  children: ReactNode;
  apiRef?: React.MutableRefObject<ThreadSidebarChromeApi | null>;
};

export function ThreadSidebarChromeProvider({
  children,
  apiRef,
}: ThreadSidebarChromeProviderProps) {
  const [open, setOpen] = useState(true);
  const [widthPx, setWidthPxState] = useState(readThreadSidebarWidthPx);

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
    // The workspace-tools full-screen pin (Win/Linux + macOS window fullscreen) anchors its
    // fixed left offset to the main content's left edge, i.e. the sidebar shell's current width.
    document.documentElement.style.setProperty(
      "--spirit-thread-sidebar-shell-width",
      threadSidebarShellWidth(open, widthPx),
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
    <ThreadSidebarChromeContext.Provider value={value}>
      {children}
    </ThreadSidebarChromeContext.Provider>
  );
}

export function useThreadSidebarChrome(): ThreadSidebarChromeContextValue {
  const value = useContext(ThreadSidebarChromeContext);
  if (!value) {
    throw new Error("useThreadSidebarChrome must be used within ThreadSidebarChromeProvider");
  }
  return value;
}
