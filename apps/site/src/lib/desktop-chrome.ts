import { cn } from "@/lib/utils";
import { DESKTOP_OVERLAY_LIGHT_SHADOW } from "@/lib/desktop-translucency-surface";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

/**
 * Instant hover fill — exclude background-color from transitions (session-sidebar precedent).
 * Keeps existing hover:bg-* overlays; only removes bg fade in/out on hover.
 */
export const instantHoverMotionClass = "!transition-[opacity,transform,box-shadow] duration-150";

/** Sidebar shell / top-bar slot width transition, aligned with SessionSidebarShell */
export const DESKTOP_SHELL_LAYOUT_TRANSITION =
  "transition-[width,margin,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0";

/** Top-bar default text/icon color, aligned with the sidebar `sidebarItemDefaultTextClass` */
export const DESKTOP_CHROME_MUTED_TEXT = "text-sidebar-action-foreground";

/** Top-bar session title hover: text color only, no translucent fill */
export const DESKTOP_SESSION_TITLE_HOVER_CLASS = cn(
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
  instantHoverMotionClass,
);

/** Top-bar hover/focus/current-item text color, aligned with the sidebar `sidebarItemActiveTextClass` */
export const DESKTOP_CHROME_ACTIVE_TEXT = "text-sidebar-foreground";

/** ghost defaults to bg-muted when aria-expanded; top-bar icon buttons need a fully transparent background */
export const DESKTOP_CHROME_TOGGLE_ICON_BTN = cn(
  "electron-no-drag size-7 shrink-0 bg-transparent",
  DESKTOP_CHROME_MUTED_TEXT,
  "hover:bg-foreground/[0.06] hover:text-sidebar-foreground focus-visible:bg-foreground/[0.06] focus-visible:text-sidebar-foreground",
  "dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]",
  "aria-expanded:bg-transparent dark:aria-expanded:bg-transparent aria-expanded:text-sidebar-action-foreground",
  "aria-expanded:hover:bg-foreground/[0.06] aria-expanded:hover:text-sidebar-foreground dark:aria-expanded:hover:bg-white/[0.06]",
  "[&_svg]:size-3.5",
  instantHoverMotionClass,
);

export const DESKTOP_CHROME_COMMIT_BTN = cn(
  "h-7 rounded-md px-2 text-xs text-foreground/90 hover:bg-foreground/[0.06] hover:text-sidebar-foreground dark:hover:bg-foreground/10",
  FONT_WEIGHT_NORMAL,
  instantHoverMotionClass,
);

/** Git changes section primary button (ButtonGroup segment, with `size="xs"`); `border-r-0` avoids the transparent right border looking too thick over the separator */
export const DESKTOP_GIT_ACTION_BTN = cn("border-r-0 shadow-none", instantHoverMotionClass);

/** Git ButtonGroup middle divider (`ButtonGroupSeparator`); `!bg-*` overrides the Separator defaults bg-border / bg-input */
export const DESKTOP_GIT_ACTION_SPLIT = cn(
  "!my-0 !mx-0 h-auto w-px min-w-px max-w-px shrink-0 self-stretch !border-0 !bg-border-0 !bg-[var(--git-action-split)] !p-0",
);

/** Git ButtonGroup right-side dropdown trigger */
export const DESKTOP_GIT_ACTION_MENU_TRIGGER = cn(
  DESKTOP_GIT_ACTION_BTN,
  "w-6 min-w-6 max-w-6 rounded-l-none rounded-r-md px-0",
);

/**
 * Overlay menu density: LIST density (text-xs / py-2) everywhere, aligned with the model / workspace pickers.
 * The SHORT series is kept only for local spots that still need text-sm density.
 */

/** Overlay shadow: light diffuse + dark keeps md */
export const DESKTOP_OVERLAY_SHADOW = cn(DESKTOP_OVERLAY_LIGHT_SHADOW, "dark:shadow-md");

/** Overlay shadow: light diffuse + dark keeps lg (Tooltip / Popover / HoverCard etc.) */
export const DESKTOP_OVERLAY_SHADOW_LG = cn(DESKTOP_OVERLAY_LIGHT_SHADOW, "dark:shadow-lg");

/** Short list: light shell (local spots only) */
export const DESKTOP_OVERLAY_SHORT_SHELL = cn("rounded-lg ring-0", DESKTOP_OVERLAY_SHADOW);

export const DESKTOP_OVERLAY_SHORT_CONTENT = cn(DESKTOP_OVERLAY_SHORT_SHELL, "p-1 text-sm");

/** Dropdown primitive: short-list shell + popover surface */
export const DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_SHORT_SHELL,
  "border border-border/80 bg-popover p-1 text-sm text-popover-foreground",
);

export const DESKTOP_OVERLAY_SHORT_SUBCONTENT = cn(
  DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE,
  "min-w-[8.5rem]",
);

export const DESKTOP_OVERLAY_SHORT_ITEM = "px-2 py-1.5 text-sm";

export const DESKTOP_OVERLAY_SHORT_LIST_PADDING = "p-1";

export const DESKTOP_OVERLAY_SHORT_LIST_GAP = "gap-0.5";

/** Business-local classes that only add a minimum width */
export const DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH = "min-w-[8.5rem]";

/** Long list: disable the base overflow-y-auto so the inner ScrollArea owns scrolling */
export const DESKTOP_OVERLAY_LIST_CONTENT = "max-h-none overflow-hidden p-0 text-xs";

