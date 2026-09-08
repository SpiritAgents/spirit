import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";

import { ModelCatalogDetailPanel } from "@/components/model-catalog-detail-panel";
import {
  type ModelDefaultAssignments,
  type ModelDefaultRole,
  type SettingsModelProfile,
  canAssignAsActiveModel,
  canAssignAsImageGenerationModel,
  canAssignAsLightweightChatModel,
  canAssignAsVideoGenerationModel,
  getSupportedModelDefaultRoles,
  modelDefaultActionLabel,
  modelRefKey,
  resolveEffectiveModelRef,
  settingsModelRef,
} from "@/components/settings/models/model-defaults";
import {
  ModelSettingsRowButton,
  ModelSettingsRowWithHover,
} from "@/components/settings/models/model-settings-row";
import { ProviderConnectDialog } from "@/components/settings/models/provider-connect-dialog";
import {
  ProviderPickerRowButton,
  filterProviderRows,
  localizedProviderRows,
  providerPickerLabel,
} from "@/components/settings/models/provider-picker-rows";
import type { SettingsFormState, SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelCatalogScopeEntryKey,
  modelDisplayTitleFromMap,
} from "@/lib/model-catalog-detail";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import type { DesktopModelProvider, ProviderGroupV2 } from "@/types";
import { modelRefsEqual } from "@spiritagent/host-internal/config-v2";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import {
  DESKTOP_LIST_ITEM_PRIMARY_CLASS,
  DESKTOP_PAGE_TITLE_CLASS,
} from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export function ModelsSettingsPanel({
  settings,
  snapshot,
  modelsBusy,
  modelsPreviewBusy,
  onSavePatch,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
}: Pick<
  SettingsViewProps,
  | "settings"
  | "snapshot"
  | "modelsBusy"
  | "modelsPreviewBusy"
  | "onSavePatch"
  | "onAddModel"
  | "onAddProviderModels"
  | "onPreviewModels"
  | "onRemoveModel"
  | "onRemoveProviderModels"
>) {
  const { t } = useTranslation();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const providerSearchInputRef = useRef<HTMLInputElement>(null);
  const providerListRef = useRef<HTMLDivElement>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  /** Increments on each connection attempt in this session; used as ProviderConnectDialog's key to remount and reset the form. */
  const [connectTarget, setConnectTarget] = useState<{
    provider: DesktopModelProvider;
    session: number;
  } | null>(null);
  const [modelDefaultsDialogTarget, setModelDefaultsDialogTarget] = useState<string | null>(null);
  const [modelDefaultsDialogOpen, setModelDefaultsDialogOpen] = useState(false);
  const [modelDefaultAssignments, setModelDefaultAssignments] = useState<ModelDefaultAssignments>({
    activeModel: false,
    imageGenerationModel: false,
    videoGenerationModel: false,
    lightweightChatModel: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(null);

  const models = snapshot?.config.models ?? [];
  const configProviderGroups = snapshot?.config.providerGroups ?? [];
  const activeModel = resolveEffectiveModelRef(settings.activeModel, snapshot?.config.activeModel);
  const imageGenerationModel =
    settings.imageGenerationModel ?? snapshot?.config.imageGenerationModel;
  const videoGenerationModel =
    settings.videoGenerationModel ?? snapshot?.config.videoGenerationModel;
  const lightweightChatModel =
    settings.lightweightChatModel ?? snapshot?.config.lightweightChatModel;
  const modelDefaultsDialogModel =
    modelDefaultsDialogTarget === null
      ? null
      : (models.find(
          (model) => modelRefKey(settingsModelRef(model)) === modelDefaultsDialogTarget,
        ) ?? null);
  const modelDefaultsDialogRef =
    modelDefaultsDialogModel === null ? null : settingsModelRef(modelDefaultsDialogModel);
  const canAssignActiveRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsActiveModel(
      modelDefaultsDialogModel,
      modelDefaultsDialogRef !== null && modelRefsEqual(modelDefaultsDialogRef, activeModel),
    );
  const canAssignImageGenerationRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsImageGenerationModel(
      modelDefaultsDialogModel,
      imageGenerationModel !== undefined &&
        modelDefaultsDialogRef !== null &&
        modelRefsEqual(modelDefaultsDialogRef, imageGenerationModel),
    );
  const canAssignVideoGenerationRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsVideoGenerationModel(
      modelDefaultsDialogModel,
      videoGenerationModel !== undefined &&
        modelDefaultsDialogRef !== null &&
        modelRefsEqual(modelDefaultsDialogRef, videoGenerationModel),
    );
  const canAssignLightweightChatRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsLightweightChatModel(
      modelDefaultsDialogModel,
      lightweightChatModel !== undefined &&
        modelDefaultsDialogRef !== null &&
        modelRefsEqual(modelDefaultsDialogRef, lightweightChatModel),
    );
  const isModelDefaultsDialogModelActive =
    modelDefaultsDialogRef !== null && modelRefsEqual(modelDefaultsDialogRef, activeModel);
  const isModelDefaultsDialogModelLightweight =
    lightweightChatModel !== undefined &&
    modelDefaultsDialogRef !== null &&
    modelRefsEqual(modelDefaultsDialogRef, lightweightChatModel);
  const hasModelDefaultAssignmentChanges =
    modelDefaultsDialogModel !== null &&
    (modelDefaultAssignments.activeModel !== isModelDefaultsDialogModelActive ||
      modelDefaultAssignments.imageGenerationModel !==
        (modelDefaultsDialogRef !== null &&
          imageGenerationModel !== undefined &&
          modelRefsEqual(modelDefaultsDialogRef, imageGenerationModel)) ||
      modelDefaultAssignments.videoGenerationModel !==
        (modelDefaultsDialogRef !== null &&
          videoGenerationModel !== undefined &&
          modelRefsEqual(modelDefaultsDialogRef, videoGenerationModel)) ||
      modelDefaultAssignments.lightweightChatModel !== isModelDefaultsDialogModelLightweight);

  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, snapshot?.config.modelCatalogHints),
    [models, snapshot?.config.modelCatalogHints],
  );
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(models, snapshot?.config.modelCatalogHints),
    [models, snapshot?.config.modelCatalogHints],
  );

  function groupDisplayLabel(group: ProviderGroupV2): string {
    const custom = group.label?.trim();
    if (custom) {
      return custom;
    }
    return providerLabel(group.provider);
  }

  function modelsForGroup(group: ProviderGroupV2): SettingsModelProfile[] {
    return group.models
      .map((entry) =>
        models.find((model) => model.groupId === group.id && model.name === entry.name),
      )
      .filter((model): model is SettingsModelProfile => model !== undefined);
  }

  function providerLabel(provider: DesktopModelProvider): string {
    return providerPickerLabel((key, options) => String(t(key, options)), provider);
  }

  const openProviderPicker = () => {
    setProviderQuery("");
    setProviderDialogOpen(true);
  };

  const startConnect = (id: DesktopModelProvider) => {
    setProviderDialogOpen(false);
    setConnectTarget((prev) => ({ provider: id, session: (prev?.session ?? 0) + 1 }));
    setConnectDialogOpen(true);
  };

  const filteredProviders = filterProviderRows(
    localizedProviderRows((key, options) => String(t(key, options))),
    providerQuery,
  );

  const collectProviderListButtons = (container: HTMLElement | null): HTMLElement[] => {
    if (!container) {
      return [];
    }
    return Array.from(container.querySelectorAll<HTMLElement>("button:not([disabled])"));
  };

  const focusProviderListButton = (item: HTMLElement | undefined): void => {
    if (!item) {
      return;
    }
    item.focus();
    item.scrollIntoView({ block: "nearest" });
  };

  const handleProviderSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusProviderListButton(collectProviderListButtons(providerListRef.current)[0]);
    }
  };

  const handleProviderListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const item =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("button:not([disabled])")
        : null;
    if (!item) {
      return;
    }
    const items = collectProviderListButtons(providerListRef.current);
    const index = items.indexOf(item);
    if (index < 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusProviderListButton(items[index + 1]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) {
        providerSearchInputRef.current?.focus();
      } else {
        focusProviderListButton(items[index - 1]);
      }
    }
  };

  const openModelDefaultsDialog = (model: SettingsModelProfile) => {
    const modelRef = settingsModelRef(model);
    setModelDefaultsDialogTarget(modelRefKey(modelRef));
    setModelDefaultAssignments({
      activeModel: modelRefsEqual(modelRef, activeModel),
      imageGenerationModel:
        imageGenerationModel !== undefined && modelRefsEqual(modelRef, imageGenerationModel),
      videoGenerationModel:
        videoGenerationModel !== undefined && modelRefsEqual(modelRef, videoGenerationModel),
      lightweightChatModel:
        lightweightChatModel !== undefined && modelRefsEqual(modelRef, lightweightChatModel),
    });
    setModelDefaultsDialogOpen(true);
  };

  const dismissModelDefaultsDialog = useCallback(() => {
    setModelDefaultsDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setModelDefaultsDialogTarget(null);
      setModelDefaultAssignments({
        activeModel: false,
        imageGenerationModel: false,
        videoGenerationModel: false,
        lightweightChatModel: false,
      });
    });
  }, []);

  const saveModelDefaultAssignments = async () => {
    if (!modelDefaultsDialogModel) {
      return;
    }

    const patch: Partial<SettingsFormState> = {};

    if (
      modelDefaultAssignments.activeModel &&
      !modelRefsEqual(modelDefaultsDialogRef!, activeModel)
    ) {
      patch.activeModel = modelDefaultsDialogRef!;
    }

    if (canAssignImageGenerationRole) {
      if (
        modelDefaultAssignments.imageGenerationModel &&
        (imageGenerationModel === undefined ||
          !modelRefsEqual(modelDefaultsDialogRef!, imageGenerationModel))
      ) {
        patch.imageGenerationModel = modelDefaultsDialogRef!;
      } else if (
        !modelDefaultAssignments.imageGenerationModel &&
        imageGenerationModel !== undefined &&
        modelRefsEqual(modelDefaultsDialogRef!, imageGenerationModel)
      ) {
        patch.imageGenerationModel = undefined;
      }
    }

    if (canAssignVideoGenerationRole) {
      if (
        modelDefaultAssignments.videoGenerationModel &&
        (videoGenerationModel === undefined ||
          !modelRefsEqual(modelDefaultsDialogRef!, videoGenerationModel))
      ) {
        patch.videoGenerationModel = modelDefaultsDialogRef!;
      } else if (
        !modelDefaultAssignments.videoGenerationModel &&
        videoGenerationModel !== undefined &&
        modelRefsEqual(modelDefaultsDialogRef!, videoGenerationModel)
      ) {
        patch.videoGenerationModel = undefined;
      }
    }

    if (canAssignLightweightChatRole) {
      if (
        modelDefaultAssignments.lightweightChatModel &&
        (lightweightChatModel === undefined ||
          !modelRefsEqual(modelDefaultsDialogRef!, lightweightChatModel))
      ) {
        patch.lightweightChatModel = modelDefaultsDialogRef!;
      } else if (
        !modelDefaultAssignments.lightweightChatModel &&
        lightweightChatModel !== undefined &&
        modelRefsEqual(modelDefaultsDialogRef!, lightweightChatModel)
      ) {
        patch.lightweightChatModel = undefined;
      }
    }

    if (Object.keys(patch).length === 0) {
      dismissModelDefaultsDialog();
      return;
    }

    await onSavePatch(patch);
    dismissModelDefaultsDialog();
  };

  const saveSingleModelDefaultRole = async (
    model: SettingsModelProfile,
    role: ModelDefaultRole,
  ) => {
    const patch: Partial<SettingsFormState> = {};

    const modelRef = settingsModelRef(model);

    if (role === "activeModel") {
      if (!modelRefsEqual(modelRef, activeModel)) {
        patch.activeModel = modelRef;
      }
    } else if (role === "imageGenerationModel") {
      if (imageGenerationModel === undefined || !modelRefsEqual(modelRef, imageGenerationModel)) {
        patch.imageGenerationModel = modelRef;
      }
    } else if (role === "videoGenerationModel") {
      if (videoGenerationModel === undefined || !modelRefsEqual(modelRef, videoGenerationModel)) {
        patch.videoGenerationModel = modelRef;
      }
    } else if (
      lightweightChatModel === undefined ||
      !modelRefsEqual(modelRef, lightweightChatModel)
    ) {
      patch.lightweightChatModel = modelRef;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    await onSavePatch(patch);
  };

  const handleModelDefaultAction = (model: SettingsModelProfile) => {
    const supportedRoles = getSupportedModelDefaultRoles(
      model,
      activeModel,
      imageGenerationModel,
      videoGenerationModel,
      lightweightChatModel,
    );

    if (supportedRoles.length === 0) {
      openModelDefaultsDialog(model);
      return;
    }

    if (supportedRoles.length === 1) {
      void (async () => {
        try {
          await saveSingleModelDefaultRole(model, supportedRoles[0]);
        } catch {
          /* runtimeError */
        }
      })();
      return;
    }

    openModelDefaultsDialog(model);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.modelsTitle")}</h1>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            openProviderPicker();
          }}
          disabled={modelsBusy || modelsPreviewBusy}
        >
          {t("settings.connectProvider")}
        </Button>
      </div>

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "px-4 py-10 text-center")}>
            <p className="text-sm text-muted-foreground">{t("settings.noSavedModels")}</p>
          </div>
        ) : (
          <>
            {configProviderGroups.map((group) => {
              const groupModels = modelsForGroup(group);
              if (groupModels.length === 0) {
                return null;
              }
              const groupHasKey = groupModels.some((m) => m.keyConfigured);
              const groupLabel = groupDisplayLabel(group);
              return (
                <div key={group.id} className={cn(DESKTOP_CANVAS_CARD_SURFACE, "overflow-hidden")}>
                  <div className="flex items-center justify-between gap-3 border-b border-border/35 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{groupLabel}</span>
                      <Badge variant="secondary" className="text-muted-foreground shrink-0">
                        {groupModels.length} {t("settings.modelsCount")}
                      </Badge>
                      {groupHasKey ? (
                        <Badge variant="secondary" className="text-muted-foreground shrink-0">
                          {t("settings.keySaved")}
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setDeleteGroupTarget(group.id)}
                    >
                      {t("settings.deleteGroup")}
                    </Button>
                  </div>
                  {groupModels.some((model) =>
                    catalogDetailByModelName.has(modelCatalogScopeEntryKey(model)),
                  ) ? (
                    <Tooltip<SettingsModelProfile>
                      getItemId={(model) => modelRefKey(settingsModelRef(model))}
                      delayDuration={300}
                    >
                      <Tooltip.Zone className="divide-y divide-border/35">
                        {groupModels.map((model) => {
                          const modelRef = settingsModelRef(model);
                          const isActive = modelRefsEqual(modelRef, activeModel);
                          const isImageDefault =
                            imageGenerationModel !== undefined &&
                            modelRefsEqual(modelRef, imageGenerationModel);
                          const isLightweightDefault =
                            lightweightChatModel !== undefined &&
                            modelRefsEqual(modelRef, lightweightChatModel);
                          const supportedDefaultRoles = getSupportedModelDefaultRoles(
                            model,
                            activeModel,
                            imageGenerationModel,
                            videoGenerationModel,
                            lightweightChatModel,
                          );
                          const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                          const rowDisabled = modelsBusy || modelsPreviewBusy;
                          const hasDetail = catalogDetailByModelName.has(
                            modelCatalogScopeEntryKey(model),
                          );
                          const displayTitle = modelDisplayTitleFromMap(
                            model,
                            displayTitleByModelName,
                          );

                          if (!hasDetail) {
                            return (
                              <ModelSettingsRowButton
                                key={modelRefKey(modelRef)}
                                model={model}
                                displayTitle={displayTitle}
                                isActive={isActive}
                                isImageDefault={isImageDefault}
                                isLightweightDefault={isLightweightDefault}
                                defaultActionLabel={defaultActionLabel}
                                disabled={rowDisabled}
                                onDefaultAction={() => handleModelDefaultAction(model)}
                              />
                            );
                          }

                          return (
                            <ModelSettingsRowWithHover
                              key={model.name}
                              model={model}
                              displayTitle={displayTitle}
                              isActive={isActive}
                              isImageDefault={isImageDefault}
                              isLightweightDefault={isLightweightDefault}
                              defaultActionLabel={defaultActionLabel}
                              disabled={rowDisabled}
                              onDefaultAction={() => handleModelDefaultAction(model)}
                            />
                          );
                        })}
                      </Tooltip.Zone>
                      <TooltipContent
                        appearance="detail"
                        side="right"
                        align="start"
                        sideOffset={8}
                        collisionPadding={16}
                        className="z-[100] w-80 max-w-[min(20rem,calc(100vw-2rem))] p-3"
                      >
                        {(activeRow) => {
                          const row = activeRow as SettingsModelProfile | null;
                          if (!row) {
                            return null;
                          }
                          const catalogEntry = catalogDetailByModelName.get(
                            modelCatalogScopeEntryKey(row),
                          );
                          if (!catalogEntry) {
                            return null;
                          }
                          return (
                            <ModelCatalogDetailPanel
                              model={row}
                              catalogEntry={catalogEntry}
                              providerLabel={groupLabel}
                            />
                          );
                        }}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <div className="divide-y divide-border/35">
                      {groupModels.map((model) => {
                        const modelRef = settingsModelRef(model);
                        const isActive = modelRefsEqual(modelRef, activeModel);
                        const isImageDefault =
                          imageGenerationModel !== undefined &&
                          modelRefsEqual(modelRef, imageGenerationModel);
                        const isLightweightDefault =
                          lightweightChatModel !== undefined &&
                          modelRefsEqual(modelRef, lightweightChatModel);
                        const supportedDefaultRoles = getSupportedModelDefaultRoles(
                          model,
                          activeModel,
                          imageGenerationModel,
                          videoGenerationModel,
                          lightweightChatModel,
                        );
                        const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                        const displayTitle = modelDisplayTitleFromMap(
                          model,
                          displayTitleByModelName,
                        );
                        return (
                          <ModelSettingsRowButton
                            key={modelRefKey(modelRef)}
                            model={model}
                            displayTitle={displayTitle}
                            isActive={isActive}
                            isImageDefault={isImageDefault}
                            isLightweightDefault={isLightweightDefault}
                            defaultActionLabel={defaultActionLabel}
                            disabled={modelsBusy || modelsPreviewBusy}
                            onDefaultAction={() => handleModelDefaultAction(model)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <Dialog
        open={modelDefaultsDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setModelDefaultsDialogOpen(true);
          } else if (!modelsBusy && !modelsPreviewBusy) {
            dismissModelDefaultsDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.setAsDefault")}</DialogTitle>
            <DialogDescription>
              {t("settings.setAsDefaultDescription", {
                name: modelDefaultsDialogModel
                  ? modelDisplayTitleFromMap(modelDefaultsDialogModel, displayTitleByModelName)
                  : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {canAssignActiveRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={
                  modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive || undefined
                }
              >
                <Checkbox
                  id="model-default-active"
                  checked={modelDefaultAssignments.activeModel}
                  disabled={modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      activeModel: checked === true || isModelDefaultsDialogModelActive,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="model-default-active" className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>
                    {t("settings.activeModelLabel")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {isModelDefaultsDialogModelActive
                      ? t("settings.activeModelKeepHint")
                      : t("settings.activeModelUsage")}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignImageGenerationRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-image-generation"
                  checked={modelDefaultAssignments.imageGenerationModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      imageGenerationModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-image-generation"
                    className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}
                  >
                    {t("settings.imageGenModelLabel")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("settings.imageGenModelUsage")}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignVideoGenerationRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-video-generation"
                  checked={modelDefaultAssignments.videoGenerationModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      videoGenerationModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-video-generation"
                    className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}
                  >
                    {t("settings.videoGenModelLabel")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("settings.videoGenModelUsage")}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignLightweightChatRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-lightweight-chat"
                  checked={modelDefaultAssignments.lightweightChatModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      lightweightChatModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-lightweight-chat"
                    className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}
                  >
                    {t("settings.lightweightChatModelLabel")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("settings.lightweightChatModelUsage")}
                  </p>
                </div>
              </div>
            ) : null}
            {!canAssignActiveRole &&
            !canAssignImageGenerationRole &&
            !canAssignVideoGenerationRole &&
            !canAssignLightweightChatRole ? (
              <div className="rounded-lg border border-dashed border-dialog-panel-border px-3 py-4 text-sm text-muted-foreground">
                {t("settings.noDefaultRolesForModel")}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={dismissModelDefaultsDialog}
                disabled={modelsBusy || modelsPreviewBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={modelsBusy || modelsPreviewBusy || !hasModelDefaultAssignmentChanges}
                onClick={() => {
                  void (async () => {
                    try {
                      await saveModelDefaultAssignments();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("common.save")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.deleteModel")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteModelConfirm", { name: deleteTarget ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={modelsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={modelsBusy || !deleteTarget}
                onClick={() => {
                  const name = deleteTarget;
                  if (!name) {
                    return;
                  }
                  void (async () => {
                    try {
                      await onRemoveModel(name);
                      setDeleteTarget(null);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("common.delete")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGroupTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.deleteProviderGroup")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteProviderGroupConfirm", {
                provider: deleteGroupTarget
                  ? configProviderGroups.find((group) => group.id === deleteGroupTarget)
                    ? groupDisplayLabel(
                        configProviderGroups.find((group) => group.id === deleteGroupTarget)!,
                      )
                    : deleteGroupTarget
                  : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteGroupTarget(null)}
                disabled={modelsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={modelsBusy || !deleteGroupTarget}
                onClick={() => {
                  const groupId = deleteGroupTarget;
                  if (!groupId) {
                    return;
                  }
                  void (async () => {
                    try {
                      await onRemoveProviderModels(groupId);
                      setDeleteGroupTarget(null);
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("settings.deleteGroup")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={providerDialogOpen}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) {
            setProviderQuery("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.selectProvider")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <DesktopFormInput
              ref={providerSearchInputRef}
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              onKeyDown={handleProviderSearchKeyDown}
              placeholder={t("common.search")}
              autoComplete="off"
            />
            <ScrollArea className="h-80">
              <div ref={providerListRef} className="px-0.5" onKeyDown={handleProviderListKeyDown}>
                {filteredProviders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {t("app.noMatches")}
                  </p>
                ) : (
                  filteredProviders.map((row) => (
                    <ProviderPickerRowButton key={row.id} row={row} onSelect={startConnect} />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {connectTarget !== null ? (
        <ProviderConnectDialog
          key={`${connectTarget.provider}-${connectTarget.session}`}
          provider={connectTarget.provider}
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
          busy={modelsBusy}
          previewBusy={modelsPreviewBusy}
          onAddModel={onAddModel}
          onAddProviderModels={onAddProviderModels}
          onPreviewModels={onPreviewModels}
        />
      ) : null}
    </div>
  );
}
