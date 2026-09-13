import {
  DESKTOP_OVERLAY_GROUP_LABEL_CLASS,
  DESKTOP_OVERLAY_ITEM_PRIMARY_CLASS,
  DESKTOP_SIDEBAR_TEXT_CLASS,
  FONT_WEIGHT_NORMAL,
} from "@/lib/desktop-typography";
import {
  DESKTOP_OVERLAY_LIGHT_SHADOW,
  desktopComposerChipSurfaceClass,
} from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";

export {
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
  DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT,
  DESKTOP_COMPOSER_SURFACE_SOLID,
  DESKTOP_ELEVATION_SHADOW_SM,
  DESKTOP_OVERLAY_LIGHT_SHADOW,
  desktopComposerChipSurfaceClass,
  desktopComposerSurfaceBackdropClass,
} from "@/lib/desktop-translucency-surface";

/**
 * Instant hover fill — exclude background-color from transitions (session-sidebar precedent).
 * Keeps existing hover:bg-* overlays; only removes bg fade in/out on hover.
 */
export const instantHoverMotionClass = "!transition-[opacity,transform,box-shadow] duration-150";

/** Translucent hover underlay; background-color does not participate in transitions (text color changes excluded) */
export const DESKTOP_INSTANT_HOVER_OVERLAY = cn(
  "bg-transparent hover:!bg-canvas-hover focus-visible:!bg-canvas-hover",
  "aria-expanded:!bg-canvas-hover",
  instantHoverMotionClass,
);

/** Ghost icon/compact button: sidebar-sourced translucent hover + brighter text color */
export const DESKTOP_INSTANT_HOVER_GHOST_BTN = cn(
  DESKTOP_INSTANT_HOVER_OVERLAY,
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground aria-expanded:!text-sidebar-foreground",
);

/** In-place item highlight (Read File tool card): brighten text/icons, no wash overlay */
export const DESKTOP_ITEM_HIGHLIGHT = cn(
  "hover:brightness-[0.76] focus-visible:brightness-[0.76] data-[pointer-hover]:brightness-[0.76]",
  "dark:hover:brightness-[1.24] dark:focus-visible:brightness-[1.24] dark:data-[pointer-hover]:brightness-[1.24]",
);

/** Composer-internal Ghost hover: full muted on light; muted wash on dark so it does not flash */
export const DESKTOP_COMPOSER_GHOST_HOVER = cn(
  "hover:bg-muted dark:hover:bg-muted/40",
  "aria-expanded:bg-muted dark:aria-expanded:bg-muted/40",
  "aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/40",
);

/** Ghost dropdown trigger: horizontal padding stays even when the label is short */
export const DESKTOP_GHOST_MENU_TRIGGER = cn(
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border-0 bg-transparent px-2 text-left outline-none",
  "hover:bg-canvas-hover focus-visible:ring-2 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:opacity-50",
  instantHoverMotionClass,
);

/** Composer chrome trigger (workspace / branch / location / approval): wash, rounded-lg (not pill) */
export const DESKTOP_GHOST_INLINE_TRIGGER = cn(
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-left outline-none",
  "hover:bg-canvas-hover focus-visible:bg-canvas-hover data-[pointer-hover]:bg-canvas-hover",
  "aria-expanded:bg-canvas-hover",
  "focus-visible:ring-2 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:opacity-50",
  instantHoverMotionClass,
);

/** Ghost Select trigger inside popovers (Effort, etc.): no border wash, keep side padding */
export const DESKTOP_GHOST_SELECT_TRIGGER =
  "min-h-0 w-auto rounded-full border-0 bg-transparent px-2 py-0 text-xs shadow-none hover:border-transparent [&_span]:justify-end [&_svg]:size-3";

/** Sidebar shell / title-bar slot width transition, consistent with SessionSidebarShell */
export const DESKTOP_SHELL_LAYOUT_TRANSITION =
  "transition-[width,margin,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0";

