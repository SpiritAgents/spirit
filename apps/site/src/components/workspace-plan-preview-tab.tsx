import { useEffect, useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { MarkdownMessage } from "@/components/markdown-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import type { PlanSnapshot, WorkspaceExplorerListResult } from "@/types/spirit-desktop";

export type WorkspacePlanPreviewTabProps = {
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  plan: PlanSnapshot;
  planPreviewContent: string;
  autoRevealPlanNonce?: number;
  selectedEntryKey?: string | null;
  onSelectPlan?: () => void;
  hideFileTree?: boolean;
};

export function WorkspacePlanPreviewTab({
  workspaceRoot,
  listExplorerChildren,
  plan,
  planPreviewContent,
  autoRevealPlanNonce = 0,
  selectedEntryKey,
  onSelectPlan,
  hideFileTree = false,
}: WorkspacePlanPreviewTabProps) {
  const { messages } = useI18n();
  // A mount that already carries a reveal (e.g. restored while revealed) selects the plan.
  const [selectedPlanState, setSelectedPlan] = useState(autoRevealPlanNonce > 0);
  const [previousRevealNonce, setPreviousRevealNonce] = useState(autoRevealPlanNonce);
  if (previousRevealNonce !== autoRevealPlanNonce) {
    setPreviousRevealNonce(autoRevealPlanNonce);
    if (autoRevealPlanNonce > 0) {
      setSelectedPlan(true);
    }
  }
  const selectedPlan = selectedEntryKey ? selectedEntryKey === "plan" : selectedPlanState;

  useEffect(() => {
    if (autoRevealPlanNonce > 0) {
      onSelectPlan?.();
    }
  }, [autoRevealPlanNonce, onSelectPlan]);

  const showPlanPreview = hideFileTree ? true : selectedPlan && plan.exists;
  const planFileName = plan.path.split(/[/\\]/u).pop() ?? "plan";

  if (hideFileTree) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-border/30 pb-2">
          <span className={`truncate ${FONT_WEIGHT_NORMAL} text-foreground`}>{planFileName}</span>
          <span className="shrink-0 rounded-md border border-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Preview
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
          {planPreviewContent.trim() ? (
            <MarkdownMessage
              content={planPreviewContent}
              streaming
              className="px-1 pb-4 font-sans text-sm"
            />
          ) : (
            <p className="px-1 text-muted-foreground">{messages.desktop.files.planNotCreated}</p>
          )}
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden",
          showPlanPreview
            ? "w-[min(40%,13rem)] shrink-0 border-r border-border/40 pr-2"
            : "min-w-0 flex-1",
        )}
      >
        <WorkspaceFilesPanel
          workspaceRoot={workspaceRoot}
          listExplorerChildren={listExplorerChildren}
          plan={plan}
          selectedEntryKey={showPlanPreview ? "plan" : (selectedEntryKey ?? null)}
          onOpenPlan={() => {
            setSelectedPlan(true);
            onSelectPlan?.();
          }}
        />
      </div>
      {showPlanPreview ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
          <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-border/30 pb-2">
            <span className={`truncate ${FONT_WEIGHT_NORMAL} text-foreground`}>{planFileName}</span>
            <span className="shrink-0 rounded-md border border-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Preview
            </span>
          </div>
          <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
            {planPreviewContent.trim() ? (
              <MarkdownMessage
                content={planPreviewContent}
                streaming
                className="px-1 pb-4 font-sans text-sm"
              />
            ) : (
              <p className="px-1 text-muted-foreground">{messages.desktop.files.planNotCreated}</p>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
