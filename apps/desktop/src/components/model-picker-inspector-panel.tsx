import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  modelReasoningEffortLabel,
  modelReasoningEffortOptions,
  modelSupportsReasoningModeControl,
  resolveModelReasoningMode,
} from "@spiritagent/agent-core/reasoning-effort";
import {
  modelEffortControlLabelKind,
  modelShowsReasoningEffortControl,
  modelSupportsThinkingSwitch,
  resolveModelThinkingEnabled,
} from "@spiritagent/agent-core/model-thinking-controls";
import {
  modelServiceTierOptions,
  modelShowsServiceTierControl,
  modelSupportsAnthropicNativeFast,
  resolveEffectiveModelServiceTier,
} from "@spiritagent/agent-core/model-service-tier";
import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

import { ModelCatalogDetailPanel } from "@/components/model-catalog-detail-panel";
import { modelCatalogHasDetailBody } from "@/lib/model-catalog-detail";
import { modelServiceTierContextFromProfile } from "@/lib/model-service-tier-context";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DESKTOP_GHOST_SELECT_TRIGGER,
  DESKTOP_OVERLAY_LIST_DETAIL_LABEL,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type {
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  ModelProfileSnapshot,
  ModelRef,
  PreviewModelCatalogEntry,
} from "@/types";

function modelInspectorRef(model: ModelProfileSnapshot): ModelRef {
  return model.ref ?? { groupId: model.groupId ?? "", name: model.name };
}

export function modelPickerInspectorNeedsWideLayout(
  model: ModelProfileSnapshot,
  catalogEntry?: PreviewModelCatalogEntry,
): boolean {
  if (modelCatalogHasDetailBody({ model, catalogEntry })) {
    return true;
  }
  if (modelShowsServiceTierControl(modelServiceTierContextFromProfile(model, catalogEntry))) {
    return true;
  }
  const modelContext = {
    ...(model.provider ? { provider: model.provider } : {}),
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.transportKind ? { transportKind: model.transportKind } : {}),
    ...((model.supportsThinkingType ?? catalogEntry?.supportsThinkingType)
      ? { supportsThinkingType: model.supportsThinkingType ?? catalogEntry?.supportsThinkingType }
      : {}),
    ...((model.supportsThinkingSwitch ?? catalogEntry?.supportsThinkingSwitch) === true
      ? { supportsThinkingSwitch: true as const }
      : {}),
  };
  if (modelSupportsThinkingSwitch(modelContext)) {
    return true;
  }
  if (modelSupportsReasoningModeControl(modelContext)) {
    return true;
  }
  const thinkingEnabled = resolveModelThinkingEnabled(model.thinkingEnabled);
  if (!modelShowsReasoningEffortControl(modelContext, thinkingEnabled)) {
    return false;
  }
  return modelReasoningEffortOptions(modelContext).length > 1;
}

type ModelPickerInspectorPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  density?: "default" | "list";
  onReasoningEffortChange: (modelRef: ModelRef, effort: DesktopModelReasoningEffort) => void;
  onReasoningModeChange?: (modelRef: ModelRef, mode: DesktopModelReasoningMode) => void;
  onThinkingEnabledChange?: (modelRef: ModelRef, enabled: boolean) => void | Promise<boolean>;
  /**
   * `undefined` tier clears the stored preference (Anthropic Fast toggled off). The tier
   * controls render only when this callback is provided, so read-only and standalone pickers
   * never show a preference that cannot be saved.
   */
  onServiceTierChange?: (
    modelRef: ModelRef,
    tier: ModelServiceTier | undefined,
  ) => void | Promise<boolean>;
};

