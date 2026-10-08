import { isOpenAiGpt6AstraModel } from "./openai/gpt-reasoning-controls.js";
import type { ModelReasoningProvider, ModelReasoningTransportKind } from "./reasoning-effort.js";

/**
 * Canonical per-model service tier preference stored in the host config (`serviceTier`).
 * Routes whose native protocol speaks Fast (OpenAI `service_tier: "fast"`, Anthropic native
 * `speed: "fast"`) persist `fast`; routes whose upstream tier is priority-processing
 * (SpaceXAI `xai`, Google, and aggregator rows to non-OpenAI upstreams) persist `priority`.
 */
export type ModelServiceTier = "auto" | "default" | "flex" | "fast" | "priority" | "ultrafast";

export const MODEL_SERVICE_TIERS: readonly ModelServiceTier[] = [
  "auto",
  "default",
  "flex",
  "fast",
  "priority",
  "ultrafast",
];

/**
 * Upstream provider identity behind an aggregator route (Vercel AI Gateway / OpenRouter).
 * Sourced from catalog facts (Vercel `owned_by`, OpenRouter `canonical_slug` author prefix)
 * with a known model-ID prefix fallback when the catalog fact is missing.
 */
export type ServiceTierUpstreamProvider = "openai" | "anthropic" | "google" | "xai";

export interface ModelServiceTierContext {
  /** Host provider id (aligned with `ModelProviderId` / transport `llmVendor`). */
  provider?: ModelReasoningProvider;
  /** Model id as configured; aggregator routes may carry an `upstream/` prefix. */
  model?: string;
  transportKind?: ModelReasoningTransportKind;
  /** Catalog-provided upstream identity fact; authoritative when present. */
  upstreamProvider?: string;
  /** Vertex AI location; Flex/Priority are gated to the global endpoint. */
  vertexLocation?: string;
}

/** Raised when a stored `serviceTier` value is unknown or unsupported for the provider/model. */
export class ModelServiceTierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelServiceTierConfigError";
  }
}

export function normalizeModelServiceTier(value: unknown): ModelServiceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return (MODEL_SERVICE_TIERS as readonly string[]).includes(trimmed)
    ? (trimmed as ModelServiceTier)
    : undefined;
}

const UPSTREAM_PROVIDER_ALIASES: Readonly<Record<string, ServiceTierUpstreamProvider>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  // OpenRouter uses the `x-ai` author prefix for xAI models.
  "x-ai": "xai",
  // Vercel AI Gateway routes xAI models under the `spacexai` prefix / `owned_by` fact.
  spacexai: "xai",
};

export function normalizeServiceTierUpstreamProvider(
  value: unknown,
): ServiceTierUpstreamProvider | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return UPSTREAM_PROVIDER_ALIASES[value.trim().toLowerCase()];
}

function parseModelIdUpstreamProvider(
  model: string | undefined,
): ServiceTierUpstreamProvider | undefined {
  const trimmed = model?.trim() ?? "";
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }
  return normalizeServiceTierUpstreamProvider(trimmed.slice(0, slashIndex));
}

/**
 * Aggregator upstream identity: a present catalog fact is authoritative (an unrecognized fact
 * means "known but unsupported" and hides the control); the model-ID prefix is parsed only
 * when the catalog fact is absent. Unknown identity yields `undefined` (no options).
 */
export function resolveServiceTierUpstreamProvider(
  context: Pick<ModelServiceTierContext, "upstreamProvider" | "model">,
): ServiceTierUpstreamProvider | undefined {
  if (typeof context.upstreamProvider === "string" && context.upstreamProvider.trim() !== "") {
    return normalizeServiceTierUpstreamProvider(context.upstreamProvider);
  }
  return parseModelIdUpstreamProvider(context.model);
}

/** Vertex AI Flex/Priority are available only on the global endpoint. */
export function isVertexGlobalServiceTierEndpoint(vertexLocation: string | undefined): boolean {
  return vertexLocation?.trim().toLowerCase() === "global";
}

/**
 * Anthropic's native Fast mode is limited to current Claude Opus models (4.8 / 5 / 5.5).
 * Matches exact model families with a boundary so other Opus generations are not let through.
 */
const ANTHROPIC_NATIVE_FAST_MODEL_ID = /^claude-opus-(?:4-8|5)(?:$|[-_.])/;

export function isAnthropicNativeFastModel(model: string | undefined): boolean {
  if (model === undefined) {
    return false;
  }
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, "")
    .replace(/(\d)\.(\d)/g, "$1-$2");
  return ANTHROPIC_NATIVE_FAST_MODEL_ID.test(normalized);
}

/**
 * The native Anthropic Fast toggle exists only for the direct Anthropic provider; aggregator-routed
 * Claude models never get it (OpenRouter maps its own `fast` service tier instead).
 */
export function modelSupportsAnthropicNativeFast(
  context?: Pick<ModelServiceTierContext, "provider" | "model">,
): boolean {
  return context?.provider === "anthropic" && isAnthropicNativeFastModel(context.model);
}

function withAstraUltrafast(
  context: ModelServiceTierContext | undefined,
  values: readonly ModelServiceTier[],
): ModelServiceTier[] {
  const options = [...values];
  if (isOpenAiGpt6AstraModel(context?.model ?? "")) {
    options.push("ultrafast");
  }
  return options;
}

/**
 * Service tier options offered for the model, per the provider/upstream capability matrix.
 * An empty list means the Service Tier control is hidden. Anthropic's native Fast is a
 * separate toggle (`modelSupportsAnthropicNativeFast`), not part of this list.
 * Labels are not attached: renderers localize values via their own i18n (Desktop maps them to
 * `app.modelPickerServiceTierValues.*`).
 */
