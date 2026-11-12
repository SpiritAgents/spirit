import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import {
  CONVERSATION_SPLIT_SHELL_DIVIDER_ATTR,
  conversationSplitShellInsetBounds,
  conversationSplitShellLocalLength,
  getConversationSplitShell,
} from "@/lib/conversation-split-shell-edge";

type ConversationSplitShellLineOrientation = "horizontal" | "vertical";

type UseConversationSplitShellDividerOptions = {
  splitId: string;
  lineOrientation: ConversationSplitShellLineOrientation;
  /** Clip range: the owning split container; neither horizontal nor vertical lines are drawn outside it. */
  boundsRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  active?: boolean;
};

function shellDividerSelector(splitId: string): string {
  return `[${CONVERSATION_SPLIT_SHELL_DIVIDER_ATTR}="${CSS.escape(splitId)}"]`;
}

const shellDividerRefCounts = new Map<string, number>();
const shellDividerSyncFns = new Set<() => void>();

export function syncAllConversationSplitShellDividers(): void {
  for (const sync of shellDividerSyncFns) {
    sync();
  }
}

const SHELL_LINE_BASE_CLASS = "pointer-events-none absolute z-20 bg-border/40 transition-colors";
const SHELL_LINE_ACTIVE_CLASS = "pointer-events-none absolute z-20 bg-border/55 transition-colors";

export function useConversationSplitShellDivider(
  anchorRef: RefObject<HTMLElement | null>,
  {
    splitId,
    lineOrientation,
    boundsRef,
    enabled = true,
    active = false,
  }: UseConversationSplitShellDividerOptions,
  layoutDeps: readonly unknown[] = [],
) {
  const syncRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    if (!enabled || !splitId.trim()) {
      syncRef.current = null;
      return;
    }

    const shell = getConversationSplitShell();
    if (!shell) {
      syncRef.current = null;
      return;
    }

    let shellLine = shell.querySelector<HTMLElement>(shellDividerSelector(splitId));
    if (!shellLine) {
      shellLine = document.createElement("div");
      shellLine.setAttribute(CONVERSATION_SPLIT_SHELL_DIVIDER_ATTR, splitId);
      shellLine.className = SHELL_LINE_BASE_CLASS;
      shell.appendChild(shellLine);
    }

    shellDividerRefCounts.set(splitId, (shellDividerRefCounts.get(splitId) ?? 0) + 1);

    const sync = () => {
      const anchor = anchorRef.current;
      if (!anchor || anchor.getClientRects().length === 0) {
        shellLine!.style.display = "none";
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const computedTop =
        lineOrientation === "horizontal"
          ? conversationSplitShellLocalLength(anchorRect.top - shellRect.top)
          : null;
      const computedLeft =
        lineOrientation === "vertical"
          ? conversationSplitShellLocalLength(anchorRect.left - shellRect.left)
          : null;

      shellLine!.style.display = "block";
      shellLine!.className = activeRef.current ? SHELL_LINE_ACTIVE_CLASS : SHELL_LINE_BASE_CLASS;

      const bounds = boundsRef?.current;
      const insetBounds =
        bounds && bounds.getClientRects().length > 0
          ? conversationSplitShellInsetBounds(shell, bounds)
          : { topPx: 0, rightPx: 0, bottomPx: 0, leftPx: 0 };

      if (lineOrientation === "vertical") {
        shellLine!.style.top = `${insetBounds.topPx}px`;
        shellLine!.style.bottom = `${insetBounds.bottomPx}px`;
        shellLine!.style.left = `${computedLeft}px`;
        shellLine!.style.right = "";
        shellLine!.style.width = "1px";
        shellLine!.style.height = "";
      } else {
        shellLine!.style.left = `${insetBounds.leftPx}px`;
        shellLine!.style.right = `${insetBounds.rightPx}px`;
        shellLine!.style.top = `${computedTop}px`;
        shellLine!.style.bottom = "";
        shellLine!.style.width = "";
        shellLine!.style.height = "1px";
      }
    };

    syncRef.current = sync;
    shellDividerSyncFns.add(sync);
    sync();

    const resizeObserver = new ResizeObserver(() => {
      sync();
    });
    const anchor = anchorRef.current;
    if (anchor) {
      resizeObserver.observe(anchor);
    }
    const bounds = boundsRef?.current;
    if (bounds) {
      resizeObserver.observe(bounds);
    }
    resizeObserver.observe(shell);
    const onWindowResize = () => {
      sync();
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      syncRef.current = null;
      shellDividerSyncFns.delete(sync);
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      const ownerCount = (shellDividerRefCounts.get(splitId) ?? 1) - 1;
      if (ownerCount <= 0) {
        shellDividerRefCounts.delete(splitId);
        shellLine!.remove();
      } else {
        shellDividerRefCounts.set(splitId, ownerCount);
      }
    };
  }, [anchorRef, enabled, lineOrientation, splitId]);

  useLayoutEffect(() => {
    syncRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls layout invalidation
  }, [active, ...layoutDeps]);

  const sync = useCallback(() => {
    syncRef.current?.();
  }, []);

  return { sync };
}
