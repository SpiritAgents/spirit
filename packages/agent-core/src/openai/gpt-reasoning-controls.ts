import type { ModelReasoningEffortContext, ModelReasoningProvider } from "../reasoning-effort.js";

export type ModelReasoningMode = "standard" | "pro";

const OPENAI_GPT56_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export type OpenAiGpt56ReasoningEffort = (typeof OPENAI_GPT56_REASONING_EFFORTS)[number];

const OPENAI_GPT56_ROUTED_PROVIDERS = new Set<ModelReasoningProvider>([
  "openai",
  "azure",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "openrouter",
]);

/** Renderer-safe: do not import from responses-compat, to avoid pulling the AI SDK dependency chain into the Desktop frontend. */
function normalizeGatewayOpenAiModelId(model: string): string | undefined {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  const prefix = "openai/";
  if (!lower.startsWith(prefix)) {
    return undefined;
  }

  return trimmed.slice(prefix.length).trim();
}

/** Renderer-safe: aligned with the apply-patch-eligibility logic; an independent copy avoids transitive import dependencies. */
function parseOpenAiGptModelVersion(modelId: string): { major: number; minor: number } | undefined {
  const trimmed = modelId.trim().toLowerCase();
  const bedrockMantle = /^openai\.(gpt-\d+(?:\.\d+)?)/.exec(trimmed);
  if (bedrockMantle?.[1]) {
    return parseOpenAiGptModelVersion(bedrockMantle[1]);
  }

  const versioned = /^gpt-(\d+)\.(\d+)/.exec(trimmed);
  if (versioned) {
    return {
      major: Number.parseInt(versioned[1] ?? "", 10),
      minor: Number.parseInt(versioned[2] ?? "", 10),
    };
  }

  const majorOnly = /^gpt-(\d+)(?:$|[-_])/.exec(trimmed);
  if (majorOnly) {
    return {
      major: Number.parseInt(majorOnly[1] ?? "", 10),
      minor: 0,
    };
  }

  return undefined;
}

function resolveOpenAiModelIdForVersionCheck(modelId: string): string {
  const trimmed = modelId.trim();
  const gatewayId = normalizeGatewayOpenAiModelId(trimmed);
  if (gatewayId) {
    return gatewayId;
  }

  const lower = trimmed.toLowerCase();
  const openrouterPrefix = "openai/";
  if (lower.startsWith(openrouterPrefix)) {
    return trimmed.slice(openrouterPrefix.length).trim();
  }

  return trimmed;
}

export function isOpenAiGpt56OrLaterModel(modelId: string): boolean {
  const version = parseOpenAiGptModelVersion(resolveOpenAiModelIdForVersionCheck(modelId));
  if (!version) {
    return false;
  }

  if (version.major > 5) {
    return true;
  }

  return version.major === 5 && version.minor >= 6;
}

/** GPT-6 Astra rejects `reasoning.effort` value `none`. */
export function isOpenAiGpt6AstraModel(modelId: string): boolean {
  const resolved = resolveOpenAiModelIdForVersionCheck(modelId).trim().toLowerCase();
  return /^gpt-6-astra(?:$|[-_])/.test(resolved);
}

export function openAiGpt56SupportedReasoningEfforts(
  modelId?: string,
): readonly OpenAiGpt56ReasoningEffort[] {
  if (modelId && isOpenAiGpt6AstraModel(modelId)) {
    return OPENAI_GPT56_REASONING_EFFORTS.filter((effort) => effort !== "none");
  }

  return OPENAI_GPT56_REASONING_EFFORTS;
}

function isOpenAiGpt56RoutedProvider(provider: ModelReasoningProvider | undefined): boolean {
  return provider !== undefined && OPENAI_GPT56_ROUTED_PROVIDERS.has(provider);
}

export function modelSupportsOpenAiGpt56ReasoningControls(
  context?: Pick<ModelReasoningEffortContext, "provider" | "model">,
): boolean {
  const model = context?.model?.trim();
  if (!model || !isOpenAiGpt56RoutedProvider(context?.provider)) {
    return false;
  }

  return isOpenAiGpt56OrLaterModel(model);
}

export function modelSupportsReasoningModeControl(
  context?: Pick<ModelReasoningEffortContext, "provider" | "model">,
): boolean {
  return modelSupportsOpenAiGpt56ReasoningControls(context);
}

export function normalizeModelReasoningMode(value: unknown): ModelReasoningMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === "standard" || trimmed === "pro") {
    return trimmed;
  }

  return undefined;
}

export function resolveModelReasoningMode(
  value: unknown,
  context?: Pick<ModelReasoningEffortContext, "provider" | "model">,
): ModelReasoningMode {
  if (!modelSupportsOpenAiGpt56ReasoningControls(context)) {
    return "standard";
  }

  return normalizeModelReasoningMode(value) ?? "standard";
}

export function resolveOpenAiTransportReasoningModeForContext(
  value: unknown,
  context?: Pick<ModelReasoningEffortContext, "provider" | "model">,
): ModelReasoningMode | undefined {
  const mode = resolveModelReasoningMode(value, context);
  return mode === "pro" ? "pro" : undefined;
}
