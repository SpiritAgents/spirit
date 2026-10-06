import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useState } from "react";
import type { ApprovalLevel } from "@spiritagent/host-internal/approval-level";
import { Brain, ShieldBan, ShieldCheck, type LucideIcon } from "lucide-react";
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
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
} from "@/lib/desktop-chrome";
import {
  COMPOSER_INLINE_CHIP_ICON_CLASS,
  COMPOSER_INLINE_CHIP_TEXT_CLASS,
} from "@/lib/composer-inline-chip-styles";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

type ApprovalLevelMenuProps = {
  approvalLevel: ApprovalLevel;
  disabled?: boolean;
  onApprovalLevelChange(level: ApprovalLevel): void;
};

export const APPROVAL_LEVEL_ICONS: Record<ApprovalLevel, LucideIcon> = {
  default: ShieldCheck,
  "auto-approval": Brain,
  "bypass-approval": ShieldBan,
};

function approvalLevelTriggerIconClass(level: ApprovalLevel): string {
  if (level === "bypass-approval") {
    return "text-yellow-600 dark:text-yellow-500";
  }
  if (level === "auto-approval") {
    return COMPOSER_INLINE_CHIP_ICON_CLASS;
  }
  return "text-muted-foreground/80";
}

function approvalLevelTriggerTextClass(level: ApprovalLevel): string {
  if (level === "bypass-approval") {
    return "text-yellow-600 hover:text-yellow-600 dark:text-yellow-500 dark:hover:text-yellow-500";
  }
  if (level === "auto-approval") {
    return `${COMPOSER_INLINE_CHIP_TEXT_CLASS} hover:text-blue-500 dark:hover:text-blue-400`;
  }
  return "text-muted-foreground";
}

function approvalLevelChevronClass(level: ApprovalLevel): string {
  if (level === "bypass-approval") {
    return "text-yellow-600/85 dark:text-yellow-500/80";
  }
  if (level === "auto-approval") {
    return "text-blue-500/85 dark:text-blue-400/80";
  }
  return "text-muted-foreground/80";
}

export function ApprovalLevelMenu({
  approvalLevel,
  disabled = false,
  onApprovalLevelChange,
}: ApprovalLevelMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const options = [
    { value: "default" as ApprovalLevel, label: t("composer.approvalDefault") },
    { value: "auto-approval" as ApprovalLevel, label: t("composer.approvalAuto") },
    { value: "bypass-approval" as ApprovalLevel, label: t("composer.approvalBypass") },
  ];
  const label =
    options.find((option) => option.value === approvalLevel)?.label ??
    t("composer.approvalDefault");
  const TriggerIcon = APPROVAL_LEVEL_ICONS[approvalLevel];
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
              aria-label={t("composer.selectApprovalLevel")}
              disabled={disabled}
              className={cn(
                DESKTOP_GHOST_INLINE_TRIGGER,
                DESKTOP_MENU_TRIGGER_TEXT_CLASS,
                approvalLevelTriggerTextClass(approvalLevel),
              )}
            >
              <TriggerIcon
                className={cn("size-3.5 shrink-0", approvalLevelTriggerIconClass(approvalLevel))}
                aria-hidden
                strokeWidth={1.75}
              />
              <span className="min-w-0 truncate">{label}</span>
              <ChevronDown
                className={cn("size-3 shrink-0", approvalLevelChevronClass(approvalLevel))}
                aria-hidden
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t("composer.selectApprovalLevel")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "p-0")}
      >
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          {options.map((option) => {
            const OptionIcon = APPROVAL_LEVEL_ICONS[option.value];
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onApprovalLevelChange(option.value)}
                className={cn(
                  "gap-2",
                  approvalLevel === option.value && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
                )}
              >
                <OptionIcon className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
                {option.label}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
