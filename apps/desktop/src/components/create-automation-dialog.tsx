import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import {
  AutomationTriggerMenu,
  defaultDesktopTimeTrigger,
} from "@/components/automation-trigger-menu";
import { ModelPickerMenu } from "@/components/model-picker-menu";
import { WorkspaceSelectorMenu } from "@/components/workspace-selector-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isValidDesktopAutomationTrigger,
  type DesktopAutomationTrigger,
} from "@/lib/automation-trigger";
import type {
  ApprovalLevel,
  DesktopCreateAutomationRequest,
  DesktopModelReasoningEffort,
  DesktopSnapshot,
  DesktopWorkspaceBinding,
  GitHubAutomationRepositoriesSnapshot,
  ModelRef,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "@/types";
import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import { emptyModelRef, isEmptyModelRef, modelRefsEqual } from "@/lib/model-ref";
import { cn } from "@/lib/utils";

type CreateAutomationDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: DesktopSnapshot | null;
  disabled?: boolean;
  githubConnected: boolean;
  githubAuthChecking?: boolean;
  onOpenIntegrationsSettings?: () => void;
  onSubmit(request: DesktopCreateAutomationRequest): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
};

export function CreateAutomationDialog({
  open,
  onOpenChange,
  snapshot,
  disabled,
  githubConnected,
  githubAuthChecking,
  onOpenIntegrationsSettings,
  onSubmit,
  onAddWorkspace,
  listGitHubRepositories,
  searchGitHubRepositories,
}: CreateAutomationDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [trigger, setTrigger] = useState<DesktopAutomationTrigger>(defaultDesktopTimeTrigger());
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspaceBinding, setWorkspaceBinding] = useState<DesktopWorkspaceBinding>("project");
  const [modelRef, setModelRef] = useState<ModelRef>(emptyModelRef());
  const [reasoningEffort, setReasoningEffort] = useState<DesktopModelReasoningEffort | undefined>();
  const [approvalLevel, setApprovalLevel] = useState<ApprovalLevel>("default");

  const initializedForOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (!snapshot || initializedForOpenRef.current) {
      return;
    }

    initializedForOpenRef.current = true;
    setTitle("");
    setOverview("");
    setTrigger(defaultDesktopTimeTrigger());
    setWorkspaceBinding(snapshot.workspaceBinding);
    setWorkspaceRoot(
      snapshot.workspaceBinding === "none" ? snapshot.userHomeDirectory : snapshot.workspaceRoot,
    );
    setModelRef(snapshot.config.activeModel);
    const activeModel = snapshot.config.models.find((model) =>
      modelRefsEqual(model.ref, snapshot.config.activeModel),
    );
    setReasoningEffort(activeModel?.reasoningEffort);
    setApprovalLevel(snapshot.conversation.approvalLevel);
  }, [open, snapshot]);

  const resolvedWorkspaceRoot =
    workspaceBinding === "none" ? (snapshot?.userHomeDirectory ?? "") : workspaceRoot;

  const canSubmit =
    title.trim().length > 0 &&
    overview.trim().length > 0 &&
    (workspaceBinding === "none" || workspaceRoot.trim().length > 0) &&
    resolvedWorkspaceRoot.trim().length > 0 &&
    !isEmptyModelRef(modelRef) &&
    isValidDesktopAutomationTrigger(trigger) &&
    (trigger.kind !== "github" || githubConnected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,40rem)] max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("automations.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pt-6 pb-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("automations.dialogTitlePlaceholder")}
            disabled={disabled}
            className={cn(
              "w-full border-0 bg-transparent text-lg text-foreground outline-none placeholder:text-muted-foreground/70",
              FONT_WEIGHT_MEDIUM,
            )}
          />
          <textarea
            value={overview}
            onChange={(event) => setOverview(event.target.value)}
            placeholder={t("automations.dialogOverviewPlaceholder")}
            disabled={disabled}
            rows={8}
            className={cn(
              "min-h-[12rem] w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70",
            )}
          />
        </div>
        <DialogFooter layout="split" inset>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <AutomationTriggerMenu
              trigger={trigger}
              disabled={disabled}
              githubConnected={githubConnected}
              githubAuthChecking={githubAuthChecking}
              onOpenIntegrationsSettings={onOpenIntegrationsSettings}
              onTriggerChange={setTrigger}
              listGitHubRepositories={listGitHubRepositories}
              searchGitHubRepositories={searchGitHubRepositories}
            />
            {snapshot ? (
              <>
                <WorkspaceSelectorMenu
                  currentWorkspaceRoot={resolvedWorkspaceRoot}
                  workspaceBinding={workspaceBinding}
                  availableWorkspaces={snapshot.availableWorkspaces}
                  disabled={disabled}
                  onSelectWorkspace={(path) => {
                    setWorkspaceBinding("project");
                    setWorkspaceRoot(path);
                  }}
                  onSelectNoWorkspace={() => {
                    setWorkspaceBinding("none");
                    setWorkspaceRoot(snapshot.userHomeDirectory);
                  }}
                  onAddWorkspace={onAddWorkspace}
                />
                <ModelPickerMenu
                  models={snapshot.config.models}
                  catalogHints={snapshot.config.modelCatalogHints}
                  providers={snapshot.config.providers}
                  activeModelRef={modelRef}
                  activeReasoningEffort={reasoningEffort}
                  disabled={disabled}
                  onModelSelect={(ref) => {
                    setModelRef(ref);
                    const profile = snapshot.config.models.find((model) =>
                      modelRefsEqual(model.ref, ref),
                    );
                    setReasoningEffort(profile?.reasoningEffort);
                  }}
                  onModelReasoningEffortSelect={(ref, effort) => {
                    setModelRef(ref);
                    setReasoningEffort(effort);
                  }}
                />
                <ApprovalLevelMenu
                  approvalLevel={approvalLevel}
                  disabled={disabled}
                  onApprovalLevelChange={setApprovalLevel}
                />
              </>
            ) : null}
          </div>
          <DialogFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={disabled}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={disabled || !canSubmit}
              onClick={() => {
                void onSubmit({
                  title: title.trim(),
                  overview: overview.trim(),
                  trigger,
                  workspaceRoot: resolvedWorkspaceRoot,
                  modelRef,
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                  approvalLevel,
                });
                onOpenChange(false);
              }}
            >
              {t("common.create")}
            </Button>
          </DialogFooterActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
