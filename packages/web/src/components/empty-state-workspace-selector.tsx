import { WorkspaceSelectorMenu } from "@/components/workspace-selector-menu";
import { cn } from "@/lib/utils";
import type { DesktopSnapshot } from "@/types";

export type EmptyStateWorkspaceSelectorProps = {
  currentWorkspaceRoot: string;
  workspaceBinding: DesktopSnapshot["workspaceBinding"];
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onSelectNoWorkspace(): void;
  onAddWorkspace(): void;
};

export function EmptyStateWorkspaceSelector({
  currentWorkspaceRoot,
  workspaceBinding,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onSelectNoWorkspace,
  onAddWorkspace,
}: EmptyStateWorkspaceSelectorProps) {
  return (
    <div className="flex justify-start px-0.5">
      <WorkspaceSelectorMenu
        currentWorkspaceRoot={currentWorkspaceRoot}
        workspaceBinding={workspaceBinding}
        availableWorkspaces={availableWorkspaces}
        disabled={disabled}
        onSelectWorkspace={onSelectWorkspace}
        onSelectNoWorkspace={onSelectNoWorkspace}
        onAddWorkspace={onAddWorkspace}
        showNoWorkspaceOption
        triggerClassName={cn("h-8 max-w-[min(24rem,100%)]")}
      />
    </div>
  );
}
