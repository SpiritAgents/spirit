/** LaunchSplash / OOBE overlay tint when translucency is on (tint only; no CSS backdrop-blur stacked). */
export const DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS = "bg-background/70";

// The composer surface family (backdrop, edge, elevation shadow, reduced-transparency hook)
// lives in @spiritagent/ui/chrome; re-exported here so desktop consumers keep one import site.
export {
  DESKTOP_COMPOSER_EDGE,
  DESKTOP_COMPOSER_EDGE_HOVER,
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
  DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT,
  DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT as DESKTOP_COMPOSER_SURFACE_SOLID,
  DESKTOP_ELEVATION_SHADOW_SM,
  DESKTOP_OVERLAY_LIGHT_SHADOW,
  DESKTOP_REDUCED_TRANSPARENCY_OPAQUE_CLASS,
  desktopComposerChipSurfaceClass,
  desktopComposerSurfaceBackdropClass,
} from "@spiritagent/ui/chrome";

/** Sidebar: a light tint under translucency so the system material stays legible. */
export const DESKTOP_TRANSLUCENCY_SIDEBAR_TINT_CLASS = "bg-background/45";

/** Windows custom-drawn title bar: leading segment matches the sidebar tint; the trailing (main-area) segment is solid. */
export const DESKTOP_TRANSLUCENCY_TITLE_BAR_TINT_CLASS = DESKTOP_TRANSLUCENCY_SIDEBAR_TINT_CLASS;

/** Workspace browser page slot: slightly more opaque under translucency to reduce WebView show-through flicker. */
export const DESKTOP_TRANSLUCENCY_BROWSER_TINT_CLASS = "bg-background/80";

/** Workspace terminal: keeps higher opacity for ANSI legibility. */
export const DESKTOP_TRANSLUCENCY_TERMINAL_TINT_CLASS = "bg-background/87";

/** File detail preview area (translucency off): light tint to distinguish it from the file tree. */
export const DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS = "bg-background/30";

const SOLID_BACKGROUND_CLASS = "bg-background";
const TRANSPARENT_BACKGROUND_CLASS = "bg-transparent";

/**
 * Outer layer of the main content area: All-mode translucent theme tint, solid background otherwise.
 */
export function desktopTranslucencyTintClass(useTranslucency: boolean): string {
  return useTranslucency ? DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/**
 * LaunchSplash / OOBE fullscreen overlay tint.
 * On exit the whole layer (including the background tint) fades out with opacity — the
 * background itself participates in the fade, so the tint stays constant and never switches
 * to transparent mid-way.
 */
export function desktopFullscreenOverlayTintClass(useTranslucency: boolean): string {
  return useTranslucency ? DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** Inner layer of the main content area: transparent under translucency to avoid stacking multiple alpha layers darker, solid background otherwise. */
export function desktopTranslucencyTintInnerClass(useTranslucency: boolean): string {
  return useTranslucency ? TRANSPARENT_BACKGROUND_CLASS : SOLID_BACKGROUND_CLASS;
}

/** Fullscreen page slot of the workspace browser. */
export function desktopTranslucencyBrowserTintClass(useTranslucency: boolean): string {
  return useTranslucency ? DESKTOP_TRANSLUCENCY_BROWSER_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** Workspace integrated terminal container. */
export function desktopTranslucencyTerminalTintClass(useTranslucency: boolean): string {
  return useTranslucency ? DESKTOP_TRANSLUCENCY_TERMINAL_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** File detail preview/edit slot: transparent under translucency to avoid stacking darker with the panel tint, light tint otherwise. */
export function desktopTranslucencyFileDetailSurfaceClass(useTranslucency: boolean): string {
  return useTranslucency ? TRANSPARENT_BACKGROUND_CLASS : DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS;
}

/** Windows custom-drawn title bar: sidebar-matched tint on the leading segment under translucency, solid sidebar color otherwise. */
export function desktopTranslucencyTitleBarTintClass(useTranslucency: boolean): string {
  return useTranslucency ? DESKTOP_TRANSLUCENCY_TITLE_BAR_TINT_CLASS : "bg-chrome-background";
}
