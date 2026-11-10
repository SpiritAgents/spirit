import { useCallback, useState } from "react";

import {
  applyClickablePointerCursorToDocument,
  getStoredClickablePointerCursor,
  setStoredClickablePointerCursor,
} from "@/lib/clickable-pointer-cursor";

export function useClickablePointerCursor() {
  const [clickablePointerCursor, setClickablePointerCursorState] = useState(() =>
    getStoredClickablePointerCursor(),
  );

  const setClickablePointerCursor = useCallback((enabled: boolean) => {
    setStoredClickablePointerCursor(enabled);
    setClickablePointerCursorState(enabled);
    applyClickablePointerCursorToDocument(enabled);
  }, []);

  return { clickablePointerCursor, setClickablePointerCursor };
}
