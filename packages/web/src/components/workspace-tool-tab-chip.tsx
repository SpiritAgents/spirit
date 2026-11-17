import { X } from "@spiritagent/icons/x";
import type { ElementType, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { toggleVariants } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RovingFocusAction, RovingFocusItem } from "@/components/ui/roving-focus-group";
import { cn } from "@/lib/utils";
import type { WorkspaceToolTab } from "@/lib/workspace-tool-tabs";

type WorkspaceToolTabChipProps = {
  tab: WorkspaceToolTab;
  icon: ElementType;
  iconNode?: ReactNode;
  label: string;
  selected: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

/** One Toggle surface around separate tab selection and close buttons. */
export function WorkspaceToolTabChip({
  tab,
  icon: Icon,
  iconNode,
  label,
  selected,
  onSelect,
  onClose,
}: WorkspaceToolTabChipProps) {
  const { t } = useTranslation();
  const displayTitle = tab.kind === "extension" ? (tab.tabTitle ?? label) : tab.tabTitle;
  const tabButton = (
    <RovingFocusItem asChild tabStopId={tab.id} active={selected}>
      <button
        type="button"
        role="tab"
        id={`workspace-tool-tab-${tab.id}`}
        aria-selected={selected}
        aria-controls={`workspace-tool-panel-${tab.id}`}
        aria-label={displayTitle ? undefined : label}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 rounded-lg bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
          displayTitle ? "px-2" : "justify-center p-0",
        )}
        onClick={() => onSelect(tab.id)}
      >
        {iconNode ?? (
          <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden strokeWidth={1.75} />
        )}
        {displayTitle ? (
          <span
            data-slot="workspace-tool-tab-title"
            className="flex min-w-0 flex-auto items-center gap-1.5 overflow-hidden group-hover/tab:workspace-tab-title-fade group-focus-within/tab:workspace-tab-title-fade"
          >
            <span className="truncate">{displayTitle}</span>
            {tab.tabDirty ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
                role="status"
                aria-label={t("workspace.unsavedChangesIndicator")}
              />
            ) : null}
          </span>
        ) : null}
      </button>
    </RovingFocusItem>
  );

  return (
    <div
      data-slot="workspace-tool-tab-chip"
      data-state={selected ? "on" : "off"}
      className={cn(
        toggleVariants({ variant: "default", size: "sm" }),
        "group/tab relative shrink-0 items-stretch rounded-lg p-0 text-xs text-muted-foreground",
        displayTitle ? "max-w-[9rem]" : "size-7",
      )}
    >
      {displayTitle ? (
        tabButton
      ) : (
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>{tabButton}</TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {label}
          </TooltipContent>
        </Tooltip>
      )}
      {displayTitle ? (
        <RovingFocusAction tabStopId={tab.id}>
          <button
            type="button"
            className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-transparent p-0 opacity-0 outline-none pointer-events-none group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={t("workspace.closeTab", { label })}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <X className="size-3 opacity-70" aria-hidden strokeWidth={1.75} />
          </button>
        </RovingFocusAction>
      ) : null}
    </div>
  );
}
