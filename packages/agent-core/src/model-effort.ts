export const MODEL_OUTPUT_EFFORT_TOKENS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ModelEffort = (typeof MODEL_OUTPUT_EFFORT_TOKENS)[number];
export type ModelEffortSelection = ModelEffort | "default";
export type EffortSemantics = "output";

const MODEL_OUTPUT_EFFORT_TOKEN_SET: ReadonlySet<string> = new Set(MODEL_OUTPUT_EFFORT_TOKENS);

export function normalizeModelEffort(value: unknown): ModelEffort | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return MODEL_OUTPUT_EFFORT_TOKEN_SET.has(normalized) ? (normalized as ModelEffort) : undefined;
}

export function normalizeModelEffortSelection(value: unknown): ModelEffortSelection | undefined {
  if (value === "default") {
    return value;
  }
  return normalizeModelEffort(value);
}
