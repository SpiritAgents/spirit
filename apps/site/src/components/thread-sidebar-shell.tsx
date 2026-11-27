import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "@/lib/desktop-preview-i18n";
import { resizeCursor, useDragResizeCursor } from "@spiritagent/ui/resize-cursor";

import {
  THREAD_SIDEBAR_MIN_WIDTH_PX,
  computeThreadSidebarMaxWidthPx,
  threadSidebarShellWidth,
} from "@/lib/desktop-chrome";
import { useThreadSidebarChrome } from "@/contexts/thread-sidebar-chrome-context";
import { writeThreadSidebarWidthPx } from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";

export type ThreadSidebarShellProps = {
  minWidthPx?: number;
  maxWidthPx?: number;
  useTranslucency?: boolean;
  children: ReactNode;
  className?: string;
};

export function ThreadSidebarShell({
  minWidthPx = THREAD_SIDEBAR_MIN_WIDTH_PX,
  maxWidthPx: maxWidthPxProp,
  useTranslucency = false,
  children,
  className,
}: ThreadSidebarShellProps) {
  const { t } = useTranslation();
  const { open, widthPx, setWidthPx } = useThreadSidebarChrome();
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dragCursor = useDragResizeCursor();
  const latestWidthPxRef = useRef(widthPx);
  useLayoutEffect(() => {
    latestWidthPxRef.current = widthPx;
  }, [widthPx]);
  const [viewportMaxWidthPx, setViewportMaxWidthPx] = useState(computeThreadSidebarMaxWidthPx);
  const maxWidthPx = maxWidthPxProp ?? viewportMaxWidthPx;

  useEffect(() => {
    if (maxWidthPxProp !== undefined) {
      return;
    }
    const onWindowResize = () => {
      setViewportMaxWidthPx(computeThreadSidebarMaxWidthPx());
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [maxWidthPxProp]);

  if (!open && isResizing) {
    setIsResizing(false);
  }

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      dragCursor.start(resizeCursor(widthPx, minWidthPx, maxWidthPx, "right"));
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragCursor, maxWidthPx, minWidthPx, widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampWidth(drag.startWidth + delta);
      dragCursor.update(resizeCursor(next, minWidthPx, maxWidthPx, "right"));
      latestWidthPxRef.current = next;
      setWidthPx(next);
    },
    [clampWidth, dragCursor, maxWidthPx, minWidthPx, setWidthPx],
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragCursor.end();
      setIsResizing(false);
      if (dragRef.current) {
        writeThreadSidebarWidthPx(latestWidthPxRef.current);
      }
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    },
    [dragCursor],
  );

  const shellWidth = threadSidebarShellWidth(open, widthPx);
  const innerWidth = `${widthPx}px`;

  return (
    <div
      data-spirit-surface="thread-sidebar-shell"
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-row self-stretch overflow-hidden",
        !useTranslucency && "bg-chrome-background",
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
        aria-label={t("threadSidebar.resizeWidth")}
        aria-hidden={!open}
        className={cn(
          "group absolute inset-y-0 right-0 z-10 w-1 touch-none select-none",
          !open && "pointer-events-none",
          "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
        )}
        style={{ cursor: resizeCursor(widthPx, minWidthPx, maxWidthPx, "right") }}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-px transition-colors",
            useTranslucency
              ? "bg-black/5 group-hover:bg-black/10 dark:bg-white/10 dark:group-hover:bg-white/14"
              : "bg-border/40 group-hover:bg-border/55",
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
          data-spirit-surface="thread-sidebar"
          className="h-full min-w-0 shrink-0 overflow-hidden"
          style={{ width: widthPx }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