/** Pane split line on a solid surface (session sidebar Off, workspace tools). */
export const DESKTOP_PANE_SPLIT_LINE_CLASS =
  "bg-border/40 transition-colors group-hover:bg-border/55";

/** Session-sidebar split when only the sidebar is translucent against a solid main. */
export const DESKTOP_SIDEBAR_ONLY_SPLIT_LINE_CLASS =
  "bg-border/55 transition-colors group-hover:bg-border/70";

/** Session-sidebar split in All-mode translucency (pre-diff hairline on tinted surfaces). */
export const DESKTOP_ALL_TRANSLUCENCY_SPLIT_LINE_CLASS =
  "bg-black/5 transition-colors group-hover:bg-black/10 dark:bg-white/5 dark:group-hover:bg-white/9";

/** Default title-bar text/icon color, aligned with the sidebar's `sidebarItemDefaultTextClass` */
export const DESKTOP_CHROME_MUTED_TEXT = "text-sidebar-action-foreground";

/** Inline session-title rename input: ghost, borderless, text color matches the sidebar/title-bar session name */
export const SESSION_TITLE_RENAME_INPUT_CLASS = cn(
  "min-w-0 rounded-none border-0 bg-transparent p-0 shadow-none outline-none ring-0 focus-visible:ring-0",
  DESKTOP_SIDEBAR_TEXT_CLASS,
  DESKTOP_CHROME_MUTED_TEXT,
);

/** Title-bar session title hover: only the text color brightens, no translucent underlay */
export const DESKTOP_SESSION_TITLE_HOVER_CLASS = cn(
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
  instantHoverMotionClass,
);

/** Title-bar hover/focus/current-item text color, aligned with the sidebar's `sidebarItemActiveTextClass` */
export const DESKTOP_CHROME_ACTIVE_TEXT = "text-sidebar-foreground";

/** ghost expanded uses `--canvas-hover`; title-bar icon buttons stay transparent until hover */
export const DESKTOP_CHROME_TOGGLE_ICON_BTN = cn(
  "electron-no-drag size-7 shrink-0 bg-transparent",
  DESKTOP_CHROME_MUTED_TEXT,
  "hover:bg-canvas-hover hover:text-sidebar-foreground focus-visible:bg-canvas-hover focus-visible:text-sidebar-foreground",
  "aria-expanded:bg-transparent aria-expanded:text-sidebar-action-foreground",
  "aria-expanded:hover:bg-canvas-hover aria-expanded:hover:text-sidebar-foreground",
  "[&_svg]:size-3.5",
  instantHoverMotionClass,
);

/** File-sidebar toolbar toggle icon: text color aligned with the conversation area's Thought (text-muted-foreground) */
export const DESKTOP_FILES_EXPLORER_TOOLBAR_ICON_BTN = cn(
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  "text-muted-foreground hover:text-muted-foreground focus-visible:text-muted-foreground aria-expanded:text-muted-foreground aria-pressed:text-muted-foreground",
);

export const DESKTOP_CHROME_COMMIT_BTN = cn(
  "h-7 rounded-md px-2 text-xs text-foreground/90 hover:bg-canvas-hover hover:text-sidebar-foreground",
  FONT_WEIGHT_NORMAL,
  instantHoverMotionClass,
);

/** Primary button of the Git changes area (ButtonGroup segment, paired with `size="xs"`); `border-r-0` prevents the transparent right border from stacking on the divider and looking too thick */
export const DESKTOP_GIT_ACTION_BTN = cn("border-r-0 shadow-none", instantHoverMotionClass);

/** Middle vertical line of the Git ButtonGroup (`ButtonGroupSeparator`); `!bg-*` overrides the Separator default bg-border / bg-input */
export const DESKTOP_GIT_ACTION_SPLIT = cn(
  "!my-0 !mx-0 h-auto w-px min-w-px max-w-px shrink-0 self-stretch !border-0 !bg-border-0 !bg-[var(--git-action-split)] !p-0",
);

