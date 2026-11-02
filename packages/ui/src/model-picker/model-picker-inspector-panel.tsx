import { useEffect, useState } from "react";

import { ModelCatalogDetailPanel } from "./model-catalog-detail-panel.js";
import { modelCatalogHasDetailBody } from "./model-catalog-detail.js";
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
  showsThinkingSwitchControl,
  thinkingSwitchForcedOn,
} from "./model-picker-controls.js";
import { useModelPickerLabels } from "./labels.js";
import { useModelPickerRuntime } from "./runtime.js";
import { formatCompactTokenCount } from "./format-compact-token-count.js";
import { Label } from "../label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select.js";
import { Switch } from "../switch.js";
import { cn } from "../cn.js";
import { DESKTOP_GHOST_SELECT_TRIGGER, DESKTOP_OVERLAY_LIST_DETAIL_LABEL } from "../chrome.js";
import type {
  ModelEffortSelection,
  ModelReasoningMode,
  ModelServiceTier,
  ModelPickerModelProfile,
  ModelRef,
  ModelCatalogEntry,
} from "./types.js";

function modelInspectorRef(model: ModelPickerModelProfile): ModelRef {
  return model.ref;
}

function formatServiceTierInputLimit(value: number): string {
  return value >= 1024 ? `${formatCompactTokenCount(value / 1024)}K` : String(value);
}

export function modelPickerInspectorNeedsWideLayout(
  model: ModelPickerModelProfile,
  catalogEntry?: ModelCatalogEntry,
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
  return showsEffortControl(model);
}

type ModelPickerInspectorPanelProps = {
  model: ModelPickerModelProfile;
  catalogEntry?: ModelCatalogEntry;
  providerLabel: string;
  density?: "default" | "list";
  /** Last upstream-measured conversation input tokens; absent means unknown. */
  lastInputTokens?: number;
  onEffortChange: (modelRef: ModelRef, effort: ModelEffortSelection) => void;
  onReasoningModeChange?: (modelRef: ModelRef, mode: ModelReasoningMode) => void;
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
  const labels = useModelPickerLabels();
  const runtime = useModelPickerRuntime();
  const isList = density === "list";
  const modelRef = modelInspectorRef(model);
  const showThinkingSwitch =
    onThinkingEnabledChange !== undefined && showsThinkingSwitchControl(model);
  const thinkingForcedOn = thinkingSwitchForcedOn(runtime, model);
  const [pendingThinkingEnabled, setPendingThinkingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setPendingThinkingEnabled(null);
  }, [model.name, model.thinkingEnabled, model.effort]);
  const thinkingEnabled = pendingThinkingEnabled ?? effectiveThinkingEnabled(runtime, model);
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
  const effectiveServiceTier = effectiveDeclaredServiceTier(
    runtime,
    model,
    catalogEntry,
    lastInputTokens,
  );
  const displayedServiceTier = pendingServiceTier ? pendingServiceTier.value : effectiveServiceTier;
  const displayedServiceTierLabel =
    displayedServiceTier !== undefined && serviceTierOptions.includes(displayedServiceTier)
      ? labels.serviceTierValue(displayedServiceTier)
      : undefined;
  const serviceTierAvailable = (tier: ModelServiceTier) =>
    isDeclaredServiceTierAvailable(runtime, model, tier, catalogEntry, lastInputTokens);
  const limitedUnavailableTier = [...serviceTierOptions, ...(switchTier ? [switchTier] : [])].find(
    (tier) =>
      !serviceTierAvailable(tier) &&
      declaredServiceTierMaxInputTokens(runtime, model, tier, catalogEntry) !== undefined,
  );
  const serviceTierLimitMessage = limitedUnavailableTier
    ? labels.serviceTierInputLimit({
        tierLabel: labels.serviceTierValue(limitedUnavailableTier),
        tokensLabel: formatServiceTierInputLimit(
          declaredServiceTierMaxInputTokens(runtime, model, limitedUnavailableTier, catalogEntry)!,
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
    showEffort ||
    showReasoningMode ||
    (serviceTierOptions.length > 0 && displayedServiceTierLabel !== undefined) ||
    switchTier !== undefined ? (
      <div className="space-y-2">
        {showThinkingSwitch ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-thinking-${model.name}`}>
              {labels.thinking}
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
          <p className="text-xs text-muted-foreground">{labels.thinkingRequiredForEffort}</p>
        ) : null}
        {showEffort ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>
              {modelEffortControlLabelKind(model) === "effort"
                ? labels.effort
                : labels.reasoningEffort}
            </Label>
            <Select
              value={displayedEffort}
              onValueChange={(value) => {
                onEffortChange(modelRef, value as ModelEffortSelection);
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
            <Label className={labelClass}>{labels.reasoningMode}</Label>
            <Select
              value={reasoningMode}
              onValueChange={(value) => {
                onReasoningModeChange?.(modelRef, value as ModelReasoningMode);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>
                  {reasoningMode === "pro" ? labels.reasoningModePro : labels.reasoningModeStandard}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[110]">
                <SelectItem value="standard">{labels.reasoningModeStandard}</SelectItem>
                <SelectItem value="pro">{labels.reasoningModePro}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {serviceTierOptions.length > 0 && displayedServiceTierLabel !== undefined ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{labels.serviceTier}</Label>
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
                    {labels.serviceTierValue(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {switchTier !== undefined ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-tier-switch-${model.name}`}>
              {labels.serviceTierValue(switchTier)}
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
