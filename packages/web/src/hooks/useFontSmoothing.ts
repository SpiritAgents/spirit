import { useCallback, useState } from "react";

import {
  applyFontSmoothingToDocument,
  getStoredFontSmoothing,
  setStoredFontSmoothing,
} from "@/lib/font-smoothing";

export function useFontSmoothing() {
  const [fontSmoothing, setFontSmoothingState] = useState(() => getStoredFontSmoothing());

  const setFontSmoothing = useCallback((enabled: boolean) => {
    setStoredFontSmoothing(enabled);
    setFontSmoothingState(enabled);
    applyFontSmoothingToDocument(enabled);
  }, []);

  return { fontSmoothing, setFontSmoothing };
}