/** Dropdown trigger on the right side of the Git ButtonGroup */
export const DESKTOP_GIT_ACTION_MENU_TRIGGER = cn(
  DESKTOP_GIT_ACTION_BTN,
  "w-6 min-w-6 max-w-6 rounded-l-none rounded-r-md px-0",
);

/**
 * Overlay menu density: uniformly use the LIST density (text-xs / py-2), aligned with the
 * model / workspace pickers.
 * The SHORT series is kept only for local cases that still need text-sm density.
 */

/** Overlay shadow: light-mode diffuse + dark-mode keeps md */
export const DESKTOP_OVERLAY_SHADOW = cn(DESKTOP_OVERLAY_LIGHT_SHADOW, "dark:shadow-md");

/** Overlay shadow: light-mode diffuse + dark-mode keeps lg (Tooltip / Popover / HoverCard, etc.) */
export const DESKTOP_OVERLAY_SHADOW_LG = cn(DESKTOP_OVERLAY_LIGHT_SHADOW, "dark:shadow-lg");

/** Overlay panel edge: same 1px `--border` at 80% as Dropdown */
export const DESKTOP_OVERLAY_EDGE = "border border-border/80";

/** Ctrl+P / Ctrl+Shift+P command palette list icons and titles: slightly muted in light mode, brightened in dark mode */
export const DESKTOP_COMMAND_PALETTE_ITEM_TONE = "opacity-70 dark:opacity-90";

/** Ctrl+P / Ctrl+Shift+P command palette list row: uniform row height so single-line titles don't look cramped */
export const DESKTOP_COMMAND_PALETTE_ITEM_CLASS = cn(
  "min-h-9 min-w-0 cursor-pointer py-2 [&>svg:last-child]:hidden",
  instantHoverMotionClass,
);

/** Short list: lightweight shell (used only in local cases) */
export const DESKTOP_OVERLAY_SHORT_SHELL = cn("rounded-lg ring-0", DESKTOP_OVERLAY_SHADOW);

export const DESKTOP_OVERLAY_SHORT_CONTENT = cn(DESKTOP_OVERLAY_SHORT_SHELL, "p-1 text-sm");

/** Dropdown primitive: short-list shell + popover face */
export const DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_SHORT_SHELL,
  DESKTOP_OVERLAY_EDGE,
  "bg-popover p-1 text-sm text-popover-foreground",
);

export const DESKTOP_OVERLAY_SHORT_SUBCONTENT = cn(
  DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE,
  "min-w-[8.5rem]",
);

export const DESKTOP_OVERLAY_SHORT_ITEM = "px-2 py-1.5 text-sm";

export const DESKTOP_OVERLAY_SHORT_LIST_PADDING = "p-1";

export const DESKTOP_OVERLAY_SHORT_LIST_GAP = "gap-0.5";

/** Only adds local business classes such as a minimum width */
/** Compact overlay menu floor (approval / schedule Dropdown, Context Menu) */
export const DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH = "min-w-[8.5rem]";

/** Long list: disable the base class overflow-y-auto so the inner ScrollArea owns scrolling exclusively */
export const DESKTOP_OVERLAY_LIST_CONTENT = "max-h-none overflow-hidden p-0 text-xs";

export const DESKTOP_OVERLAY_LIST_SHELL = cn("min-w-0 rounded-lg ring-0", DESKTOP_OVERLAY_SHADOW);

/** Dropdown primitive: long-list shell + popover face (density aligned with the model / workspace pickers) */
export const DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_EDGE,
  "bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(14rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_FILTER_HEADER = "shrink-0 border-b border-border/40 p-1.5";

/** Outline rest fill / hover wash (Input, Outline button, item cards and rows) */
export const DESKTOP_OUTLINE_FILL = "bg-outline-fill";

/** Canvas All-mode see-through fill (outline controls + cards). Light /30, dark /10 via `--content-translucent-fill`. Portaled overlays sit outside the marker and stay solid. */
export const DESKTOP_CONTENT_TRANSLUCENT_FILL = "content-translucent:bg-content-translucent-fill";

