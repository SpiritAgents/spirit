// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Desktop chrome class recipes used by shared primitives. Token values live in
// theme.css; these strings are the visual source (desktop outline / hover / overlay).

import { cn } from "./cn.js";

export const instantHoverMotionClass = "!transition-[opacity,transform,box-shadow] duration-150";

export const DESKTOP_CONTENT_TRANSLUCENT_FILL = "content-translucent:bg-content-translucent-fill";

export const DESKTOP_OUTLINE_FILL = "bg-outline-fill";

export const DESKTOP_OUTLINE_BORDER = "border border-outline-border transition-none";

export const DESKTOP_OUTLINE_BORDER_HOVER = "hover:border-outline-border-hover";

export const DESKTOP_OUTLINE_FILL_HOVER = "hover:bg-outline-fill";

export const DESKTOP_OUTLINE_HOVER = cn(DESKTOP_OUTLINE_BORDER_HOVER, DESKTOP_OUTLINE_FILL_HOVER);

export const DESKTOP_OUTLINE_FOCUSED =
  "focus-visible:border-outline-border-hover focus-visible:bg-outline-fill";

export const DESKTOP_OUTLINE_BUTTON_HOVER = cn(DESKTOP_OUTLINE_HOVER, "hover:text-chrome-emphasis");

export const DESKTOP_OUTLINE_BUTTON_FOCUSED = DESKTOP_OUTLINE_FOCUSED;

export const DESKTOP_OUTLINE_BUTTON_EXPANDED =
  "aria-expanded:border-outline-border-hover aria-expanded:bg-outline-fill aria-expanded:text-chrome-emphasis";

export const DESKTOP_OUTLINE_FOCUS_VISIBLE_SELECT =
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export const DESKTOP_ITEM_CARD_SURFACE = cn(
  "rounded-lg bg-background/80",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
);

export const DESKTOP_CANVAS_CARD_SURFACE = cn(
  "rounded-lg border border-border/40 bg-background/80",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
);

export const DESKTOP_OVERLAY_SHADOW = "shadow-[0_2px_20px_-4px_rgb(0_0_0/0.06)] dark:shadow-md";

export const DESKTOP_OVERLAY_SHADOW_LG = "shadow-[0_2px_20px_-4px_rgb(0_0_0/0.06)] dark:shadow-lg";

export const DESKTOP_OVERLAY_EDGE = "border border-border/80 dark:border-border/60";

export const DESKTOP_OVERLAY_LIST_SHELL = cn("min-w-0 rounded-lg ring-0", DESKTOP_OVERLAY_SHADOW);

export const DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_EDGE,
  "bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(14rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_CONTENT = "max-h-none overflow-hidden p-0 text-xs";

export const DESKTOP_OVERLAY_LIST_FILTER_HEADER =
  "shrink-0 border-b border-outline-border p-1 pr-1.5";

/** Menu rule: inset from the item row so it does not meet the overlay chrome. */
export const DESKTOP_OVERLAY_MENU_SEPARATOR = "mx-1 my-1 h-px bg-outline-border";

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL = cn(
  "overflow-hidden rounded-md bg-background",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
);

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT =
  "h-7 min-h-7 w-full min-w-0 rounded-none border-0 bg-transparent px-2 py-1.5 text-xs shadow-none";

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST = cn(
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  "rounded-md !bg-transparent hover:!bg-transparent focus:!bg-transparent focus-visible:!bg-transparent dark:!bg-transparent",
);

export const DESKTOP_FORM_INPUT_SHELL = DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL;

export const DESKTOP_FORM_INPUT_INNER =
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-sm shadow-none dark:bg-transparent";

export const DESKTOP_FORM_TEXTAREA_INNER =
  "min-h-9 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none dark:bg-transparent";

export const DESKTOP_FORM_FIELD_TRIGGER_INNER =
  "h-8 min-h-8 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

export const DESKTOP_OVERLAY_LIST_SCROLL_AREA =
  "max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_LIST_PADDING = "p-1 pr-1.5";

export const DESKTOP_OVERLAY_LIST_LIST_GAP = "gap-0.5";

export const DESKTOP_OVERLAY_LIST_GROUP_LABEL =
  "px-2 py-1.5 text-[11px] font-normal tracking-wide text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM = "px-2 py-1.5";

export const DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM_LAYOUT =
  "relative flex w-full cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs outline-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_FOCUS =
  "focus:bg-overlay-hover focus:text-accent-foreground focus:[&_svg]:text-inherit focus:[&_[data-slot$='-shortcut']]:text-inherit focus:[&_[data-slot='kbd']]:text-inherit";

export const DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM = cn(
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM_LAYOUT,
  DESKTOP_OVERLAY_LIST_ITEM_FOCUS,
);

export const DESKTOP_OVERLAY_LIST_ITEM_SELECTED =
  "bg-overlay-hover text-accent-foreground [&_svg]:text-inherit [&_[data-slot$='-shortcut']]:text-inherit [&_[data-slot='kbd']]:text-inherit";

export const DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE =
  "text-destructive [&_svg]:text-destructive [&_[data-slot$='-shortcut']]:text-muted-foreground [&_[data-slot='kbd']]:text-muted-foreground data-[variant=destructive]:focus:[&_[data-slot$='-shortcut']]:text-muted-foreground data-[variant=destructive]:focus:[&_[data-slot='kbd']]:text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE_FOCUS =
  "focus:bg-destructive/10 focus:text-destructive focus:[&_svg]:text-destructive dark:focus:bg-destructive/20";

export const DESKTOP_SELECT_ITEM = cn(
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
  "pr-8 [&>span:not(.absolute)]:inline-flex [&>span:not(.absolute)]:items-center [&>span:not(.absolute)]:gap-1.5",
);

export const DESKTOP_SELECT_CONTENT = cn(
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  "relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-hidden",
);

export const DESKTOP_SELECT_SCROLL_AREA =
  "max-h-[min(24rem,var(--radix-select-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(24rem,var(--radix-select-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_SELECT_TRIGGER = cn(
  "flex h-8 min-h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md bg-background px-2.5 py-1 text-sm outline-none",
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OUTLINE_HOVER,
  DESKTOP_OUTLINE_FOCUSED,
  DESKTOP_OUTLINE_FOCUS_VISIBLE_SELECT,
  "disabled:cursor-not-allowed disabled:opacity-50",
  "data-placeholder:text-muted-foreground [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:truncate",
);

export const DESKTOP_SELECT_LABEL = DESKTOP_OVERLAY_LIST_GROUP_LABEL;

export const DESKTOP_OVERLAY_LIST_ACTION_ITEM = "px-2 py-1.5 text-xs text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_PRIMARY =
  "truncate text-xs font-normal text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_SECONDARY = "truncate text-[11px] text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_SUB_TRIGGER = "items-center gap-1.5 px-2.5 py-1.5 pr-2 text-xs";

export const DESKTOP_OVERLAY_LIST_DETAIL_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_EDGE,
  "bg-popover p-0 text-xs text-popover-foreground backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_DETAIL_WIDTH =
  "w-max min-w-72 max-w-[min(19rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] max-w-[min(19rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

export const DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH = "min-w-[8.5rem]";

export const DESKTOP_OVERLAY_SHORT_LIST_PADDING = "p-1";

export const DESKTOP_OVERLAY_SHORT_LIST_GAP = "gap-0.5";

export const DESKTOP_OVERLAY_SHORT_ITEM = "px-2 py-1.5 text-sm";

export function stopOverlayScrollPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}
