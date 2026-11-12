import { useTranslation } from "react-i18next";

import { themeSelectOptions } from "@/components/settings/constants";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Compact Settings picker is a uniform 0.625 scale of the OOBE default (112×76, gap-4=16px, gap-2=8px). */
const THEME_PREVIEW_SIZE = {
  default: {
    group: "gap-4",
    card: "h-[76px] w-28 rounded-lg",
    stack: "gap-2",
    label: "text-xs",
  },
  compact: {
    group: "gap-[10px]",
    card: "h-[47.5px] w-[70px] rounded-md",
    stack: "gap-[5px]",
    label: "text-[11px] leading-tight",
  },
} as const;

export type ThemePreviewPickerSize = keyof typeof THEME_PREVIEW_SIZE;

type ThemePreviewPickerProps = {
  value: ThemePreference;
  onValueChange: (value: ThemePreference) => void;
  size?: ThemePreviewPickerSize;
  ariaLabel?: string;
  className?: string;
};

export function ThemePreviewPicker({
  value,
  onValueChange,
  size = "default",
  ariaLabel,
  className,
}: ThemePreviewPickerProps) {
  const { t } = useTranslation();
  const sizeClasses = THEME_PREVIEW_SIZE[size];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t("settings.theme")}
      className={cn("flex", sizeClasses.group, className)}
    >
      {themeSelectOptions.map((option) => (
        <ThemePreviewCard
          key={option.value}
          value={option.value}
          label={t(option.labelKey)}
          selected={value === option.value}
          size={size}
          onSelect={() => onValueChange(option.value)}
        />
      ))}
    </div>
  );
}

function ThemePreviewCard({
  value,
  label,
  selected,
  size,
  onSelect,
}: {
  value: ThemePreference;
  label: string;
  selected: boolean;
  size: ThemePreviewPickerSize;
  onSelect: () => void;
}) {
  const sizeClasses = THEME_PREVIEW_SIZE[size];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group/theme-card flex cursor-pointer flex-col items-center outline-none",
        sizeClasses.stack,
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden border transition-[border-color,box-shadow] duration-150",
          sizeClasses.card,
          selected
            ? "border-primary"
            : "border-border/60 group-hover/theme-card:border-border group-focus-visible/theme-card:ring-2 group-focus-visible/theme-card:ring-ring/50",
        )}
      >
        <div
          className={
            size === "compact"
              ? "absolute left-0 top-0 h-[76px] w-28 origin-top-left scale-[0.625]"
              : "contents"
          }
        >
          {value === "system" ? (
            <>
              {/* Vertical split: each side clips a half-width full preview, avoiding the whole card's light layer showing through at the rounded-corner edges */}
              <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-[200%]">
                  <MiniAppPreview dark={false} />
                </div>
              </div>
              <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
                <div className="absolute inset-y-0 right-0 w-[200%]">
                  <MiniAppPreview dark />
                </div>
              </div>
            </>
          ) : (
            <MiniAppPreview dark={value === "dark"} />
          )}
        </div>
      </div>
      <span
        className={cn(
          "text-center transition-colors",
          sizeClasses.label,
          selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Mini mock of the main UI's empty-conversation view: sidebar + centered doodle skeleton bar +
 * bottom input bar.
 * Fixed palette (no dark: variants) so the preview is not affected by the document-level .dark
 * class; the brand colors are pure white/black, and skeleton bars uniformly use black/white alpha
 * overlays to avoid intermediate grays introducing a hue.
 */
function MiniAppPreview({ dark }: { dark: boolean }) {
  const c = dark
    ? {
        bg: "bg-zinc-950",
        sidebar: "border-r border-white/10 bg-zinc-900/80",
        sidebarBar: "bg-white/12",
        bar: "bg-white/18",
        barSoft: "bg-white/14",
        input: "border-white/10 bg-zinc-900/70",
      }
    : {
        bg: "bg-zinc-50",
        sidebar: "border-r border-black/5 bg-white/80",
        sidebarBar: "bg-black/8",
        bar: "bg-black/10",
        barSoft: "bg-black/8",
        input: "border-black/8 bg-white",
      };

  return (
    <div className={cn("flex h-full w-full", c.bg)} aria-hidden>
      <div className={cn("flex h-full w-[27%] flex-col gap-[5px] px-1.5 pt-2", c.sidebar)}>
        <div className={cn("h-1 w-4/5 rounded-full", c.sidebarBar)} />
        <div className={cn("h-1 w-3/5 rounded-full", c.sidebarBar)} />
        <div className={cn("h-1 w-2/3 rounded-full", c.sidebarBar)} />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[5px] px-2">
        <div className={cn("h-1.5 w-3/5 rounded-full", c.bar)} />
        <div className={cn("h-1 w-2/5 rounded-full", c.barSoft)} />
        <div className={cn("absolute inset-x-1.5 bottom-1.5 h-4 rounded-[5px] border", c.input)} />
      </div>
    </div>
  );
}
