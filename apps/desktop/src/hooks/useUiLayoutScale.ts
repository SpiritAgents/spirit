import { useCallback, useRef } from "react";

import {
  applyUiLayoutScaleToDocument,
  DEFAULT_UI_LAYOUT_SCALE,
  getStoredUiLayoutScale,
  setStoredUiLayoutScale,
  stepUiLayoutScale,
} from "@/lib/ui-layout-scale";

export function useUiLayoutScale() {
  const scaleRef = useRef(getStoredUiLayoutScale());

  const applyScale = useCallback((next: number) => {
    scaleRef.current = next;
    setStoredUiLayoutScale(next);
    applyUiLayoutScaleToDocument(next);
  }, []);

  const setScale = useCallback(
    (next: number) => {
      applyScale(next);
    },
    [applyScale],
  );

  const zoomIn = useCallback(() => {
    applyScale(stepUiLayoutScale(scaleRef.current, "in"));
  }, [applyScale]);

  const zoomOut = useCallback(() => {
    applyScale(stepUiLayoutScale(scaleRef.current, "out"));
  }, [applyScale]);

  const resetScale = useCallback(() => {
    applyScale(DEFAULT_UI_LAYOUT_SCALE);
  }, [applyScale]);

  return { scale: scaleRef.current, setScale, zoomIn, zoomOut, resetScale };
}
