import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

import type {
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from "@/types";

/** Catalog metadata fallback for a model whose entry has not been refreshed with tiers yet. */
type ServiceTierCatalogEntry = Pick<PreviewModelCatalogEntry, "serviceTiers"> | undefined;

/**
 * Picker controls are declaration-driven (spec: `supportedReasoningEfforts` /
 * `supportedReasoningModes` / `serviceTiers` on the effective model entry are the only source);
 * absent declarations hide the control — no provider or model-name inference.
 */
type DeclaredControlModel = Pick<
  ModelProfileSnapshot,
  | "supportedReasoningEfforts"
  | "supportedReasoningModes"
  | "serviceTiers"
  | "serviceTier"
  | "reasoningEffort"
  | "reasoningMode"
>;

export type ReasoningEffortOption = { value: DesktopModelReasoningEffort; label: string };

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

export function reasoningEffortOptionLabel(value: string): string {
  return EFFORT_OPTION_LABELS[value] ?? value;
}

/** Declared effort options for the picker, with the wire-neutral Default row first. */
export function declaredReasoningEffortOptions(
  model: DeclaredControlModel,
): ReasoningEffortOption[] {
  const declared = model.supportedReasoningEfforts ?? [];
  if (declared.length === 0) {
    return [];
  }
  return [
    { value: "default", label: EFFORT_OPTION_LABELS["default"]! },
    ...declared.map((value) => ({ value, label: reasoningEffortOptionLabel(value) })),
  ];
}

export function showsReasoningEffortControl(model: DeclaredControlModel): boolean {
  return declaredReasoningEffortOptions(model).length > 1;
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

/** Displayed tier: the configured value when declared; otherwise the neutral `default` when declared. */
export function effectiveDeclaredServiceTier(
  model: DeclaredControlModel,
  catalogEntry?: ServiceTierCatalogEntry,
): ModelServiceTier | undefined {
  const options = declaredServiceTierOptions(model, catalogEntry);
  if (options.length === 0) {
    return undefined;
  }
  if (model.serviceTier !== undefined && options.includes(model.serviceTier)) {
    return model.serviceTier;
  }
  return options.includes("default") ? "default" : undefined;
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
