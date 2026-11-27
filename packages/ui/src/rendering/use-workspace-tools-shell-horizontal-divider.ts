import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  getWorkspaceToolsShellDividerLeftPx,
  getWorkspaceToolsShellSplit,
  shellLocalLengthFromViewportDelta,
} from "./workspace-tools-panel-edge.js";

type ShellHorizontalDividerEdge = "top" | "bottom";

type UseWorkspaceToolsShellHorizontalDividerOptions = {
  enabled?: boolean;
  edge?: ShellHorizontalDividerEdge;
  dividerAttr: string;
  /** Re-sync when these elements resize (e.g. sibling pane height changes). */
  watchRefs?: RefObject<HTMLElement | null>[];
};

const shellHorizontalDividerRefCounts = new Map<string, number>();

/**
 * Draws one horizontal divider in the workspace tools shell layer, level with an edge of a
 * piece of fixed panel chrome (tab bar, toolbar, pane header), starting at the shell's
 * vertical resize line. The line is positioned from script, so the anchor must not scroll:
 * dividers that belong to scrolling content are rules of that content instead
 * (`rendering/rules.css`).
 */
export function useWorkspaceToolsShellHorizontalDivider(
  anchorRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    edge = "bottom",
    dividerAttr,
    watchRefs = [],
  }: UseWorkspaceToolsShellHorizontalDividerOptions,
  layoutDeps: readonly unknown[] = [],
) {
  const syncRef = useRef<(() => void) | null>(null);
  const watchRefsRef = useRef(watchRefs);
  watchRefsRef.current = watchRefs;

  useLayoutEffect(() => {
    if (!enabled) {
      syncRef.current = null;
      return;
    }

    const shellSplit = getWorkspaceToolsShellSplit();
    if (!shellSplit) {
      syncRef.current = null;
      return;
    }

    let shellDivider = shellSplit.querySelector<HTMLElement>(`[${dividerAttr}]`);
    if (!shellDivider) {
      shellDivider = document.createElement("div");
      shellDivider.setAttribute(dividerAttr, "");
      shellDivider.className = "pointer-events-none absolute right-0 z-20 h-px bg-border/40";
      shellSplit.appendChild(shellDivider);
    }

    shellHorizontalDividerRefCounts.set(
      dividerAttr,
      (shellHorizontalDividerRefCounts.get(dividerAttr) ?? 0) + 1,
    );

    const sync = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        shellDivider!.style.display = "none";
        return;
      }

      if (anchor.getClientRects().length === 0) {
        // When the anchor is not laid out (hidden tabpanel, Tailwind hidden, etc.), it must be hidden, otherwise the previous sync's display:block is kept
        shellDivider!.style.display = "none";
        return;
      }

      const shellRect = shellSplit.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const leftPx = getWorkspaceToolsShellDividerLeftPx(shellSplit);
      const topPx =
        edge === "bottom"
          ? shellLocalLengthFromViewportDelta(anchorRect.bottom - shellRect.top - 1)
          : shellLocalLengthFromViewportDelta(anchorRect.top - shellRect.top);

      shellDivider!.style.display = "block";
      shellDivider!.style.left = `${leftPx}px`;
      shellDivider!.style.right = "0px";
      shellDivider!.style.top = `${topPx}px`;
    };

    syncRef.current = sync;
    sync();

    const resizeObserver = new ResizeObserver(sync);
    const anchor = anchorRef.current;
    if (anchor) {
      resizeObserver.observe(anchor);
    }
    resizeObserver.observe(shellSplit);
    for (const watchRef of watchRefsRef.current) {
      const node = watchRef.current;
      if (node) {
        resizeObserver.observe(node);
      }
    }
    const onWindowResize = () => sync();
    window.addEventListener("resize", onWindowResize);

    return () => {
      syncRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      const ownerCount = (shellHorizontalDividerRefCounts.get(dividerAttr) ?? 1) - 1;
      if (ownerCount <= 0) {
        shellHorizontalDividerRefCounts.delete(dividerAttr);
        shellDivider!.style.display = "none";
      } else {
        shellHorizontalDividerRefCounts.set(dividerAttr, ownerCount);
      }
    };
  }, [anchorRef, dividerAttr, edge, enabled]);

  useLayoutEffect(() => {
    syncRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls layout invalidation
  }, layoutDeps);
}
