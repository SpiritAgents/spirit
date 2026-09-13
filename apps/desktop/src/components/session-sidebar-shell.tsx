import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  DESKTOP_ALL_TRANSLUCENCY_SPLIT_LINE_CLASS,
  DESKTOP_PANE_SPLIT_LINE_CLASS,
  DESKTOP_SIDEBAR_ONLY_SPLIT_LINE_CLASS,
  SESSION_SIDEBAR_MIN_WIDTH_PX,
  computeSessionSidebarMaxWidthPx,
  sessionSidebarShellWidth,
} from "@/lib/desktop-chrome";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { DESKTOP_TRANSLUCENCY_SIDEBAR_TINT_CLASS } from "@/lib/desktop-translucency-surface";
import { writeSessionSidebarWidthPx } from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";

export type SessionSidebarShellProps = {
  minWidthPx?: number;
  maxWidthPx?: number;
  useTranslucency?: boolean;
  /** All-mode content tint; when false with native material on, the split uses the stronger Sidebar-only line. */
  useContentTranslucency?: boolean;
  children: ReactNode;
  className?: string;
};

export function SessionSidebarShell({
  minWidthPx = SESSION_SIDEBAR_MIN_WIDTH_PX,
  maxWidthPx: maxWidthPxProp,
  useTranslucency = false,
  useContentTranslucency = false,
  children,
  className,
}: SessionSidebarShellProps) {
  const { t } = useTranslation();
  const { open, widthPx, setWidthPx } = useSessionSidebarChrome();
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidthPxRef = useRef(widthPx);
  latestWidthPxRef.current = widthPx;
  const [viewportMaxWidthPx, setViewportMaxWidthPx] = useState(computeSessionSidebarMaxWidthPx);
  const maxWidthPx = maxWidthPxProp ?? viewportMaxWidthPx;

  useEffect(() => {
    if (maxWidthPxProp !== undefined) {
      return;
    }
    const onWindowResize = () => {
      setViewportMaxWidthPx(computeSessionSidebarMaxWidthPx());
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [maxWidthPxProp]);

  useEffect(() => {
    if (!open) {
      setIsResizing(false);
    }
  }, [open]);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampWidth(drag.startWidth + delta);
      latestWidthPxRef.current = next;
      setWidthPx(next);
    },
    [clampWidth, setWidthPx],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    if (dragRef.current) {
      writeSessionSidebarWidthPx(latestWidthPxRef.current);
    }
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  const shellWidth = sessionSidebarShellWidth(open, widthPx);
  const innerWidth = `calc(0.25rem + ${widthPx}px)`;

  return (
    <div
      data-spirit-surface="session-sidebar-shell"
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-row self-stretch overflow-hidden",
        useTranslucency ? DESKTOP_TRANSLUCENCY_SIDEBAR_TINT_CLASS : "bg-sidebar",
        isResizing
          ? "transition-none"
          : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0",
        className,
      )}
      style={{ width: shellWidth }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("sidebar.resizeWidth")}
        aria-hidden={!open}
        className={cn(
          "group absolute inset-y-0 right-0 z-10 w-1 touch-none select-none",
          open ? "cursor-col-resize" : "pointer-events-none",
          "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
        )}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <div
          data-spirit-edge="session-sidebar-divider"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-px",
            useContentTranslucency
              ? DESKTOP_ALL_TRANSLUCENCY_SPLIT_LINE_CLASS
              : useTranslucency
                ? DESKTOP_SIDEBAR_ONLY_SPLIT_LINE_CLASS
                : DESKTOP_PANE_SPLIT_LINE_CLASS,
          )}
          aria-hidden
        />
      </div>
      <div
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-row self-stretch",
          !open && "pointer-events-none select-none",
        )}
        style={{ width: innerWidth }}
        aria-hidden={!open}
        inert={!open}
      >
        <div
          data-spirit-surface="session-sidebar"
          className="h-full min-w-0 shrink-0 overflow-hidden"
          style={{ width: widthPx }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
