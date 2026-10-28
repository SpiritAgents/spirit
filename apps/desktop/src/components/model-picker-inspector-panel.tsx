import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

import { ModelCatalogDetailPanel } from "@/components/model-catalog-detail-panel";
import { modelCatalogHasDetailBody } from "@/lib/model-catalog-detail";
import {
  declaredEffortOptions,
  declaredServiceTierControlKind,
  declaredServiceTierMaxInputTokens,
  declaredServiceTierOptions,
  effectiveDeclaredServiceTier,
  isDeclaredServiceTierAvailable,
  effectiveReasoningMode,
  effectiveThinkingEnabled,
  modelEffortControlLabelKind,
  selectedModelEffort,
  showsEffortControl,
  showsReasoningModeControl,
  showsServiceTierControl,
  showsThinkingAlwaysOnHint,
  showsThinkingSwitchControl,
  thinkingSwitchForcedOn,
} from "@/lib/model-picker-controls";
import { serviceTierValueLabelKey } from "@/lib/model-service-tier-context";
import { formatCompactTokenCount } from "@/lib/format-compact-token-count";
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
  DesktopModelEffortSelection,
  DesktopModelReasoningMode,
  ModelProfileSnapshot,
  ModelRef,
  PreviewModelCatalogEntry,
} from "@/types";

function modelInspectorRef(model: ModelProfileSnapshot): ModelRef {
  return model.ref;
}

function formatServiceTierInputLimit(value: number): string {
  return value >= 1024 ? `${formatCompactTokenCount(value / 1024)}K` : String(value);
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
  if (showsThinkingSwitchControl(model) || showsThinkingAlwaysOnHint(model)) {
    return true;
  }
  if (showsReasoningModeControl(model)) {
    return true;
  }
  return showsEffortControl(model);
}

type ModelPickerInspectorPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  density?: "default" | "list";
  /** Last upstream-measured conversation input tokens; absent means unknown. */
  lastInputTokens?: number;
  onEffortChange: (modelRef: ModelRef, effort: DesktopModelEffortSelection) => void;
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
  lastInputTokens,
  onEffortChange,
  onReasoningModeChange,
  onThinkingEnabledChange,
  onServiceTierChange,
}: ModelPickerInspectorPanelProps) {
  const { t } = useTranslation();
  const isList = density === "list";
  const modelRef = modelInspectorRef(model);
  const showThinkingSwitch =
    onThinkingEnabledChange !== undefined && showsThinkingSwitchControl(model);
  const showThinkingAlwaysOn = showsThinkingAlwaysOnHint(model);
  const thinkingForcedOn = thinkingSwitchForcedOn(model);
  const [pendingThinkingEnabled, setPendingThinkingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setPendingThinkingEnabled(null);
  }, [model.name, model.thinkingEnabled, model.effort]);
  const thinkingEnabled = pendingThinkingEnabled ?? effectiveThinkingEnabled(model);
  const showEffort = showsEffortControl(model);
  const effortOptions = declaredEffortOptions(model);
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
  }, [model.name, model.serviceTier, lastInputTokens]);
  const effectiveServiceTier = effectiveDeclaredServiceTier(model, catalogEntry, lastInputTokens);
  const displayedServiceTier = pendingServiceTier ? pendingServiceTier.value : effectiveServiceTier;
  const displayedServiceTierLabel =
    displayedServiceTier !== undefined && serviceTierOptions.includes(displayedServiceTier)
      ? t(serviceTierValueLabelKey(displayedServiceTier))
      : undefined;
  const serviceTierAvailable = (tier: ModelServiceTier) =>
    isDeclaredServiceTierAvailable(model, tier, catalogEntry, lastInputTokens);
  const limitedUnavailableTier = [...serviceTierOptions, ...(switchTier ? [switchTier] : [])].find(
    (tier) =>
      !serviceTierAvailable(tier) &&
      declaredServiceTierMaxInputTokens(model, tier, catalogEntry) !== undefined,
  );
  const serviceTierLimitMessage = limitedUnavailableTier
    ? t("app.modelPickerServiceTierInputLimit", {
        tier: t(serviceTierValueLabelKey(limitedUnavailableTier)),
        tokens: formatServiceTierInputLimit(
          declaredServiceTierMaxInputTokens(model, limitedUnavailableTier, catalogEntry)!,
        ),
      })
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
  const displayedEffort = selectedModelEffort(model);
  const labelClass = isList ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : "text-xs text-muted-foreground";
  const selectTriggerClass = cn(isList ? "h-7" : "h-8", DESKTOP_GHOST_SELECT_TRIGGER);

  const modelControls =
    showThinkingSwitch ||
    showThinkingAlwaysOn ||
    showEffort ||
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
              disabled={thinkingForcedOn}
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
        {thinkingForcedOn ? (
          <p className="text-xs text-muted-foreground">
            {t("app.modelPickerThinkingRequiredForEffort")}
          </p>
        ) : null}
        {showThinkingAlwaysOn ? (
          <p className="text-xs text-muted-foreground">{t("app.modelPickerThinkingAlwaysOn")}</p>
        ) : null}
        {showEffort ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>
              {t(
                modelEffortControlLabelKind(model) === "effort"
                  ? "app.modelPickerEffort"
                  : "app.modelPickerReasoningEffort",
              )}
            </Label>
            <Select
              value={displayedEffort}
              onValueChange={(value) => {
                onEffortChange(modelRef, value as DesktopModelEffortSelection);
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
                  <SelectItem key={option} value={option} disabled={!serviceTierAvailable(option)}>
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
              disabled={!serviceTierAvailable(switchTier)}
              onCheckedChange={(checked) => {
                handleServiceTierChange(checked ? switchTier : undefined);
              }}
            />
          </div>
        ) : null}
        {serviceTierLimitMessage ? (
          <p className="text-xs text-muted-foreground">{serviceTierLimitMessage}</p>
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
