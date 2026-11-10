import { useLayoutEffect, type RefObject } from "react";

import { scrollIntoViewportWithPadding } from "@/lib/scroll-area-viewport";

type ComposerSuggestionItemDataAttribute =
  | "data-skill-slash-index"
  | "data-workspace-file-reference-index";

/** The Composer suggestion menu keeps focus in the input, so the keyboard-selected item must be scrolled into the ScrollArea viewport manually */
export function useComposerSuggestionMenuKeyboardScroll(
  selectedIndex: number,
  menuRef: RefObject<HTMLElement | null>,
  itemDataAttribute: ComposerSuggestionItemDataAttribute,
) {
  useLayoutEffect(() => {
    if (selectedIndex < 0 || !menuRef.current) {
      return;
    }

    const item = menuRef.current.querySelector<HTMLElement>(
      `[${itemDataAttribute}="${selectedIndex}"]`,
    );
    if (!item) {
      return;
    }

    const viewport = item.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) {
      return;
    }

    scrollIntoViewportWithPadding(viewport, item, menuRef.current.parentElement);
  }, [itemDataAttribute, menuRef, selectedIndex]);
}
