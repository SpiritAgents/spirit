import type { CSSProperties } from "react";

/** Horizontal end fade-out (workspace tab close button, etc.): slightly stronger than the default 50%, with the solid zone limited to near the X. */
export const maskFadeHorizontalEnd: CSSProperties = {
  maskImage: "linear-gradient(to right, transparent 0%, black 42%)",
  WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 42%)",
};

/** Session sidebar: fixed gap between the top-bar buttons and the scroll list below (unrelated to the fade mask / translucency). */
export const sidebarSessionsScrollTopGapClass = "pt-4";

/** List bottom-edge fade-out: shares `--sidebar-mask-bottom-alpha` and the 150ms transition with session-sidebar. */
const LIST_BOTTOM_SCROLL_FADE_MASK =
  "linear-gradient(to bottom, black calc(100% - 56px), rgb(0 0 0 / var(--sidebar-mask-bottom-alpha)) 100%)";

/** The bottom-edge fade-out is visible when `hasMoreBelow` is true; it fades away when scrolled to the bottom. */
export function bottomScrollFadeMaskStyle(
  hasMoreBelow: boolean,
  options?: { animate?: boolean },
): CSSProperties {
  return {
    "--sidebar-mask-bottom-alpha": hasMoreBelow ? "0" : "1",
    maskImage: LIST_BOTTOM_SCROLL_FADE_MASK,
    WebkitMaskImage: LIST_BOTTOM_SCROLL_FADE_MASK,
    ...(options?.animate !== false ? { transition: "--sidebar-mask-bottom-alpha 150ms" } : {}),
  } as CSSProperties;
}

const DEFAULT_TOP_FADE_PX = 32;

/**
 * Top-edge fade-out below a top-docked header: same alpha-mask approach as the onboarding
 * connect list's bottom fade, shifted down by the header band (`bandHeightPx`). Content
 * fades out toward the header instead of being covered by a painted shadow, so the window
 * system material stays visible through it. `active` animates via the registered custom
 * property (150ms fade in/out).
 */
export function topScrollFadeMaskStyle(
  active: boolean,
  options?: { bandHeightPx?: number; fadePx?: number; animate?: boolean },
): CSSProperties {
  const band = Math.max(0, options?.bandHeightPx ?? 0);
  const fade = options?.fadePx ?? DEFAULT_TOP_FADE_PX;
  const maskImage = `linear-gradient(to bottom, rgb(0 0 0 / 0) ${band}px, rgb(0 0 0 / var(--list-mask-top-alpha)) ${band}px, rgb(0 0 0 / 1) calc(${band}px + ${fade}px))`;
  return {
    "--list-mask-top-alpha": active ? "0" : "1",
    maskImage,
    WebkitMaskImage: maskImage,
    ...(options?.animate !== false ? { transition: "--list-mask-top-alpha 150ms" } : {}),
  } as CSSProperties;
}