/** Outline rest border (Input, Outline button, item cards) */
export const DESKTOP_OUTLINE_BORDER = "border border-outline-border transition-none";

export const DESKTOP_OUTLINE_BORDER_HOVER = "hover:border-outline-border-hover";
export const DESKTOP_OUTLINE_FILL_HOVER = "hover:bg-outline-fill";

/** Hover: wash + `--outline-border-hover` so the edge stays readable */
export const DESKTOP_OUTLINE_HOVER = cn(DESKTOP_OUTLINE_BORDER_HOVER, DESKTOP_OUTLINE_FILL_HOVER);

/** Mouse-click focus: keep the hover border, no ring */
export const DESKTOP_OUTLINE_FOCUSED = "focus:border-outline-border-hover focus:bg-outline-fill";

/** Card hover wash when replacing `background-color` would punch through translucency */
export const DESKTOP_OUTLINE_FILL_UNDERLAY =
  "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-outline-fill before:opacity-0 hover:before:opacity-100";

/** Bordered item card face (marketplace / automations); see-through under All-mode translucency on the canvas */
export const DESKTOP_ITEM_CARD_SURFACE = cn(
  "rounded-lg bg-background/80",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
);

/** Grouped canvas card (settings sections, dream graph). */
export const DESKTOP_CANVAS_CARD_SURFACE = cn(
  "rounded-lg border border-border/40 bg-background/80",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
);

export const DESKTOP_ITEM_CARD_HOVER_BORDER = DESKTOP_OUTLINE_BORDER_HOVER;

/** Outline button: Outline hover + brighter label */
export const DESKTOP_OUTLINE_BUTTON_HOVER = cn(
  DESKTOP_OUTLINE_HOVER,
  "hover:text-sidebar-foreground",
);
export const DESKTOP_OUTLINE_BUTTON_FOCUSED = DESKTOP_OUTLINE_FOCUSED;
export const DESKTOP_OUTLINE_BUTTON_EXPANDED =
  "aria-expanded:border-outline-border-hover aria-expanded:bg-outline-fill aria-expanded:text-sidebar-foreground";

/** Select trigger: slightly smaller ring, consistent with the shadcn Select default */
export const DESKTOP_OUTLINE_FOCUS_VISIBLE_SELECT =
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/** Thin-border shell for text inputs/areas, inner field without ring. No hover/focus brightening anywhere: the text cursor already signals the input state. Under All-mode translucency the background turns see-through on the canvas (app-shell marker); portaled overlays (dialogs, menus) live outside the marker and stay solid. */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL = cn(
  "overflow-hidden rounded-md bg-background",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
);

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT =
  "h-7 min-h-7 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-xs shadow-none";

/** ghost: transparent background consistent with popover; overrides the Input base class rest/hover/focus fill */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST = cn(
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  "rounded-md !bg-transparent hover:!bg-transparent focus:!bg-transparent focus-visible:!bg-transparent dark:!bg-transparent",
);

/** Standard form input: consistent with the PendingApprovalCard guided input (h-8) */
export const DESKTOP_FORM_INPUT_SHELL = DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL;

export const DESKTOP_FORM_INPUT_INNER =
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-sm shadow-none dark:bg-transparent";

export const DESKTOP_FORM_TEXTAREA_INNER =
  "min-h-9 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none dark:bg-transparent";

/** Select / custom trigger placed inside DESKTOP_FORM_INPUT_SHELL */
export const DESKTOP_FORM_FIELD_TRIGGER_INNER =
  "h-8 min-h-8 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

/** Root and viewport share max-h: constraining only the viewport lets Root grow with content and distorts the h-full scrollbar track */
export const DESKTOP_OVERLAY_LIST_SCROLL_AREA =
  "max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_LIST_PADDING = "p-1 pr-1.5";

export const DESKTOP_OVERLAY_LIST_LIST_GAP = "gap-0.5";