export const DESKTOP_OVERLAY_LIST_SHELL = cn("min-w-0 rounded-lg ring-0", DESKTOP_OVERLAY_SHADOW);

/** Dropdown primitive: long-list shell + popover surface (density aligned with the model / workspace pickers) */
export const DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  "border border-border/80 bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(19rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_FILTER_HEADER = "shrink-0 border-b border-border/40 p-1.5";

/** Matches the PendingApprovalCard guidance input: thin-bordered shell, inner Input without ring */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL =
  "overflow-hidden rounded-md border border-input bg-transparent focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20";

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT =
  "h-7 min-h-7 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0";

/** ghost: transparent background matching the popover; overrides the Input base dark:bg-input/30 */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST = cn(
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  "rounded-md dark:!bg-transparent",
);

/** Standard form input: matches the PendingApprovalCard guidance input (h-8) */
export const DESKTOP_FORM_INPUT_SHELL = DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL;

export const DESKTOP_FORM_INPUT_INNER =
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

export const DESKTOP_FORM_TEXTAREA_INNER =
  "min-h-9 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

/** Select / custom trigger placed inside DESKTOP_FORM_INPUT_SHELL */
export const DESKTOP_FORM_FIELD_TRIGGER_INNER =
  "h-8 min-h-8 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

/** Root and viewport share max-h: constraining only the viewport lets Root grow with content, distorting the h-full scrollbar track */
export const DESKTOP_OVERLAY_LIST_SCROLL_AREA =
  "max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_LIST_PADDING = "p-1 pr-1.5";

export const DESKTOP_OVERLAY_LIST_LIST_GAP = "gap-0.5";

export const DESKTOP_OVERLAY_LIST_GROUP_LABEL = `px-2 py-1.5 text-[11px] ${FONT_WEIGHT_NORMAL} tracking-wide text-muted-foreground`;

/** Inline label inside the detail Popover (no extra padding; use with DESKTOP_OVERLAY_LIST_DETAIL_*) */
export const DESKTOP_OVERLAY_LIST_DETAIL_LABEL = `text-[11px] ${FONT_WEIGHT_NORMAL} tracking-wide text-muted-foreground`;

export const DESKTOP_OVERLAY_LIST_ITEM = "px-2 py-1.5";

/** Single-line action at the bottom of a long list (add workspace etc.); density matches LIST, not the Dropdown SHORT default */
export const DESKTOP_OVERLAY_LIST_ACTION_ITEM = "px-2 py-1.5 text-xs text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_PRIMARY = `truncate text-xs ${FONT_WEIGHT_NORMAL} text-popover-foreground`;

export const DESKTOP_OVERLAY_LIST_ITEM_SECONDARY = "truncate text-[11px] text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_SUB_TRIGGER = "items-center gap-1.5 px-2.5 py-1.5 pr-2 text-xs";

/** Detail Popover paired with a long list: density aligned with DESKTOP_OVERLAY_LIST_* */
export const DESKTOP_OVERLAY_LIST_DETAIL_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  "border border-border/80 bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_DETAIL_WIDTH =
  "w-max min-w-[11rem] max-w-[min(19rem,calc(100vw-1.25rem))]";

/** Workspace picker full-height panel */
export const DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] max-w-[min(19rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

/** Scroll viewport height for the Composer inline suggestion menu (@ file references, / slash commands) */
export const DESKTOP_COMPOSER_SUGGESTION_MENU_SCROLL_VIEWPORT =
  "no-scrollbar max-h-[min(16rem,34vh)] overscroll-contain overflow-x-hidden overflow-y-auto outline-none";

/** Prevent wheel events from leaking through to the conversation/list behind */
export function stopOverlayScrollPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

/** Draggable lower bound: the default width matches it so the first open is more compact */
export const SESSION_SIDEBAR_MIN_WIDTH_PX = 200;

/** Default width of the left session sidebar */
export const SESSION_SIDEBAR_DEFAULT_WIDTH_PX = SESSION_SIDEBAR_MIN_WIDTH_PX;

/** Draggable upper bound: only slightly wider than the default (do not use a large viewport ratio for the right tool area) */
export const SESSION_SIDEBAR_MAX_WIDTH_PX = 288;

const SESSION_SIDEBAR_VIEWPORT_MAX_RATIO = 0.4;

export function computeSessionSidebarMaxWidthPx(): number {
  if (typeof window === "undefined") {
    return SESSION_SIDEBAR_MAX_WIDTH_PX;
  }
  // The viewport ratio only shrinks the drag-time upper bound; never let it drop
  // below the minimum width, or every clamp caller would compress the sidebar
  // under its own floor on narrow windows.
  return Math.max(
    SESSION_SIDEBAR_MIN_WIDTH_PX,
    Math.min(
      SESSION_SIDEBAR_MAX_WIDTH_PX,
      Math.round(window.innerWidth * SESSION_SIDEBAR_VIEWPORT_MAX_RATIO),
    ),
  );
}

export function sessionSidebarShellWidth(open: boolean, widthPx: number): string {
  return open ? `calc(0.25rem + ${widthPx}px)` : "0px";
}

/** In-browser nested hero preview: narrower session rail for compact typography. */
export const NESTED_SESSION_SIDEBAR_MIN_WIDTH_PX = 152;
export const NESTED_SESSION_SIDEBAR_WIDTH_PX = 168;
export const NESTED_SESSION_SIDEBAR_MAX_WIDTH_PX = 192;
