import { useState } from "react";

/**
 * The keyboard default selection only serves non-mouse users; once the pointer enters the menu it is mutually exclusive with it, and after leaving the menu all highlight disappears (the keyboard item is not restored).
 */
export function useComposerSuggestionMenuHighlight(selectedIndex: number, itemCount: number) {
  const selectionKey = `${itemCount}:${selectedIndex}`;
  const [pointerHighlight, setPointerHighlight] = useState<{
    selectionKey: string;
    hoveredIndex: number | null;
    dismissed: boolean;
  }>({ selectionKey, hoveredIndex: null, dismissed: false });
  const current =
    pointerHighlight.selectionKey === selectionKey
      ? pointerHighlight
      : { selectionKey, hoveredIndex: null, dismissed: false };

  const highlightedIndex = current.dismissed ? -1 : (current.hoveredIndex ?? selectedIndex);

  return {
    highlightedIndex,
    menuPointerHandlers: {
      onMouseLeave: () => {
        setPointerHighlight({ selectionKey, hoveredIndex: null, dismissed: true });
      },
    },
    getItemPointerHandlers: (index: number) => ({
      onMouseEnter: () => {
        setPointerHighlight({ selectionKey, hoveredIndex: index, dismissed: false });
      },
    }),
  };
}
