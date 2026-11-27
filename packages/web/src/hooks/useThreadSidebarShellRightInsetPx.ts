import { useLayoutEffect, useState, type RefObject } from "react";

const THREAD_SIDEBAR_SHELL_SELECTOR = '[data-spirit-surface="thread-sidebar-shell"]';
const THREAD_SIDEBAR_DIVIDER_SELECTOR = '[data-spirit-edge="thread-sidebar-divider"]';

/** Left edge of the title bar divider: aligned with the DOM left edge of the sidebar vertical line (including collapse/expand CSS transition frames). */
export function useThreadSidebarShellRightInsetPx(
  anchorRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [insetPx, setInsetPx] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const sync = () => {
      const anchor = anchorRef.current;
      const shell = document.querySelector(THREAD_SIDEBAR_SHELL_SELECTOR);
      if (!anchor || !shell) {
        setInsetPx(0);
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const sidebarDivider = shell.querySelector(THREAD_SIDEBAR_DIVIDER_SELECTOR);
      const sidebarDividerRect = sidebarDivider?.getBoundingClientRect();
      const dividerLeftPx = sidebarDividerRect
        ? sidebarDividerRect.left - anchorRect.left
        : shellRect.right - anchorRect.left;
      const nextInset = Math.max(0, Math.round(dividerLeftPx));
      setInsetPx(nextInset);
    };

    sync();
    const shell = document.querySelector(THREAD_SIDEBAR_SHELL_SELECTOR);
    if (!shell) {
      return;
    }

    const ro = new ResizeObserver(sync);
    ro.observe(shell);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [anchorRef, enabled]);

  return enabled ? insetPx : 0;
}
