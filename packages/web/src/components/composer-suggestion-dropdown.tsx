import { useEffect, useState, type ReactNode, type RefObject } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_WIDTH,
  stopOverlayScrollPropagation,
} from "@/lib/desktop-chrome";
import { RADIX_OVERLAY_CLOSE_MS, runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { scaleRootFixedAnchorStyle } from "@/lib/scale-root-fixed-anchor-style";
import { cn } from "@/lib/utils";

type ComposerSuggestionDropdownProps = {
  active: boolean;
  anchor: DOMRect | null;
  composerRootRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  onDismiss(): void;
  children: ReactNode;
  contentClassName?: string;
};

function isTargetWithinComposer(
  target: EventTarget | null,
  composerRoot: HTMLElement | null,
): boolean {
  return Boolean(target instanceof Node && composerRoot?.contains(target));
}

function focusComposerEditable(composerRoot: HTMLElement | null): void {
  const editable = composerRoot?.querySelector<HTMLElement>(
    '[contenteditable="true"], textarea, [role="textbox"]',
  );
  if (!editable || document.activeElement === editable) {
    return;
  }
  editable.focus({ preventScroll: true });
}

function isMenuFocusTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest('[data-slot="dropdown-menu-content"]') ||
    target.closest("[data-radix-menu-content]"),
  );
}

export function ComposerSuggestionDropdown({
  active,
  anchor,
  composerRootRef,
  ariaLabel,
  onDismiss,
  children,
  contentClassName,
}: ComposerSuggestionDropdownProps) {
  const [mounted, setMounted] = useState(false);
  const [radixOpen, setRadixOpen] = useState(false);
  // Temporarily force a text cursor until the open animation lands, avoiding a pointer-cursor flash
  // when the menu expands under the pointer; afterwards restore the settings-page pointer/default rules
  const [openCursorSettling, setOpenCursorSettling] = useState(false);
  const [stickyAnchor, setStickyAnchor] = useState<DOMRect | null>(anchor);
  const [frozenChildren, setFrozenChildren] = useState<ReactNode>(children);

  if (active && anchor) {
    if (stickyAnchor !== anchor) {
      setStickyAnchor(anchor);
    }
  }
  if (active && children) {
    if (frozenChildren !== children) {
      setFrozenChildren(children);
    }
  }
  if (active) {
    if (!mounted) {
      setMounted(true);
    }
    if (!radixOpen) {
      setRadixOpen(true);
    }
  } else if (radixOpen) {
    setRadixOpen(false);
  }
  const [previousRadixOpen, setPreviousRadixOpen] = useState(radixOpen);
  if (previousRadixOpen !== radixOpen) {
    setPreviousRadixOpen(radixOpen);
    setOpenCursorSettling(radixOpen);
  }

  useEffect(() => {
    if (!radixOpen) {
      return;
    }
    const timeout = window.setTimeout(() => setOpenCursorSettling(false), RADIX_OVERLAY_CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [radixOpen]);

  // If focus is still grabbed by the menu (e.g. menuitem leave → content.focus), return it to the
  // Composer immediately
  useEffect(() => {
    if (!active || !radixOpen) {
      return;
    }
    const restoreIfStolen = () => {
      if (!isMenuFocusTarget(document.activeElement)) {
        return;
      }
      focusComposerEditable(composerRootRef.current);
    };
    restoreIfStolen();
    const frame = window.requestAnimationFrame(restoreIfStolen);
    document.addEventListener("focusin", restoreIfStolen);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", restoreIfStolen);
    };
  }, [active, composerRootRef, radixOpen]);

  useEffect(() => {
    if (active || !mounted) {
      return;
    }
    const timeout = window.setTimeout(() => setMounted(false), RADIX_OVERLAY_CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [active, mounted]);

  const displayAnchor = anchor ?? stickyAnchor;
  const displayChildren = mounted ? (active ? children : frozenChildren) : null;

  if (!mounted || !displayAnchor) {
    return null;
  }

  const triggerStyle = scaleRootFixedAnchorStyle({
    left: displayAnchor.left,
    top: displayAnchor.top,
    width: Math.max(displayAnchor.width, 1),
    height: Math.max(displayAnchor.height, 1),
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (active) {
        return;
      }
      setRadixOpen(false);
      runAfterRadixOverlayClose(onDismiss);
      return;
    }
    setRadixOpen(true);
  };

  const preventComposerOutsideDismiss = (event: {
    target: EventTarget | null;
    preventDefault(): void;
  }) => {
    if (isTargetWithinComposer(event.target, composerRootRef.current)) {
      event.preventDefault();
    }
  };

  return (
    <DropdownMenu open={radixOpen} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden tabIndex={-1} style={triggerStyle} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        aria-label={ariaLabel}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEntryFocus={(event) => {
          // When opened by keyboard, Radix moves focus to the first menuitem by default; the
          // suggestion menu is navigated via Composer shortcuts, so this must be prevented
          event.preventDefault();
        }}
        onPointerDownOutside={preventComposerOutsideDismiss}
        onInteractOutside={preventComposerOutsideDismiss}
        className={cn(
          DESKTOP_OVERLAY_LIST_CONTENT,
          DESKTOP_OVERLAY_LIST_WIDTH,
          openCursorSettling && "spirit-composer-suggestion-open-settle",
          contentClassName,
        )}
      >
        <ScrollArea
          type="always"
          className={DESKTOP_OVERLAY_LIST_SCROLL_AREA}
          onWheel={stopOverlayScrollPropagation}
          onTouchMove={stopOverlayScrollPropagation}
        >
          <div className={DESKTOP_OVERLAY_LIST_LIST_PADDING}>{displayChildren}</div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
