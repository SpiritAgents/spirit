import { X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { toggleVariants } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkspaceToolTab } from "@/lib/workspace-tool-tabs";

type WorkspaceToolTabChipProps = {
  tab: WorkspaceToolTab;
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

/** One Toggle surface around separate tab selection and close buttons. */
export function WorkspaceToolTabChip({
  tab,
  icon: Icon,
  label,
  selected,
  onSelect,
  onClose,
}: WorkspaceToolTabChipProps) {
  const { t } = useTranslation();
  const displayTitle = tab.tabTitle;
  const tabButton = (
    <button
      type="button"
      role="tab"
      id={`workspace-tool-tab-${tab.id}`}
      aria-selected={selected}
      aria-controls={`workspace-tool-panel-${tab.id}`}
      tabIndex={selected ? 0 : -1}
      aria-label={displayTitle ? undefined : label}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1 rounded-[inherit] bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        displayTitle ? "px-2" : "justify-center p-0",
      )}
      onClick={() => onSelect(tab.id)}
    >
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
      {displayTitle ? (
        <span className="flex min-w-0 flex-auto items-center gap-1.5 overflow-hidden group-hover/tab:workspace-tab-title-fade">
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
  );

  return (
    <div
      data-slot="workspace-tool-tab-chip"
      data-state={selected ? "on" : "off"}
      className={cn(
        toggleVariants({ variant: "default" }),
        "group/tab relative shrink-0 items-stretch p-0 text-xs text-muted-foreground",
        displayTitle ? "max-w-[9rem]" : "w-8",
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
        <button
          type="button"
          className="absolute inset-y-0 right-0 hidden w-8 items-center justify-end rounded-r-lg bg-transparent pr-2 outline-none group-hover/tab:flex"
          aria-label={t("workspace.closeTab", { label })}
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X className="size-3 opacity-70" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
