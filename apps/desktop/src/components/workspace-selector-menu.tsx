import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderPlus, MessageCircle } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipTrigger,
  useOptionalTooltipStableActions,
} from "@/components/ui/tooltip";
import {
  DESKTOP_GHOST_INLINE_TRIGGER,
  DESKTOP_OVERLAY_LIST_ACTION_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
  DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
} from "@/lib/desktop-chrome";
import { useTruncatedElement } from "@/hooks/use-truncated-element";
import { resolveWorkspaceSelectorLabel, sameWorkspacePath } from "@/lib/workspace-display-label";
import type { DesktopSnapshot } from "@/types";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export type WorkspaceSelectorMenuProps = {
  currentWorkspaceRoot: string;
  workspaceBinding: DesktopSnapshot["workspaceBinding"];
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onSelectNoWorkspace?(): void;
  onAddWorkspace?(): void;
  showNoWorkspaceOption?: boolean;
  triggerClassName?: string;
};

type WorkspaceListTooltipItem = {
  id: string;
  label?: string;
  path?: string;
};

function WorkspaceSelectorMenuItem({
  workspace,
  selected,
  onSelect,
}: {
  workspace: DesktopSnapshot["availableWorkspaces"][number];
  selected: boolean;
  onSelect(): void;
}) {
  const { ref: labelRef, isTruncated: isLabelTruncated } = useTruncatedElement<HTMLDivElement>(
    workspace.label,
  );
  const { ref: pathRef, isTruncated: isPathTruncated } = useTruncatedElement<HTMLDivElement>(
    workspace.path,
  );
  const tooltipItem: WorkspaceListTooltipItem | null =
    isLabelTruncated || isPathTruncated
      ? {
          id: workspace.path,
          label: isLabelTruncated ? workspace.label : undefined,
          path: isPathTruncated ? workspace.path : undefined,
        }
      : null;

  return (
    <TooltipItem item={tooltipItem}>
      <DropdownMenuItem
        onSelect={onSelect}
        className={cn(
          "items-start",
          DESKTOP_MENU_TRIGGER_TEXT_CLASS,
          DESKTOP_OVERLAY_LIST_ITEM,
          selected && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
        )}
      >
        <div className="min-w-0 flex-1">
          <div ref={labelRef} className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "truncate")}>
            {workspace.label}
          </div>
          <div ref={pathRef} className={cn(DESKTOP_OVERLAY_LIST_ITEM_SECONDARY, "truncate")}>
            {workspace.path}
          </div>
        </div>
      </DropdownMenuItem>
    </TooltipItem>
  );
}

export function WorkspaceSelectorMenu({
  currentWorkspaceRoot,
  workspaceBinding,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onSelectNoWorkspace,
  onAddWorkspace,
  showNoWorkspaceOption = true,
  triggerClassName,
}: WorkspaceSelectorMenuProps) {
  const { t } = useTranslation();
  const tooltipActions = useOptionalTooltipStableActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }
    return availableWorkspaces.filter(
      (workspace) =>
        workspace.label.toLowerCase().includes(query) ||
        workspace.path.toLowerCase().includes(query),
    );
  }, [availableWorkspaces, workspaceFilter]);
  const currentWorkspaceLabel = useMemo(
    () =>
      resolveWorkspaceSelectorLabel(currentWorkspaceRoot, workspaceBinding, availableWorkspaces, t),
    [availableWorkspaces, currentWorkspaceRoot, t, workspaceBinding],
  );
  const suppressTooltip = menuOpen || disabled === true;
  const { ref: triggerLabelRef, isTruncated: isTriggerLabelTruncated } =
    useTruncatedElement<HTMLSpanElement>(currentWorkspaceLabel);
  const triggerTooltipText = isTriggerLabelTruncated
    ? currentWorkspaceLabel
    : t("app.selectWorkspace");

  return (
    <FilteredOverlayMenu
      variant="workspace-panel"
      filterValue={workspaceFilter}
      onFilterChange={setWorkspaceFilter}
      filterPlaceholder={t("app.searchWorkspace")}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) {
          setWorkspaceFilter("");
          tooltipActions?.dismissIfOpen();
        }
      }}
      trigger={
        <Tooltip
          open={suppressTooltip ? false : undefined}
          delayDuration={300}
          disableHoverableContent
        >
          <TooltipTrigger asChild>
            <FilteredOverlayMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("app.selectWorkspace")}
                className={cn(
                  DESKTOP_GHOST_INLINE_TRIGGER,
                  DESKTOP_MENU_TRIGGER_TEXT_CLASS,
                  "text-muted-foreground",
                  triggerClassName,
                )}
              >
                <span ref={triggerLabelRef} className="min-w-0 truncate">
                  {currentWorkspaceLabel}
                </span>
                <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
              </button>
            </FilteredOverlayMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {triggerTooltipText}
          </TooltipContent>
        </Tooltip>
      }
      footer={
        onAddWorkspace || onSelectNoWorkspace ? (
          <>
            {onAddWorkspace ? (
              <DropdownMenuItem
                onSelect={onAddWorkspace}
                className={cn("gap-1.5", DESKTOP_OVERLAY_LIST_ACTION_ITEM)}
              >
                <FolderPlus className="size-3 shrink-0" aria-hidden />
                <span>{t("app.addWorkspace")}</span>
              </DropdownMenuItem>
            ) : null}
            {showNoWorkspaceOption && onSelectNoWorkspace ? (
              <DropdownMenuItem
                onSelect={onSelectNoWorkspace}
                className={cn(
                  "gap-1.5",
                  DESKTOP_OVERLAY_LIST_ACTION_ITEM,
                  workspaceBinding === "none" && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
                )}
              >
                <MessageCircle className="size-3 shrink-0" aria-hidden />
                <span>{t("app.noWorkspace")}</span>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : undefined
      }
    >
      {filteredWorkspaces.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("app.noMatches")}</p>
      ) : (
        <Tooltip<WorkspaceListTooltipItem>
          getItemId={(item) => item.id}
          delayDuration={300}
          disableHoverableContent
        >
          <Tooltip.Zone>
            {filteredWorkspaces.map((workspace) => {
              const selected =
                workspaceBinding === "project" &&
                sameWorkspacePath(workspace.path, currentWorkspaceRoot);
              return (
                <WorkspaceSelectorMenuItem
                  key={workspace.path}
                  workspace={workspace}
                  selected={selected}
                  onSelect={() => onSelectWorkspace(workspace.path)}
                />
              );
            })}
          </Tooltip.Zone>
          <TooltipContent side="right" sideOffset={8}>
            {(activeItem) => {
              if (!activeItem || typeof activeItem !== "object") {
                return null;
              }
              const item = activeItem as WorkspaceListTooltipItem;
              return (
                <div className="flex max-w-xs flex-col gap-0.5">
                  {item.label ? <span>{item.label}</span> : null}
                  {item.path ? <span>{item.path}</span> : null}
                </div>
              );
            }}
          </TooltipContent>
        </Tooltip>
      )}
    </FilteredOverlayMenu>
  );
}