export function ModelPickerInspectorPanel({
  model,
  catalogEntry,
  providerLabel,
  density = "default",
  onReasoningEffortChange,
  onReasoningModeChange,
  onThinkingEnabledChange,
  onServiceTierChange,
}: ModelPickerInspectorPanelProps) {
  const { t } = useTranslation();
  const isList = density === "list";
  const modelRef = modelInspectorRef(model);
  const modelContext = {
    ...(model.provider ? { provider: model.provider } : {}),
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.transportKind ? { transportKind: model.transportKind } : {}),
    ...((model.supportsThinkingType ?? catalogEntry?.supportsThinkingType)
      ? { supportsThinkingType: model.supportsThinkingType ?? catalogEntry?.supportsThinkingType }
      : {}),
    ...((model.supportsThinkingSwitch ?? catalogEntry?.supportsThinkingSwitch) === true
      ? { supportsThinkingSwitch: true as const }
      : {}),
  };
  const supportsThinkingSwitch = modelSupportsThinkingSwitch(modelContext);
  const [pendingThinkingEnabled, setPendingThinkingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setPendingThinkingEnabled(null);
  }, [model.name, model.thinkingEnabled]);
  const thinkingEnabled =
    pendingThinkingEnabled ?? resolveModelThinkingEnabled(model.thinkingEnabled);
  const showReasoningEffort = modelShowsReasoningEffortControl(modelContext, thinkingEnabled);
  const effortOptions = showReasoningEffort ? modelReasoningEffortOptions(modelContext) : [];
  const showReasoningMode = modelSupportsReasoningModeControl(modelContext);
  const reasoningMode = resolveModelReasoningMode(model.reasoningMode, modelContext);
  const serviceTierContext = modelServiceTierContextFromProfile(model, catalogEntry);
  const serviceTierOptions = onServiceTierChange ? modelServiceTierOptions(serviceTierContext) : [];
  const showAnthropicFastSwitch = Boolean(
    onServiceTierChange && modelSupportsAnthropicNativeFast(serviceTierContext),
  );
  const [pendingServiceTier, setPendingServiceTier] = useState<{
    value: ModelServiceTier | undefined;
  } | null>(null);
  useEffect(() => {
    setPendingServiceTier(null);
  }, [model.name, model.serviceTier]);
  const effectiveServiceTier = resolveEffectiveModelServiceTier(
    model.serviceTier,
    serviceTierContext,
  );
  const displayedServiceTier = pendingServiceTier ? pendingServiceTier.value : effectiveServiceTier;
  const displayedServiceTierLabel = serviceTierOptions.find(
    (option) => option.value === displayedServiceTier,
  )?.label;
  const handleServiceTierChange = (tier: ModelServiceTier | undefined) => {
    if (!onServiceTierChange) {
      return;
    }
    setPendingServiceTier({ value: tier });
    void Promise.resolve(onServiceTierChange(modelRef, tier)).then((ok) => {
      if (ok === false) {
        setPendingServiceTier(null);
      }
    });
  };
  const effortLabelKey =
    modelEffortControlLabelKind(modelContext) === "effort"
      ? "app.modelPickerEffort"
      : "app.modelPickerReasoningEffort";
  const labelClass = isList ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : "text-xs text-muted-foreground";
  const selectTriggerClass = cn(isList ? "h-7" : "h-8", DESKTOP_GHOST_SELECT_TRIGGER);

  const modelControls =
    supportsThinkingSwitch ||
    effortOptions.length > 1 ||
    showReasoningMode ||
    (serviceTierOptions.length > 0 && displayedServiceTierLabel !== undefined) ||
    showAnthropicFastSwitch ? (
      <div className="space-y-2">
        {supportsThinkingSwitch ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-thinking-${model.name}`}>
              {t("app.modelPickerThinking")}
            </Label>
            <Switch
              id={`model-thinking-${model.name}`}
              checked={thinkingEnabled}
              onCheckedChange={(checked) => {
                setPendingThinkingEnabled(checked);
                void Promise.resolve(onThinkingEnabledChange?.(modelRef, checked)).then((ok) => {
                  if (ok === false) {
                    setPendingThinkingEnabled(null);
                  }
                });
              }}
            />
          </div>
        ) : null}
        {effortOptions.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{t(effortLabelKey)}</Label>
            <Select
              value={model.reasoningEffort}
              onValueChange={(value) => {
                onReasoningEffortChange(modelRef, value as DesktopModelReasoningEffort);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>{modelReasoningEffortLabel(model.reasoningEffort)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[110]">
                {effortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {showReasoningMode ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{t("app.modelPickerReasoningMode")}</Label>
            <Select
              value={reasoningMode}
              onValueChange={(value) => {
                onReasoningModeChange?.(modelRef, value as DesktopModelReasoningMode);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>
                  {reasoningMode === "pro"
                    ? t("app.modelPickerReasoningModePro")
                    : t("app.modelPickerReasoningModeStandard")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[110]">
                <SelectItem value="standard">
                  {t("app.modelPickerReasoningModeStandard")}
                </SelectItem>
                <SelectItem value="pro">{t("app.modelPickerReasoningModePro")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {serviceTierOptions.length > 0 && displayedServiceTierLabel !== undefined ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{t("app.modelPickerServiceTier")}</Label>
            <Select
              value={displayedServiceTier}
              onValueChange={(value) => {
                handleServiceTierChange(value as ModelServiceTier);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>{displayedServiceTierLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[110]">
                {serviceTierOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {showAnthropicFastSwitch ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-fast-mode-${model.name}`}>
              {t("app.modelPickerFastMode")}
            </Label>
            <Switch
              id={`model-fast-mode-${model.name}`}
              checked={displayedServiceTier === "fast"}
              onCheckedChange={(checked) => {
                handleServiceTierChange(checked ? "fast" : undefined);
              }}
            />
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className={isList ? "flex flex-col" : "space-y-4"}>
      <ModelCatalogDetailPanel
        model={model}
        catalogEntry={catalogEntry}
        providerLabel={providerLabel}
        density={density}
      >
        {modelControls}
      </ModelCatalogDetailPanel>
    </div>
  );
}