export function modelServiceTierOptions(
  context?: ModelServiceTierContext,
): readonly ModelServiceTier[] {
  const provider = context?.provider;
  switch (provider) {
    case "openai":
      return withAstraUltrafast(context, ["auto", "default", "flex", "fast"]);
    case "xai":
      return ["default", "priority"];
    case "google":
      return ["default", "flex", "priority"];
    case "google-vertex-ai":
      return isVertexGlobalServiceTierEndpoint(context?.vertexLocation)
        ? ["default", "flex", "priority"]
        : [];
    case "vercel-ai-gateway": {
      const upstream = resolveServiceTierUpstreamProvider(context ?? {});
      if (upstream === "openai") {
        return withAstraUltrafast(context, ["default", "flex", "fast"]);
      }
      if (upstream === "google") {
        return ["default", "flex", "priority"];
      }
      if (upstream === "xai") {
        return ["default", "priority"];
      }
      return [];
    }
    case "openrouter": {
      const upstream = resolveServiceTierUpstreamProvider(context ?? {});
      if (upstream === "openai") {
        return withAstraUltrafast(context, ["default", "flex", "fast"]);
      }
      if (upstream === "google") {
        return ["default", "flex", "priority"];
      }
      if (upstream === "anthropic" || upstream === "xai") {
        return ["default", "priority"];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Whether the inspector shows any service tier affordance (dropdown or tier switch). */
export function modelShowsServiceTierControl(context?: ModelServiceTierContext): boolean {
  return modelServiceTierControlKind(context) !== "none";
}

export type ModelServiceTierControlKind = "select" | "fast-switch" | "priority-switch" | "none";

/**
 * Inspector presentation for the service tier capability. A binary Default-plus-one-tier choice —
 * direct Anthropic native Fast, and rows offering exactly Default/Priority (direct SpaceXAI and
 * aggregator xAI/Anthropic routes) — renders as a switch named by the non-default tier. Rows with
 * three or more options (Flex present, or Auto for OpenAI) keep the Service Tier dropdown.
 */
export function modelServiceTierControlKind(
  context?: ModelServiceTierContext,
): ModelServiceTierControlKind {
  if (modelSupportsAnthropicNativeFast(context)) {
    return "fast-switch";
  }
  const options = modelServiceTierOptions(context);
  if (options.length === 0) {
    return "none";
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

/** Effective tier when the preference is unset: OpenAI defaults to Auto, other matrix providers to Default. */
export function defaultModelServiceTier(
  context?: ModelServiceTierContext,
): ModelServiceTier | undefined {
  if (context?.provider === "openai") {
    return "auto";
  }
  if (modelServiceTierOptions(context).length > 0) {
    return "default";
  }
  return undefined;
}

/**
 * Displayed tier for the picker: the configured value when offered, otherwise the provider default.
 * Anthropic Fast resolves to `undefined` (off) unless `fast` is stored. Invalid stored values are a
 * config error surfaced by `parseModelServiceTierConfig`; this function only drives display.
 */
export function resolveEffectiveModelServiceTier(
  configured: ModelServiceTier | undefined,
  context?: ModelServiceTierContext,
): ModelServiceTier | undefined {
  if (modelSupportsAnthropicNativeFast(context)) {
    return configured === "fast" ? "fast" : undefined;
  }
  const options = modelServiceTierOptions(context);
  if (options.length === 0) {
    return undefined;
  }
  if (configured !== undefined && options.includes(configured)) {
    return configured;
  }
  return defaultModelServiceTier(context);
}

function describeServiceTierContext(context: ModelServiceTierContext | undefined): string {
  const provider = context?.provider ?? "unknown provider";
  const model = context?.model?.trim();
  return model ? `${provider} model ${model}` : provider;
}

/**
 * Single validation entry for a stored `serviceTier` value; hosts reuse this instead of copying
 * the capability matrix. Returns the tier when supported, `undefined` when unset, and throws
 * `ModelServiceTierConfigError` on unknown or unsupported values (never silently rewrites).
 */
export function parseModelServiceTierConfig(
  value: unknown,
  context?: ModelServiceTierContext,
): ModelServiceTier | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const tier = normalizeModelServiceTier(value);
  const target = describeServiceTierContext(context);
  if (tier === undefined) {
    throw new ModelServiceTierConfigError(
      `Unknown service tier ${JSON.stringify(value)} for ${target}; expected one of ${MODEL_SERVICE_TIERS.join(", ")}.`,
    );
  }
  if (modelSupportsAnthropicNativeFast(context)) {
    if (tier === "fast") {
      return tier;
    }
    throw new ModelServiceTierConfigError(
      `Service tier "${tier}" is not supported for ${target}; Anthropic native Fast is the only service tier preference here.`,
    );
  }
  const options = modelServiceTierOptions(context);
  if (options.length === 0) {
    throw new ModelServiceTierConfigError(
      `Service tier "${tier}" is not configurable for ${target}; this provider or route does not expose service tier options.`,
    );
  }
  if (!options.includes(tier)) {
    throw new ModelServiceTierConfigError(
      `Service tier "${tier}" is not available for ${target}; supported values: ${options.join(", ")}.`,
    );
  }
  return tier;
}

/**
 * Tiers that get a gray trigger suffix on the picker button (appended after mode/effort markers):
 * Fast, Ultrafast, Flex, and Priority; Auto and Default add nothing. Returns the tier to mark —
 * the renderer localizes it (Desktop maps it to `app.modelPickerServiceTierValues.*`).
 */
export function modelServiceTierTriggerTier(
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
