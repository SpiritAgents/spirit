import { cn } from "@/lib/utils";

/** Desktop font-weight semantic tokens; values match the Tailwind defaults (400 / 500 / 600) */
export const FONT_WEIGHT_NORMAL = "font-normal";
export const FONT_WEIGHT_MEDIUM = "font-medium";
export const FONT_WEIGHT_SEMIBOLD = "font-semibold";

/** Page-level main title (Settings, Automations, etc.) */
export const DESKTOP_PAGE_TITLE_CLASS = cn(
  "text-xl",
  FONT_WEIGHT_MEDIUM,
  "tracking-tight text-foreground",
);

/** Settings row label */
export const DESKTOP_SETTINGS_LABEL_CLASS = cn("text-sm", FONT_WEIGHT_NORMAL, "text-foreground");

/** Sidebar session names, group labels, etc. */
export const DESKTOP_SIDEBAR_TEXT_CLASS = cn("text-xs", FONT_WEIGHT_NORMAL);

/** Primary text of overlay lists */
export const DESKTOP_OVERLAY_ITEM_PRIMARY_CLASS = cn(
  "truncate text-xs",
  FONT_WEIGHT_NORMAL,
  "text-popover-foreground",
);

/** Overlay group label */
export const DESKTOP_OVERLAY_GROUP_LABEL_CLASS = cn(
  "text-[11px]",
  FONT_WEIGHT_NORMAL,
  "tracking-wide text-muted-foreground",
);

/** Settings list items / model names, etc. */
export const DESKTOP_LIST_ITEM_PRIMARY_CLASS = cn("text-sm", FONT_WEIGHT_NORMAL, "text-foreground");

/** Settings subsection titles, editor tab toggles */
export const DESKTOP_SECTION_LABEL_CLASS = cn("text-sm", FONT_WEIGHT_NORMAL, "text-foreground");

/** Compact subsection title (embedded sections inside Extensions, etc.) */
export const DESKTOP_SECTION_LABEL_COMPACT_CLASS = cn(
  "text-xs",
  FONT_WEIGHT_NORMAL,
  "text-foreground",
);

/** Menu / toolbar triggers */
export const DESKTOP_MENU_TRIGGER_TEXT_CLASS = cn("text-xs", FONT_WEIGHT_NORMAL);

/** Editor tab toggle (xs) */
export const DESKTOP_EDITOR_TAB_CLASS = cn(
  "rounded-md px-2.5 text-xs",
  FONT_WEIGHT_NORMAL,
  "transition-colors",
);
