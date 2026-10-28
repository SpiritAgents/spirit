import {
  isServiceTierAvailableForInputTokens,
  resolveEffectiveServiceTier,
  serviceTierMaxInputTokens,
  type ModelServiceTier,
} from "@spiritagent/agent-core/model-service-tier";
import { resolveThinkingSwitchState } from "@spiritagent/agent-core/thinking-switch";

import type {
  DesktopModelEffortSelection,
  DesktopModelReasoningMode,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from "@/types";

/** Catalog metadata fallback for a model whose entry has not been refreshed with tiers yet. */
type ServiceTierCatalogEntry = Pick<PreviewModelCatalogEntry, "serviceTiers"> | undefined;

/** Picker controls come only from effective model declarations, never provider or model-name inference. */
type DeclaredControlModel = Pick<
  ModelProfileSnapshot,
  | "supportedReasoningEfforts"
  | "supportedReasoningModes"
  | "serviceTiers"
  | "serviceTier"
  | "reasoningEffort"
  | "reasoningMode"
  | "effortSemantics"
  | "effort"
  | "supportedEfforts"
  | "supportsThinkingSwitch"
  | "supportsThinkingType"
  | "thinkingEnabled"
  | "thinkingSwitch"
>;

/** The thinking toggle shows only when the model declares the switch; `only` means always-on (hidden). */
export function showsThinkingSwitchControl(model: DeclaredControlModel): boolean {
  return model.supportsThinkingSwitch === true && model.supportsThinkingType !== "only";
}

export function showsThinkingAlwaysOnHint(model: DeclaredControlModel): boolean {
  return model.effortSemantics === "output" && model.supportsThinkingType === "only";
}

export function effectiveThinkingEnabled(model: DeclaredControlModel): boolean {
  return (
    resolveThinkingSwitchState({
      ...(model.thinkingEnabled !== undefined
        ? { vendorExtendedThinking: model.thinkingEnabled }
        : {}),
      ...(model.thinkingSwitch !== undefined ? { thinkingSwitch: model.thinkingSwitch } : {}),
      ...(model.effortSemantics === "output" && model.effort !== undefined
        ? { effort: model.effort }
        : {}),
    }) === "on"
  );
}

export function thinkingSwitchForcedOn(model: DeclaredControlModel): boolean {
  const preferredOff =
    model.thinkingEnabled === false ||
    (model.thinkingEnabled === undefined && model.thinkingSwitch?.defaultState === "off");
  return model.effortSemantics === "output" && preferredOff && effectiveThinkingEnabled(model);
}

export type ModelEffortOption = { value: DesktopModelEffortSelection; label: string };

const EFFORT_OPTION_LABELS: Record<string, string> = {
  default: "Default",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function modelEffortOptionLabel(value: string): string {
  return EFFORT_OPTION_LABELS[value] ?? value;
}

export function modelEffortControlLabelKind(
  model: Pick<DeclaredControlModel, "effortSemantics">,
): "effort" | "reasoningEffort" {
  return model.effortSemantics === "output" ? "effort" : "reasoningEffort";
}

export function configuredModelEffort(
  model: DeclaredControlModel,
): DesktopModelEffortSelection | undefined {
  return model.effortSemantics === "output" ? model.effort : model.reasoningEffort;
}

export function selectedModelEffort(model: DeclaredControlModel): DesktopModelEffortSelection {
  return configuredModelEffort(model) ?? "default";
}

export function modelEffortPreference(
  model: Pick<DeclaredControlModel, "effortSemantics">,
  effort: DesktopModelEffortSelection | undefined,
): Pick<ModelProfileSnapshot, "effort" | "reasoningEffort"> {
  if (effort === undefined) {
    return {};
  }
  return model.effortSemantics === "output"
    ? { effort: effort as NonNullable<ModelProfileSnapshot["effort"]> }
    : { reasoningEffort: effort as NonNullable<ModelProfileSnapshot["reasoningEffort"]> };
}

/** Declared effort options for the picker, with the wire-neutral Default row first. */
export function declaredEffortOptions(model: DeclaredControlModel): ModelEffortOption[] {
  const output = model.effortSemantics === "output";
  const declared: readonly DesktopModelEffortSelection[] = output
    ? (model.supportedEfforts ?? [])
    : (model.supportedReasoningEfforts ?? []);
  if (declared.length === 0) {
    return [];
  }
  const defaultLabel = EFFORT_OPTION_LABELS["default"]!;
  return [
    { value: "default", label: defaultLabel },
    ...declared.map((value) => ({ value, label: modelEffortOptionLabel(value) })),
  ];
}

export function showsEffortControl(model: DeclaredControlModel): boolean {
  return declaredEffortOptions(model).length > 1;
}

export function modelEffortTriggerLabel(
  model: DeclaredControlModel,
  selection?: DesktopModelEffortSelection,
): string | undefined {
  if (!showsEffortControl(model)) {
    return undefined;
  }
  const selected = selection ?? selectedModelEffort(model);
  if (model.effortSemantics === "output") {
    return declaredEffortOptions(model).find((option) => option.value === selected)?.label;
  }
  return selected !== "default" ? modelEffortOptionLabel(selected) : undefined;
}

/** `standard` or absent sends nothing on the wire; the control needs a declared `pro` option. */
export function showsReasoningModeControl(model: DeclaredControlModel): boolean {
  return (model.supportedReasoningModes ?? []).includes("pro");
}

export function effectiveReasoningMode(model: DeclaredControlModel): DesktopModelReasoningMode {
  return model.reasoningMode === "pro" && showsReasoningModeControl(model) ? "pro" : "standard";
}

/** Declared service tier options: the simple list form, or the literal map's keys. */
export function declaredServiceTierOptions(
  model: DeclaredControlModel,
  catalogEntry?: ServiceTierCatalogEntry,
): ModelServiceTier[] {
  const tiers = model.serviceTiers ?? catalogEntry?.serviceTiers;
  if (!tiers) {
    return [];
  }
  return Array.isArray(tiers) ? [...tiers] : (Object.keys(tiers) as ModelServiceTier[]);
}

export type DeclaredServiceTierControlKind = "select" | "fast-switch" | "priority-switch" | "none";

/**
 * A binary Default-plus-one-tier choice renders as a switch named by the non-default tier;
 * anything with three or more options (or a single non-default tier) keeps the dropdown.
 */
export function declaredServiceTierControlKind(
  model: DeclaredControlModel,
  catalogEntry?: ServiceTierCatalogEntry,
): DeclaredServiceTierControlKind {
  const options = declaredServiceTierOptions(model, catalogEntry);
  if (options.length === 0) {
    return "none";
  }
  // A lone non-default tier (literal map form, e.g. Anthropic native Fast) renders as a switch.
  if (options.length === 1 && (options[0] === "fast" || options[0] === "priority")) {
    return options[0] === "fast" ? "fast-switch" : "priority-switch";
  }
  if (options.length === 2 && options[0] === "default") {
    if (options[1] === "fast") {
      return "fast-switch";
    }
    if (options[1] === "priority") {
      return "priority-switch";
    }
  }
  return "select";
}

export function showsServiceTierControl(
  model: DeclaredControlModel,
  catalogEntry?: ServiceTierCatalogEntry,
): boolean {
  return declaredServiceTierControlKind(model, catalogEntry) !== "none";
}

export function declaredServiceTierMaxInputTokens(
  model: DeclaredControlModel,
  tier: ModelServiceTier,
  catalogEntry?: ServiceTierCatalogEntry,
): number | undefined {
  return serviceTierMaxInputTokens(model.serviceTiers ?? catalogEntry?.serviceTiers, tier);
}

export function isDeclaredServiceTierAvailable(
  model: DeclaredControlModel,
  tier: ModelServiceTier,
  catalogEntry?: ServiceTierCatalogEntry,
  lastInputTokens?: number,
): boolean {
  return isServiceTierAvailableForInputTokens(
    model.serviceTiers ?? catalogEntry?.serviceTiers,
    tier,
    lastInputTokens,
  );
}

/** Displayed effective tier: the declared preference, or `default` when a limit makes it unavailable. */
export function effectiveDeclaredServiceTier(
  model: DeclaredControlModel,
  catalogEntry?: ServiceTierCatalogEntry,
  lastInputTokens?: number,
): ModelServiceTier | undefined {
  const options = declaredServiceTierOptions(model, catalogEntry);
  if (options.length === 0) {
    return undefined;
  }
  const preferred =
    model.serviceTier !== undefined && options.includes(model.serviceTier)
      ? model.serviceTier
      : options.includes("default")
        ? "default"
        : undefined;
  if (preferred === undefined) {
    return undefined;
  }
  return resolveEffectiveServiceTier({
    serviceTier: preferred,
    serviceTiers: model.serviceTiers ?? catalogEntry?.serviceTiers,
    ...(lastInputTokens !== undefined ? { lastInputTokens } : {}),
  });
}

/** Tiers that get a gray trigger suffix on the picker button; `auto`/`default` add nothing. */
export function serviceTierTriggerSuffixTier(
  tier: ModelServiceTier | undefined,
): ModelServiceTier | undefined {
  switch (tier) {
    case "fast":
    case "flex":
    case "priority":
    case "ultrafast":
      return tier;
    default:
      return undefined;
  }
}
