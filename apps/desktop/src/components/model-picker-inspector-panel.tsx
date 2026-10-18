import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

import { ModelCatalogDetailPanel } from "@/components/model-catalog-detail-panel";
import { modelCatalogHasDetailBody } from "@/lib/model-catalog-detail";
import {
  declaredReasoningEffortOptions,
  declaredServiceTierControlKind,
  declaredServiceTierOptions,
  effectiveDeclaredServiceTier,
  effectiveReasoningMode,
  effectiveThinkingEnabled,
  showsReasoningEffortControl,
  showsReasoningModeControl,
  showsServiceTierControl,
  showsThinkingSwitchControl,
} from "@/lib/model-picker-controls";
import { serviceTierValueLabelKey } from "@/lib/model-service-tier-context";
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
  return model.ref;
}

export function modelPickerInspectorNeedsWideLayout(
  model: ModelProfileSnapshot,
  catalogEntry?: PreviewModelCatalogEntry,
): boolean {
  if (modelCatalogHasDetailBody({ model, catalogEntry })) {
    return true;
  }
  if (showsServiceTierControl(model, catalogEntry)) {
    return true;
  }
  if (showsThinkingSwitchControl(model)) {
    return true;
  }
  if (showsReasoningModeControl(model)) {
    return true;
  }
  return showsReasoningEffortControl(model);
}

type ModelPickerInspectorPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  density?: "default" | "list";
  onReasoningEffortChange: (modelRef: ModelRef, effort: DesktopModelReasoningEffort) => void;
  onReasoningModeChange?: (modelRef: ModelRef, mode: DesktopModelReasoningMode) => void;
  /**
   * The thinking toggle renders only when this callback is provided, so read-only pickers never
   * show a preference that cannot be saved (same rule as the tier controls).
   */
  onThinkingEnabledChange?: (modelRef: ModelRef, enabled: boolean) => void | Promise<boolean>;
  /**
   * `undefined` tier clears the stored preference. The tier controls render only when this
   * callback is provided, so read-only and standalone pickers never show a preference that
   * cannot be saved.
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
  const showThinkingSwitch =
    onThinkingEnabledChange !== undefined && showsThinkingSwitchControl(model);
  const [pendingThinkingEnabled, setPendingThinkingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setPendingThinkingEnabled(null);
  }, [model.name, model.thinkingEnabled]);
  const thinkingEnabled = pendingThinkingEnabled ?? effectiveThinkingEnabled(model);
  const showReasoningEffort = showsReasoningEffortControl(model);
  const effortOptions = declaredReasoningEffortOptions(model);
  const showReasoningMode = showsReasoningModeControl(model);
  const reasoningMode = effectiveReasoningMode(model);
  const serviceTierControl = onServiceTierChange
    ? declaredServiceTierControlKind(model, catalogEntry)
    : "none";
  const serviceTierOptions =
    serviceTierControl === "select" ? declaredServiceTierOptions(model, catalogEntry) : [];
  // Binary Default-plus-one-tier rows render as a switch named by the non-default tier.
  const switchTier: "fast" | "priority" | undefined =
    serviceTierControl === "fast-switch"
      ? "fast"
      : serviceTierControl === "priority-switch"
        ? "priority"
        : undefined;
  const [pendingServiceTier, setPendingServiceTier] = useState<{
    value: ModelServiceTier | undefined;
  } | null>(null);
  useEffect(() => {
    setPendingServiceTier(null);
  }, [model.name, model.serviceTier]);
  const effectiveServiceTier = effectiveDeclaredServiceTier(model, catalogEntry);
  const displayedServiceTier = pendingServiceTier ? pendingServiceTier.value : effectiveServiceTier;
  const displayedServiceTierLabel =
    displayedServiceTier !== undefined && serviceTierOptions.includes(displayedServiceTier)
      ? t(serviceTierValueLabelKey(displayedServiceTier))
      : undefined;
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
  const displayedEffort = model.reasoningEffort ?? "default";
  const labelClass = isList ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : "text-xs text-muted-foreground";
  const selectTriggerClass = cn(isList ? "h-7" : "h-8", DESKTOP_GHOST_SELECT_TRIGGER);

  const modelControls =
    showThinkingSwitch ||
    showReasoningEffort ||
    showReasoningMode ||
    (serviceTierOptions.length > 0 && displayedServiceTierLabel !== undefined) ||
    switchTier !== undefined ? (
      <div className="space-y-2">
        {showThinkingSwitch ? (
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
        {showReasoningEffort ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{t("app.modelPickerReasoningEffort")}</Label>
            <Select
              value={displayedEffort}
              onValueChange={(value) => {
                onReasoningEffortChange(modelRef, value as DesktopModelReasoningEffort);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>
                  {effortOptions.find((option) => option.value === displayedEffort)?.label ??
                    displayedEffort}
                </SelectValue>
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
                  <SelectItem key={option} value={option}>
                    {t(serviceTierValueLabelKey(option))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {switchTier !== undefined ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-tier-switch-${model.name}`}>
              {t(serviceTierValueLabelKey(switchTier))}
            </Label>
            <Switch
              id={`model-tier-switch-${model.name}`}
              checked={displayedServiceTier === switchTier}
              onCheckedChange={(checked) => {
                handleServiceTierChange(checked ? switchTier : undefined);
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
