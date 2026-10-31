import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useState } from "react";
import type { WorkLocationKind } from "@spiritagent/host-internal/work-location";
import type { LucideIcon } from "lucide-react";
import { GitFork, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DESKTOP_GHOST_INLINE_TRIGGER,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
  DESKTOP_OVERLAY_SHORT_LIST_PADDING,
} from "@/lib/desktop-chrome";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

const WORK_LOCATION_OPTIONS: WorkLocationKind[] = ["local", "worktree"];

export const WORK_LOCATION_ICONS: Record<WorkLocationKind, LucideIcon> = {
  local: Monitor,
  worktree: GitFork,
};

type WorkLocationMenuProps = {
  workLocation: WorkLocationKind;
  disabled?: boolean;
  onWorkLocationChange(workLocation: WorkLocationKind): void;
};

export function WorkLocationMenu({
  workLocation,
  disabled = false,
  onWorkLocationChange,
}: WorkLocationMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const workLocationLabel = (kind: WorkLocationKind) =>
    kind === "worktree" ? t("composer.workLocationWorktree") : t("composer.workLocationLocal");
  const label = workLocationLabel(workLocation);
  const TriggerIcon = WORK_LOCATION_ICONS[workLocation];
  const suppressTooltip = menuOpen || disabled;

  return (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <Tooltip
        open={suppressTooltip ? false : undefined}
        delayDuration={300}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("composer.selectWorkLocation")}
              disabled={disabled}
              className={cn(
                DESKTOP_GHOST_INLINE_TRIGGER,
                DESKTOP_MENU_TRIGGER_TEXT_CLASS,
                "text-muted-foreground",
              )}
            >
              <TriggerIcon
                className="size-3.5 shrink-0 text-muted-foreground/80"
                aria-hidden
                strokeWidth={1.75}
              />
              <span className="min-w-0 truncate">{label}</span>
              <ChevronDown
                className="size-3 shrink-0 text-muted-foreground/80"
                aria-hidden
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t("composer.selectWorkLocation")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="min-w-[9.5rem] p-0">
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          {WORK_LOCATION_OPTIONS.map((option) => {
            const Icon = WORK_LOCATION_ICONS[option];
            return (
              <DropdownMenuItem
                key={option}
                onSelect={() => onWorkLocationChange(option)}
                className={cn(
                  "flex items-center gap-2",
                  workLocation === option && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
                <span className="min-w-0 truncate">{workLocationLabel(option)}</span>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
