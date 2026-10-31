import { useEffect, useMemo, useRef, useState } from "react";
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
  isValidDesktopAutomationTrigger,
  type DesktopAutomationTrigger,
} from "@/lib/automation-trigger";
import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import type {
  ApprovalLevel,
  DesktopAutomationDefinition,
  DesktopModelEffortSelection,
  DesktopSnapshot,
  DesktopUpdateAutomationRequest,
  DesktopWorkspaceBinding,
  GitHubAutomationRepositoriesSnapshot,
  ModelRef,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "@/types";
import { emptyModelRef, isEmptyModelRef, modelRefsEqual } from "@/lib/model-ref";
import { configuredModelEffort, modelEffortPreference } from "@/lib/model-picker-controls";
import { resolveWorkspaceBindingForStoredRoot } from "@/lib/workspace-display-label";

type AutomationSettingsPanelProps = {
  automationId: string;
  definition: DesktopAutomationDefinition | undefined;
  snapshot: DesktopSnapshot | null;
  disabled?: boolean;
  githubConnected: boolean;
  githubAuthChecking?: boolean;
  onOpenIntegrationsSettings?: () => void;
  onSave(patch: DesktopUpdateAutomationRequest): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
};

function triggersEqual(left: DesktopAutomationTrigger, right: DesktopAutomationTrigger): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const automationSettingsCardClassName = cn(
  "rounded-lg border border-border/40 bg-background/60 p-4",
);

export function AutomationSettingsPanel({
  automationId,
  definition,
  snapshot,
  disabled,
  githubConnected,
  githubAuthChecking,
  onOpenIntegrationsSettings,
  onSave,
  onAddWorkspace,
  listGitHubRepositories,
  searchGitHubRepositories,
}: AutomationSettingsPanelProps) {
  const { t } = useTranslation();
  const initializedForAutomationIdRef = useRef<string | null>(null);
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [trigger, setTrigger] = useState<DesktopAutomationTrigger>(defaultDesktopTimeTrigger());
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspaceBinding, setWorkspaceBinding] = useState<DesktopWorkspaceBinding>("project");
  const [modelRef, setModelRef] = useState<ModelRef>(emptyModelRef());
  const [reasoningEffort, setReasoningEffort] = useState<DesktopModelEffortSelection | undefined>();
  const [approvalLevel, setApprovalLevel] = useState<ApprovalLevel>("default");

  useEffect(() => {
    initializedForAutomationIdRef.current = null;
  }, [automationId]);

  const definitionModel = snapshot?.config.models.find((model) =>
    modelRefsEqual(model.ref, definition?.modelRef ?? emptyModelRef()),
  );
  const selectedModel = snapshot?.config.models.find((model) =>
    modelRefsEqual(model.ref, modelRef),
  );

  useEffect(() => {
    if (
      !definition ||
      !snapshot?.userHomeDirectory ||
      initializedForAutomationIdRef.current === automationId
    ) {
      return;
    }

    initializedForAutomationIdRef.current = automationId;
    setTitle(definition.title);
    setOverview(definition.overview);
    setTrigger(definition.trigger);
    const homeDirectory = snapshot?.userHomeDirectory ?? "";
    setWorkspaceBinding(
      resolveWorkspaceBindingForStoredRoot(definition.workspaceRoot, homeDirectory),
    );
    setWorkspaceRoot(definition.workspaceRoot);
    setModelRef(definition.modelRef ?? emptyModelRef());
    setReasoningEffort(
      definitionModel
        ? definitionModel.effortSemantics === "output"
          ? definition.effort
          : definition.reasoningEffort
        : undefined,
    );
    setApprovalLevel(definition.approvalLevel);
  }, [automationId, definition, definitionModel, snapshot?.userHomeDirectory]);

  const resolvedWorkspaceRoot =
    workspaceBinding === "none" ? (snapshot?.userHomeDirectory ?? workspaceRoot) : workspaceRoot;

  const patch = useMemo((): DesktopUpdateAutomationRequest | null => {
    if (!definition) {
      return null;
    }

    const next: DesktopUpdateAutomationRequest = {};
    const trimmedTitle = title.trim();
    const trimmedOverview = overview.trim();

    if (trimmedTitle !== definition.title) {
      next.title = trimmedTitle;
    }
    if (trimmedOverview !== definition.overview) {
      next.overview = trimmedOverview;
    }
    if (!triggersEqual(trigger, definition.trigger)) {
      next.trigger = trigger;
    }
    if (resolvedWorkspaceRoot !== definition.workspaceRoot) {
      next.workspaceRoot = resolvedWorkspaceRoot;
    }
    const modelChanged = !modelRefsEqual(modelRef, definition.modelRef);
    if (modelChanged) {
      next.modelRef = modelRef;
    }
    const savedEffort = selectedModel
      ? selectedModel.effortSemantics === "output"
        ? definition.effort
        : definition.reasoningEffort
      : undefined;
    if ((modelChanged || reasoningEffort !== savedEffort) && selectedModel) {
      Object.assign(next, modelEffortPreference(selectedModel, reasoningEffort));
    }
    if (approvalLevel !== definition.approvalLevel) {
      next.approvalLevel = approvalLevel;
    }

    return Object.keys(next).length > 0 ? next : null;
  }, [
    approvalLevel,
    definition,
    modelRef,
    overview,
    reasoningEffort,
    resolvedWorkspaceRoot,
    selectedModel,
    trigger,
    title,
  ]);

  const canSave =
    title.trim().length > 0 &&
    overview.trim().length > 0 &&
    (workspaceBinding === "none" || workspaceRoot.trim().length > 0) &&
    resolvedWorkspaceRoot.trim().length > 0 &&
    !isEmptyModelRef(modelRef) &&
    isValidDesktopAutomationTrigger(trigger) &&
    (trigger.kind !== "github" || githubConnected) &&
    patch !== null;

  if (!definition) {
    return (
      <div className={automationSettingsCardClassName}>
        <p className="py-8 text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className={automationSettingsCardClassName}>
      <div className="flex flex-col gap-4">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
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
                    if (!snapshot.userHomeDirectory) {
                      return;
                    }
                    setWorkspaceBinding("none");
                    setWorkspaceRoot(snapshot.userHomeDirectory);
                  }}
                  onAddWorkspace={onAddWorkspace}
                />
                <ModelPickerMenu
                  models={snapshot.config.models}
                  catalogHints={snapshot.config.modelCatalogHints}
                  providers={snapshot.config.providers}
                  providerPresets={snapshot.config.providerPickerPresets}
                  activeModelRef={modelRef}
                  activeReasoningEffort={reasoningEffort}
                  disabled={disabled}
                  onModelSelect={(ref) => {
                    setModelRef(ref);
                    const profile = snapshot.config.models.find((model) =>
                      modelRefsEqual(model.ref, ref),
                    );
                    setReasoningEffort(profile ? configuredModelEffort(profile) : undefined);
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
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={disabled || !canSave}
            onClick={() => {
              if (!patch) {
                return;
              }
              void Promise.resolve(onSave(patch)).then(() => {
                initializedForAutomationIdRef.current = null;
              });
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
