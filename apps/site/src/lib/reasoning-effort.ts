import type {
  DesktopModelEffortSelection,
  DesktopModelReasoningEffort,
  ModelProfileSnapshot,
} from "@/types/spirit-desktop";

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function modelEffortLabel(effort: DesktopModelEffortSelection | undefined): string {
  if (effort === undefined || effort === "default") {
    return "Default";
  }
  return EFFORT_LABELS[effort] ?? effort;
}

export function modelReasoningEffortLabel(effort: DesktopModelReasoningEffort | undefined): string {
  return modelEffortLabel(effort);
}

export function modelReasoningEffortOptions(_input: {
  provider?: string;
  model?: string;
  supportedEfforts?: DesktopModelReasoningEffort[];
  transportKind?: string;
}): Array<{ value: DesktopModelReasoningEffort; label: string }> {
  return [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
}

export function modelEffortOptions(
  model: ModelProfileSnapshot,
): Array<{ value: DesktopModelEffortSelection; label: string }> {
  if (model.effortSemantics !== "output") {
    return modelReasoningEffortOptions({
      provider: model.provider,
      model: model.name,
      ...(model.supportedReasoningEfforts !== undefined
        ? { supportedEfforts: model.supportedReasoningEfforts }
        : {}),
      transportKind: model.transportKind,
    });
  }
  const declared = model.supportedEfforts ?? [];
  if (declared.length === 0) {
    return [];
  }
  return [
    { value: "default", label: modelEffortLabel("default") },
    ...declared.map((effort) => ({ value: effort, label: modelEffortLabel(effort) })),
  ];
}

export function configuredModelEffort(
  model: ModelProfileSnapshot,
): DesktopModelEffortSelection | undefined {
  return model.effortSemantics === "output" ? model.effort : model.reasoningEffort;
}
