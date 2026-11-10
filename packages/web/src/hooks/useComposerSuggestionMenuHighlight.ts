import { useEffect, useState } from "react";

/**
 * The keyboard default selection only serves non-mouse users; once the pointer enters the menu it is mutually exclusive with it, and after leaving the menu all highlight disappears (the keyboard item is not restored).
 */
export function useComposerSuggestionMenuHighlight(selectedIndex: number, itemCount: number) {
  const [pointerHoveredIndex, setPointerHoveredIndex] = useState<number | null>(null);
  const [pointerDismissedHighlight, setPointerDismissedHighlight] = useState(false);

  useEffect(() => {
    setPointerHoveredIndex(null);
    setPointerDismissedHighlight(false);
  }, [itemCount, selectedIndex]);

  const highlightedIndex = pointerDismissedHighlight ? -1 : (pointerHoveredIndex ?? selectedIndex);

  return {
    highlightedIndex,
    menuPointerHandlers: {
      onMouseLeave: () => {
        setPointerHoveredIndex(null);
        setPointerDismissedHighlight(true);
      },
    },
    getItemPointerHandlers: (index: number) => ({
      onMouseEnter: () => {
        setPointerDismissedHighlight(false);
        setPointerHoveredIndex(index);
      },
    }),
  };
}
