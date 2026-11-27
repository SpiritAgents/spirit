import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialWidthPx?: number;
};

export function ThreadSidebarChromeProvider({
  children,
  apiRef,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  initialWidthPx,
}: ThreadSidebarChromeProviderProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [onOpenChange, openProp],
  );

  const [widthPx, setWidthPxState] = useState(() => initialWidthPx ?? readThreadSidebarWidthPx());

  const setWidthPx = useCallback((next: number) => {
    setWidthPxState(next);
  }, []);

  const toggle = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const openSidebar = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  useEffect(() => {
    if (apiRef) {
      apiRef.current = { open, openSidebar, toggle };
    }
  }, [apiRef, open, openSidebar, toggle]);

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
