import { useLayoutEffect, useState, type CSSProperties } from "react";

/**
 * Occlusion for a top-docked translucent header: clips scroll content inside the header's
 * band so the window-level system material shows through the transparent header instead of
 * the content scrolling beneath it (same goal as the composer dock's shape mask).
 * Apply the returned style to the ScrollArea ROOT (not the viewport) so the scrollbar thumb
 * is clipped as well; the header element itself must live outside the ScrollArea, because
 * the clip applies to every DOM descendant of the clipped element.
 *
 * clip-path (not mask-image): an alpha mask forces a full re-raster of the scrolled layer,
 * which Chromium defers until fast scrolling settles (~0.5s of bleed-through at the pin
 * moment). A geometric inset clip is compositor-only and takes effect in the same frame.
 */
export function buildScrollTopBandOcclusionStyle(
  host: HTMLElement,
  bandHeight: number,
): CSSProperties | undefined {
  const band = Math.min(Math.max(0, bandHeight), host.clientHeight);
  if (host.clientWidth <= 0 || host.clientHeight <= 0 || band <= 0) {
    return undefined;
  }
  return { clipPath: `inset(${band}px 0 0 0)` };
}

/**
 * Measures the band element (the docked header) and keeps the occlusion clip in sync with
 * viewport/band resizes. `bandHeight` is measured regardless of `enabled` so callers can
 * also reserve the header's flow space (placeholder) before the clip is needed.
 * `scrollAreaRoot` is the root element (state, not a ref) so the clip re-attaches when the
 * ScrollArea unmounts/remounts while the caller stays mounted (e.g. detail navigation).
 */
export function useScrollTopBandOcclusion(
  scrollAreaRoot: HTMLElement | null,
  bandElement: HTMLElement | null,
  enabled: boolean,
): { occlusionStyle: CSSProperties | undefined; bandHeight: number | null } {
  const [bandHeight, setBandHeight] = useState<number | null>(null);
  const [occlusionStyle, setOcclusionStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (!bandElement) {
      setBandHeight(null);
      return;
    }
    const sync = () => {
      setBandHeight(bandElement.offsetHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bandElement);
    return () => observer.disconnect();
  }, [bandElement]);

  useLayoutEffect(() => {
    if (!enabled || bandHeight == null || bandHeight <= 0 || !scrollAreaRoot) {
      setOcclusionStyle(undefined);
      return;
    }
    const root = scrollAreaRoot;
    const sync = () => {
      setOcclusionStyle(buildScrollTopBandOcclusionStyle(root, bandHeight));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      setOcclusionStyle(undefined);
    };
  }, [bandHeight, enabled, scrollAreaRoot]);

  return { occlusionStyle, bandHeight };
}
