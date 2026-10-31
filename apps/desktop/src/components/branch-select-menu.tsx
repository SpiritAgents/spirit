import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipTrigger,
  useOptionalTooltipStableActions,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTruncatedElement } from "@/hooks/use-truncated-element";
import {
  DESKTOP_GHOST_INLINE_TRIGGER,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
  DESKTOP_OVERLAY_LIST_WIDTH,
  DESKTOP_OVERLAY_SHORT_LIST_PADDING,
} from "@/lib/desktop-chrome";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

type BranchSelectMenuProps = {
  branches: readonly string[];
  selectedBranch?: string;
  currentBranch?: string;
  disabled?: boolean;
  onBranchChange(branch: string): void;
};

function BranchSelectMenuItem({
  branch,
  activeBranch,
  onSelect,
}: {
  branch: string;
  activeBranch?: string;
  onSelect(): void;
}) {
  const { ref: labelRef, isTruncated } = useTruncatedElement<HTMLSpanElement>(branch);

  return (
    <TooltipItem item={isTruncated ? branch : null}>
      <DropdownMenuItem
        onSelect={onSelect}
        className={cn(
          "min-w-0",
          DESKTOP_MENU_TRIGGER_TEXT_CLASS,
          activeBranch === branch && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
        )}
      >
        <span ref={labelRef} className="min-w-0 truncate">
          {branch}
        </span>
      </DropdownMenuItem>
    </TooltipItem>
  );
}

export function BranchSelectMenu({
  branches,
  selectedBranch,
  currentBranch,
  disabled = false,
  onBranchChange,
}: BranchSelectMenuProps) {
  const { t } = useTranslation();
  const tooltipActions = useOptionalTooltipStableActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const isRepository = branches.length > 0 || Boolean(currentBranch);
  const activeBranch = selectedBranch ?? currentBranch;
  const label = isRepository ? (activeBranch ?? t("error.noBranch")) : t("app.notGitRepoLabel");
  const triggerDisabled = disabled || !isRepository;
  const suppressTooltip = menuOpen || triggerDisabled;
  const { ref: labelRef, isTruncated: isLabelTruncated } =
    useTruncatedElement<HTMLSpanElement>(label);
  const tooltipText = isLabelTruncated ? label : t("composer.selectBranch");

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) {
          tooltipActions?.dismissIfOpen();
        }
      }}
    >
      <Tooltip
        open={suppressTooltip ? false : undefined}
        delayDuration={300}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("composer.selectBranch")}
              disabled={triggerDisabled}
              className={cn(
                DESKTOP_GHOST_INLINE_TRIGGER,
                "max-w-[min(12rem,28vw)]",
                DESKTOP_MENU_TRIGGER_TEXT_CLASS,
                "text-muted-foreground",
              )}
            >
              <GitBranch
                className="size-3.5 shrink-0 text-muted-foreground/80"
                aria-hidden
                strokeWidth={1.75}
              />
              <span ref={labelRef} className="min-w-0 flex-1 truncate">
                {label}
              </span>
              <ChevronDown
                className="size-3 shrink-0 text-muted-foreground/80"
                aria-hidden
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        className={cn(DESKTOP_OVERLAY_LIST_WIDTH, "p-0")}
      >
        <ScrollArea
          type="always"
          className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
          onWheel={(event) => {
            event.stopPropagation();
          }}
          onTouchMove={(event) => {
            event.stopPropagation();
          }}
        >
          <div className={cn(DESKTOP_OVERLAY_SHORT_LIST_PADDING, "pr-2")}>
            <Tooltip<string>
              getItemId={(branch) => branch}
              delayDuration={300}
              disableHoverableContent
            >
              <Tooltip.Zone>
                {branches.map((branch) => (
                  <BranchSelectMenuItem
                    key={branch}
                    branch={branch}
                    activeBranch={activeBranch}
                    onSelect={() => onBranchChange(branch)}
                  />
                ))}
              </Tooltip.Zone>
              <TooltipContent side="right" sideOffset={8}>
                {(activeItem) => (typeof activeItem === "string" ? activeItem : null)}
              </TooltipContent>
            </Tooltip>
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