export const DESKTOP_OVERLAY_LIST_GROUP_LABEL = cn(
  "px-2 py-1.5",
  DESKTOP_OVERLAY_GROUP_LABEL_CLASS,
);

/** Label embedded in a detail Popover (no extra padding; used with DESKTOP_OVERLAY_LIST_DETAIL_*) */
export const DESKTOP_OVERLAY_LIST_DETAIL_LABEL = DESKTOP_OVERLAY_GROUP_LABEL_CLASS;

export const DESKTOP_OVERLAY_LIST_ITEM = "px-2 py-1.5";

/** Long-list DropdownMenuItem primitive; shared by overlay list items such as model / workspace / approval */
export const DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM =
  "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-overlay-hover focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

/** Selected row fill: same wash as overlay item hover (`--overlay-hover`) */
export const DESKTOP_OVERLAY_LIST_ITEM_SELECTED = "bg-overlay-hover text-accent-foreground";

/** Select dropdown item: same density as DropdownMenuItem + right-side space for the ItemIndicator */
export const DESKTOP_SELECT_ITEM = cn(DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM, "pr-8");

/** Select dropdown panel: same shell as Dropdown; scrolling is handled by the Radix Viewport while the outer layer stays overflow-hidden */
export const DESKTOP_SELECT_CONTENT = cn(
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  "relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-hidden",
);

/** Standalone bordered Select trigger (settings pages, etc.) */
export const DESKTOP_SELECT_TRIGGER = cn(
  // content-translucent: canvas-only see-through tint under All-mode translucency
  // (app-shell marker); hover/focus highlights still win over it.
  "flex h-8 min-h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md bg-background px-2.5 py-1 text-sm outline-none",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OUTLINE_HOVER,
  DESKTOP_OUTLINE_FOCUSED,
  DESKTOP_OUTLINE_FOCUS_VISIBLE_SELECT,
  "disabled:cursor-not-allowed disabled:opacity-50",
  "data-placeholder:text-muted-foreground [&>span]:line-clamp-1",
);

export const DESKTOP_SELECT_LABEL = DESKTOP_OVERLAY_LIST_GROUP_LABEL;

/** Single-line action at the bottom of a long list (add workspace, etc.); density aligned with LIST rather than the Dropdown default SHORT */
export const DESKTOP_OVERLAY_LIST_ACTION_ITEM = "px-2 py-1.5 text-xs text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_PRIMARY = DESKTOP_OVERLAY_ITEM_PRIMARY_CLASS;

export const DESKTOP_OVERLAY_LIST_ITEM_SECONDARY = "truncate text-[11px] text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_SUB_TRIGGER = "items-center gap-1.5 px-2.5 py-1.5 pr-2 text-xs";

/** Detail Popover paired with a long list: density aligned with DESKTOP_OVERLAY_LIST_* */
export const DESKTOP_OVERLAY_LIST_DETAIL_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_EDGE,
  "bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_DETAIL_WIDTH =
  "w-max min-w-72 max-w-[min(19rem,calc(100vw-1.25rem))]";

/** Full-height panel of the workspace picker */
export const DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] max-w-[min(19rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

/** Composer pill card (Changes, etc.): non-translucency glass background; for translucency use {@link desktopComposerChipSurfaceClass} */
export const DESKTOP_COMPOSER_CHIP_SURFACE = desktopComposerChipSurfaceClass(false);

/** Prevents the wheel from propagating to the conversation/list behind the overlay */
export function stopOverlayScrollPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

/** Draggable lower bound: the default width matches it, so first open is more compact */
export const SESSION_SIDEBAR_MIN_WIDTH_PX = 200;

/** Default width of the left session sidebar */
export const SESSION_SIDEBAR_DEFAULT_WIDTH_PX = SESSION_SIDEBAR_MIN_WIDTH_PX;

/** Draggable upper bound: only slightly wider than the default (do not use large viewport ratios for the right-side tool area) */
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
