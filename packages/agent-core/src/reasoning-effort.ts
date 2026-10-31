/**
 * Shared reasoning vocabulary for config declarations (`reasoningEffort` /
 * `supportedReasoningEfforts` / `reasoningMode` / `supportedReasoningModes`).
 *
 * The runtime holds no per-provider normalization tables: a declared selection passes
 * verbatim to the wire, `"default"` / absent means "send no reasoning parameter", and
 * `supportedReasoningEfforts` (validated at config load) is the only picker/validation
 * source. Catalog data quality is the only defense line.
 */

export type ModelReasoningEffort = string;

export type ModelReasoningMode = "standard" | "pro";

/** `supportsThinkingType: "only"`: thinking is always on with no switch (UI hides the toggle). */
export type ModelSupportsThinkingType = "only";

/** Public reasoning effort tier tokens; the config schema validates declarations against this set. */
export const MODEL_REASONING_EFFORT_TOKENS = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const MODEL_REASONING_EFFORT_TOKEN_SET: ReadonlySet<string> = new Set(
  MODEL_REASONING_EFFORT_TOKENS,
);

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return MODEL_REASONING_EFFORT_TOKEN_SET.has(trimmed) ? trimmed : undefined;
}

export function normalizeModelReasoningMode(value: unknown): ModelReasoningMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === "standard" || trimmed === "pro" ? trimmed : undefined;
}

/** Declared reasoning effort to send on the wire; `"default"` / absent / unknown sends nothing. */
export function resolveDeclaredReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  const normalized = normalizeModelReasoningEffort(value);
  return normalized === undefined || normalized === "default" ? undefined : normalized;
}

/** Declared reasoning mode to send on the wire; only `"pro"` is sent, `"standard"` / absent sends nothing. */
export function resolveDeclaredReasoningMode(value: unknown): ModelReasoningMode | undefined {
  return normalizeModelReasoningMode(value) === "pro" ? "pro" : undefined;
}
