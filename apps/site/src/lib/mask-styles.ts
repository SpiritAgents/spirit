import type { CSSProperties } from "react";

/** Horizontal fade at the end edge (workspace tab close button etc.). */
export const maskFadeHorizontalEnd: CSSProperties = {
  maskImage: "linear-gradient(to right, transparent, black 50%)",
  WebkitMaskImage: "linear-gradient(to right, transparent, black 50%)",
};

/** Session sidebar: fixed gap between the top-bar buttons and the scrollable list below (unrelated to the fade mask / translucency). */
export const sidebarSessionsScrollTopGapClass = "pt-4";

/**
 * Horizontal left/right edge fade: same algorithm as the thread-sidebar vertical masks
 * (mask-image + interpolable alpha); clipped content turns transparent to reveal the
 * background below, without hardcoding a mask color.
 */
const HORIZONTAL_EDGE_FADE_MASK =
  "linear-gradient(to right, rgb(0 0 0 / var(--mask-fade-left-alpha)) 0, black 1.25rem, black calc(100% - 1.25rem), rgb(0 0 0 / var(--mask-fade-right-alpha)) 100%)";

/** When `left` / `right` is true, the corresponding edge fade is visible; `rightDurationMs` lets the right edge transition slower than the left. */
export function horizontalEdgeFadeMaskStyle(
  left: boolean,
  right: boolean,
  options?: { animate?: boolean; durationMs?: number; rightDurationMs?: number },
): CSSProperties {
  const durationMs = options?.durationMs ?? 150;
  const rightDurationMs = options?.rightDurationMs ?? durationMs;
  return {
    "--mask-fade-left-alpha": left ? "0" : "1",
    "--mask-fade-right-alpha": right ? "0" : "1",
    maskImage: HORIZONTAL_EDGE_FADE_MASK,
    WebkitMaskImage: HORIZONTAL_EDGE_FADE_MASK,
    ...(options?.animate
      ? {
          transition: `--mask-fade-left-alpha ${durationMs}ms, --mask-fade-right-alpha ${rightDurationMs}ms`,
        }
      : { transition: "none" }),
  } as unknown as CSSProperties;
}
