import { useCallback, useState } from "react";

import {
  applyUiLayoutScale,
  DEFAULT_UI_LAYOUT_SCALE,
  getStoredUiLayoutScale,
  setStoredUiLayoutScale,
  stepUiLayoutScale,
} from "@/lib/ui-layout-scale";

export function useUiLayoutScale() {
  const [scale, setScaleState] = useState(getStoredUiLayoutScale);

  const applyScale = useCallback((next: number) => {
    setScaleState(next);
    setStoredUiLayoutScale(next);
    applyUiLayoutScale(next);
  }, []);

  const setScale = useCallback(
    (next: number) => {
      applyScale(next);
    },
    [applyScale],
  );

  const zoomIn = useCallback(() => {
    applyScale(stepUiLayoutScale(scale, "in"));
  }, [applyScale, scale]);

  const zoomOut = useCallback(() => {
    applyScale(stepUiLayoutScale(scale, "out"));
  }, [applyScale, scale]);

  const resetScale = useCallback(() => {
    applyScale(DEFAULT_UI_LAYOUT_SCALE);
  }, [applyScale]);

  return { scale, setScale, zoomIn, zoomOut, resetScale };
}
