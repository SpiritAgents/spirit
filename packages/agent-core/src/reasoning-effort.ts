import type { AnthropicTransportConfig } from "./anthropic/anthropic-compat.js";
import type { LlmTransportKind } from "./llm-provider-shared.js";
import {
  isGatewayAnthropicClaudeModel,
  resolveGatewayAnthropicClaudeCapabilities,
} from "./openai/gateway-anthropic-thinking.js";
import { parseGatewayUpstreamSlug } from "./openai/gateway-code-completion-thinking.js";
import { isXiaomiResponsesReasoningEffortContext } from "./openai/gateway-xiaomi-thinking.js";
import { isTokenHubReasoningEffortModel } from "./openai/tokenhub-reasoning-effort.js";
import { isMoonshotKimiK3Model } from "./openai/moonshot-thinking-switch.js";

export { isXiaomiResponsesReasoningEffortContext } from "./openai/gateway-xiaomi-thinking.js";
import {
  isGatewayGoogleGeminiModel,
  isGoogleGeminiMinimalThinkingLevelModel,
  isGoogleGeminiThinkingLevelModel,
} from "./openai/gateway-google-thinking.js";
import { isOpenRouterAnthropicClaudeModel } from "./openai/openrouter-anthropic-reasoning.js";
import {
  isRoutedAnthropicClaudeModel,
  resolveRoutedAnthropicClaudeCapabilities,
} from "./openai/routed-anthropic-claude-capabilities.js";
import type { OpenAiTransportConfig } from "./openai/openai-compat.js";
import {
  isOpenAiGpt6AstraModel,
  modelSupportsOpenAiGpt56ReasoningControls,
} from "./openai/gpt-reasoning-controls.js";

export {
  isOpenAiGpt56OrLaterModel,
  isOpenAiGpt6AstraModel,
  modelSupportsOpenAiGpt56ReasoningControls,
  modelSupportsReasoningModeControl,
  normalizeModelReasoningMode,
  openAiGpt56SupportedReasoningEfforts,
  resolveModelReasoningMode,
  resolveOpenAiTransportReasoningModeForContext,
  type ModelReasoningMode,
  type OpenAiGpt56ReasoningEffort,
} from "./openai/gpt-reasoning-controls.js";

export type ModelReasoningProvider =
  | "deepseek"
  | "xai"
  | "moonshot-ai"
  | "kimi-code"
  | "z-ai"
  | "zhipu-ai"
  | "minimax"
  | "xiaomi"
  | "siliconflow"
  | "stepfun"
  | "alibaba"
  | "anthropic"
  | "vercel-ai-gateway"
  | "cloudflare-ai-gateway"
  | "openrouter"
  | "fireworks-ai"
  | "together-ai"
  | "groq"
  | "deepinfra"
  | "hugging-face"
  | "baseten"
  | "cohere"
  | "openai"
  | "google"
  | "google-vertex-ai"
  | "volcengine"
  | "byteplus"
  | "meituan"
  | "tencent-tokenhub"
  | "mistral"
  | "azure"
  | "amazon-bedrock"
  | "custom";

export type ModelReasoningEffort = string;

export type ModelReasoningTransportKind = LlmTransportKind;

export type OpenAiCompatibleReasoningEffort =
  | "default"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type DeepSeekV4ReasoningEffort = "default" | "high" | "max";

export type MoonshotReasoningEffort = "default" | "minimal" | "low" | "medium" | "high";

export type MoonshotK3ReasoningEffort = "default" | "low" | "high" | "max";

export type XaiReasoningEffort = "default" | "none" | "low" | "medium" | "high";

export type GoogleReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high";

export type AnthropicReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelReasoningEffortOption<T extends string = string> {
  value: T;
  label: string;
}

export type ModelSupportsThinkingType = "only";

export interface ModelReasoningEffortContext {
  provider?: ModelReasoningProvider;
  model?: string;
  transportKind?: ModelReasoningTransportKind;
  supportedEfforts?: readonly ModelReasoningEffort[];
  /** Kimi Code `supports_thinking_type`; `only` means thinking is always on and the Thinking switch is hidden. */
  supportsThinkingType?: ModelSupportsThinkingType;
  /** Catalog flag: the model supports the `thinking.type` switch (e.g. Meituan LongCat). */
  supportsThinkingSwitch?: boolean;
}

export const DEFAULT_MODEL_REASONING_EFFORT: OpenAiCompatibleReasoningEffort = "medium";

export const OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<OpenAiCompatibleReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Xhigh" },
];

export const GPT56_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<OpenAiCompatibleReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Xhigh" },
  { value: "max", label: "Max" },
];

export const DEEPSEEK_V4_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<DeepSeekV4ReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export const MOONSHOT_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<MoonshotReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const MOONSHOT_K3_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<MoonshotK3ReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export const XAI_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<XaiReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const GOOGLE_GEMINI_MINIMAL_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<GoogleReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const GOOGLE_GEMINI_LEVEL_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<GoogleReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const GOOGLE_GEMINI_BUDGET_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<GoogleReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const GOOGLE_REASONING_EFFORT_OPTIONS = GOOGLE_GEMINI_BUDGET_REASONING_EFFORT_OPTIONS;

export const ANTHROPIC_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<AnthropicReasoningEffort>
> = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Xhigh" },
  { value: "max", label: "Max" },
];

const ALL_REASONING_EFFORT_OPTIONS = dedupeReasoningEffortOptions([
  ...OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS,
  ...GPT56_REASONING_EFFORT_OPTIONS,
  ...DEEPSEEK_V4_REASONING_EFFORT_OPTIONS,
  ...MOONSHOT_REASONING_EFFORT_OPTIONS,
  ...MOONSHOT_K3_REASONING_EFFORT_OPTIONS,
  ...XAI_REASONING_EFFORT_OPTIONS,
  ...GOOGLE_GEMINI_MINIMAL_REASONING_EFFORT_OPTIONS,
  ...GOOGLE_GEMINI_LEVEL_REASONING_EFFORT_OPTIONS,
  ...GOOGLE_GEMINI_BUDGET_REASONING_EFFORT_OPTIONS,
  ...ANTHROPIC_REASONING_EFFORT_OPTIONS,
]);

const ALL_REASONING_EFFORT_VALUES = new Set<string>(
  ALL_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const GPT56_REASONING_EFFORT_VALUES = new Set<string>(
  GPT56_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const OPENAI_COMPATIBLE_REASONING_EFFORT_VALUES = new Set<string>(
  OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const DEEPSEEK_V4_REASONING_EFFORT_VALUES = new Set<string>(
  DEEPSEEK_V4_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const MOONSHOT_REASONING_EFFORT_VALUES = new Set<string>(
  MOONSHOT_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const MOONSHOT_K3_REASONING_EFFORT_VALUES = new Set<string>(
  MOONSHOT_K3_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const XAI_REASONING_EFFORT_VALUES = new Set<string>(
  XAI_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const ANTHROPIC_REASONING_EFFORT_VALUES = new Set<string>(
  ANTHROPIC_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return ALL_REASONING_EFFORT_VALUES.has(trimmed) ? trimmed : undefined;
}

export function resolveModelReasoningEffort(value: unknown): ModelReasoningEffort {
  return resolveCompatibleModelReasoningEffort(normalizeModelReasoningEffort(value), undefined);
}

export function defaultModelReasoningEffort(
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return "default";
  }

  if (isMoonshotReasoningEffortModel(context)) {
    return "default";
  }

  if (isKimiCodeReasoningEffortModel(context)) {
    return "default";
  }

  if (isXaiReasoningEffortModel(context)) {
    return "default";
  }

  if (isGoogleReasoningEffortModel(context)) {
    return "default";
  }

  if (isAnthropicReasoningEffortModel(context)) {
    return "default";
  }

  if (isGatewayAnthropicClaudeReasoningModel(context)) {
    return "default";
  }

  if (isOpenRouterAnthropicClaudeReasoningModel(context)) {
    return "default";
  }

  if (isXiaomiResponsesReasoningEffortContext(context)) {
    return "default";
  }

  if (isTokenHubReasoningEffortModel(context)) {
    return "default";
  }

  if (isGroqReasoningEffortModel(context)) {
    return defaultGroqModelReasoningEffort(context);
  }

  return DEFAULT_MODEL_REASONING_EFFORT;
}

export function modelReasoningEffortOptions(
  context?: ModelReasoningEffortContext,
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  // DeepSeek routes (direct or Gateway deepseek/*) only expose reasoning_effort in thinking mode on V4.
  if (isDeepSeekRouteContext(context) && !isDeepSeekV4ReasoningEffortModel(context)) {
    return [{ value: "default", label: "Default" }];
  }

  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return DEEPSEEK_V4_REASONING_EFFORT_OPTIONS;
  }

  if (isMoonshotK3ReasoningEffortModel(context)) {
    // K3 tiers are fixed by the model documentation to low/high/max; do not trust leftover K2.x efforts from the catalog.
    return MOONSHOT_K3_REASONING_EFFORT_OPTIONS;
  }

  if (isMoonshotReasoningEffortModel(context)) {
    if (context?.supportedEfforts !== undefined) {
      return moonshotReasoningEffortOptionsForSupportedEfforts(context.supportedEfforts);
    }
    return MOONSHOT_REASONING_EFFORT_OPTIONS;
  }

  if (isKimiCodeReasoningEffortModel(context)) {
    if (context?.supportedEfforts !== undefined) {
      return moonshotReasoningEffortOptionsForSupportedEfforts(context.supportedEfforts);
    }
    return MOONSHOT_REASONING_EFFORT_OPTIONS;
  }

  if (isXaiReasoningEffortModel(context)) {
    return XAI_REASONING_EFFORT_OPTIONS;
  }

  if (isGoogleReasoningEffortModel(context)) {
    return googleReasoningEffortOptionsForContext(context);
  }

  if (isAnthropicReasoningEffortModel(context)) {
    return anthropicClaudeReasoningEffortOptions(context);
  }

  if (isGatewayAnthropicClaudeReasoningModel(context)) {
    return anthropicClaudeReasoningEffortOptions(
      context,
      context?.supportedEfforts ??
        resolveGatewayAnthropicClaudeCapabilities(context?.model ?? "").supportedEfforts,
    );
  }

  if (isOpenRouterAnthropicClaudeReasoningModel(context)) {
    return anthropicClaudeReasoningEffortOptions(
      context,
      context?.supportedEfforts ??
        resolveRoutedAnthropicClaudeCapabilities(context?.model ?? "").supportedEfforts,
    );
  }

  if (isXiaomiResponsesReasoningEffortContext(context)) {
    return OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS;
  }

  if (context?.provider === "tencent-tokenhub" && !isTokenHubReasoningEffortModel(context)) {
    return [{ value: "default", label: "Default" }];
  }

  if (isTokenHubReasoningEffortModel(context)) {
    return OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS;
  }

  if (modelSupportsOpenAiGpt56ReasoningControls(context)) {
    return gpt56ReasoningEffortOptionsForContext(context);
  }

  if (isGroqReasoningEffortModel(context)) {
    return groqReasoningEffortOptionsForSupportedEfforts(context!.supportedEfforts!);
  }

  return OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS;
}

export function resolveModelReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  return resolveCompatibleModelReasoningEffort(normalizeModelReasoningEffort(value), context);
}

export function resolveOpenAiTransportReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): OpenAiTransportConfig["reasoningEffort"] | undefined {
  const normalized = resolveModelReasoningEffortForContext(value, {
    ...context,
    transportKind: context?.transportKind ?? "openai-compatible",
  });

  switch (normalized) {
    case "default":
      return undefined;
    case "none":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "minimal":
    case "max":
      return normalized;
    default:
      return undefined;
  }
}

/** Groq Qwen must send default explicitly to the API; the OpenAI-compatible transport's default→undefined mapping must not be reused. */
export function resolveGroqTransportReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): OpenAiTransportConfig["reasoningEffort"] | undefined {
  const normalized = resolveModelReasoningEffortForContext(value, {
    ...context,
    transportKind: context?.transportKind ?? "openai-compatible",
  });

  switch (normalized) {
    case "none":
    case "default":
    case "low":
    case "medium":
    case "high":
      return normalized;
    default:
      return undefined;
  }
}

export function resolveAnthropicTransportReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): AnthropicTransportConfig["effort"] | undefined {
  if (resolveRoutedAnthropicClaudeCapabilitiesForContext(context)?.thinkingMode === "budget") {
    return undefined;
  }

  const normalized = resolveModelReasoningEffortForContext(value, {
    ...context,
    transportKind: "anthropic",
  });

  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return normalized;
    default:
      return undefined;
  }
}

export function modelReasoningEffortLabel(value: ModelReasoningEffort): string {
  return ALL_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? "Medium";
}

export function isDeepSeekV4ReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  if (!isDeepSeekRouteContext(context)) {
    return false;
  }
  return isDeepSeekV4ModelId(context?.model ?? "");
}

export function isMoonshotReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return context?.provider === "moonshot-ai";
}

/** Moonshot kimi-k3 and Gateway moonshotai/kimi-k3: top-level reasoning_effort, no thinking.type. */
export function isMoonshotK3ReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  if (!isMoonshotKimiK3Model(context?.model ?? "")) {
    return false;
  }
  if (context?.provider === "moonshot-ai" || context?.provider === "baseten") {
    return true;
  }
  return (
    context?.provider === "vercel-ai-gateway" &&
    parseGatewayUpstreamSlug(context.model ?? "") === "moonshotai"
  );
}

export function isKimiCodeReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return context?.provider === "kimi-code";
}

export function isKimiCodeThinkingOnlyModel(context?: ModelReasoningEffortContext): boolean {
  return context?.supportsThinkingType === "only";
}

export function isXaiReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return context?.provider === "xai";
}

export function isGoogleReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return (
    context?.provider === "google" ||
    context?.provider === "google-vertex-ai" ||
    isGatewayGoogleGeminiModel(
      context?.provider === "vercel-ai-gateway" ? "vercel-ai-gateway" : undefined,
      context?.model ?? "",
    )
  );
}

export function googleReasoningEffortOptionsForContext(
  context?: ModelReasoningEffortContext,
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const model = context?.model ?? "";
  if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
    return GOOGLE_GEMINI_MINIMAL_REASONING_EFFORT_OPTIONS;
  }
  if (isGoogleGeminiThinkingLevelModel(model)) {
    return GOOGLE_GEMINI_LEVEL_REASONING_EFFORT_OPTIONS;
  }
  return GOOGLE_GEMINI_BUDGET_REASONING_EFFORT_OPTIONS;
}

function googleReasoningEffortValuesForModel(model: string): Set<string> {
  return new Set(googleReasoningEffortOptionsForContext({ model }).map((option) => option.value));
}

export function isAnthropicReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return context?.transportKind === "anthropic" || context?.provider === "anthropic";
}

export function isGatewayAnthropicClaudeReasoningModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return isGatewayAnthropicClaudeModel(
    context?.provider === "vercel-ai-gateway" ? "vercel-ai-gateway" : undefined,
    context?.model ?? "",
  );
}

export function isOpenRouterAnthropicClaudeReasoningModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return isOpenRouterAnthropicClaudeModel(
    context?.provider === "openrouter" ? "openrouter" : undefined,
    context?.model ?? "",
  );
}

function normalizeModelId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeDeepSeekModelId(model: string): string {
  const normalized = normalizeModelId(model);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function isDeepSeekV4ModelId(model: string): boolean {
  // Direct + Gateway `deepseek/deepseek-v4-*` (pro, flash, flash-vision-exp, …).
  return normalizeDeepSeekModelId(model).startsWith("deepseek-v4-");
}

function isDeepSeekRouteContext(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider === "deepseek") {
    return true;
  }
  return (
    context?.provider === "vercel-ai-gateway" &&
    parseGatewayUpstreamSlug(context.model ?? "") === "deepseek"
  );
}

function resolveCompatibleModelReasoningEffort(
  value: ModelReasoningEffort | undefined,
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  const normalized = value ?? defaultModelReasoningEffort(context);

  if (isDeepSeekV4ReasoningEffortModel(context)) {
    switch (normalized) {
      case "low":
      case "medium":
      case "high":
        return "high";
      case "xhigh":
      case "max":
        return "max";
      case "none":
      case "minimal":
        return "default";
      case "default":
        return "default";
      default:
        return DEEPSEEK_V4_REASONING_EFFORT_VALUES.has(normalized) ? normalized : "default";
    }
  }

  if (isMoonshotK3ReasoningEffortModel(context)) {
    switch (normalized) {
      case "none":
      case "minimal":
      case "medium":
        return "default";
      case "xhigh":
        return "max";
      default:
        return MOONSHOT_K3_REASONING_EFFORT_VALUES.has(normalized) ? normalized : "default";
    }
  }

  if (isMoonshotReasoningEffortModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    switch (normalized) {
      case "none":
        return "default";
      case "xhigh":
      case "max":
        return "high";
      default:
        return moonshotReasoningEffortValueForContext(normalized, supportedEfforts) ?? "default";
    }
  }

  if (isKimiCodeReasoningEffortModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    switch (normalized) {
      case "none":
        return "default";
      case "xhigh":
      case "max":
        return "high";
      default:
        return moonshotReasoningEffortValueForContext(normalized, supportedEfforts) ?? "default";
    }
  }

  if (isXaiReasoningEffortModel(context)) {
    switch (normalized) {
      case "minimal":
        return "low";
      case "xhigh":
      case "max":
        return "high";
      default:
        return XAI_REASONING_EFFORT_VALUES.has(normalized) ? normalized : "default";
    }
  }

  if (isGoogleReasoningEffortModel(context)) {
    const model = context?.model ?? "";
    switch (normalized) {
      case "none":
        if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
          return "minimal";
        }
        if (isGoogleGeminiThinkingLevelModel(model)) {
          return "default";
        }
        return "none";
      case "minimal":
        if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
          return "minimal";
        }
        if (isGoogleGeminiThinkingLevelModel(model)) {
          return "default";
        }
        return "none";
      case "xhigh":
      case "max":
        return "high";
      default:
        return googleReasoningEffortValuesForModel(model).has(normalized) ? normalized : "default";
    }
  }

  if (isAnthropicReasoningEffortModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    switch (normalized) {
      case "none":
      case "minimal":
        return "default";
      default:
        return anthropicReasoningEffortValueForContext(normalized, supportedEfforts) ?? "default";
    }
  }

  if (isGatewayAnthropicClaudeReasoningModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(
      context?.supportedEfforts ??
        resolveGatewayAnthropicClaudeCapabilities(context?.model ?? "").supportedEfforts,
    );
    switch (normalized) {
      case "none":
      case "minimal":
        return "default";
      default:
        return anthropicReasoningEffortValueForContext(normalized, supportedEfforts) ?? "default";
    }
  }

  if (isOpenRouterAnthropicClaudeReasoningModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(
      context?.supportedEfforts ??
        resolveRoutedAnthropicClaudeCapabilities(context?.model ?? "").supportedEfforts,
    );
    switch (normalized) {
      case "none":
      case "minimal":
        return "default";
      default:
        return anthropicReasoningEffortValueForContext(normalized, supportedEfforts) ?? "default";
    }
  }

  if (isGroqReasoningEffortModel(context)) {
    return groqReasoningEffortValueForContext(normalized, context?.supportedEfforts) ?? "default";
  }

  if (normalized === "minimal") {
    return "default";
  }

  if (modelSupportsOpenAiGpt56ReasoningControls(context)) {
    if (isOpenAiGpt6AstraModel(context?.model ?? "") && normalized === "none") {
      return "default";
    }
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    if (supportedEfforts && supportedEfforts.size > 0) {
      return (
        gpt56ReasoningEffortValueForContext(normalized, supportedEfforts) ??
        DEFAULT_MODEL_REASONING_EFFORT
      );
    }
    return GPT56_REASONING_EFFORT_VALUES.has(normalized)
      ? normalized
      : DEFAULT_MODEL_REASONING_EFFORT;
  }

  if (normalized === "max") {
    return "xhigh";
  }

  return OPENAI_COMPATIBLE_REASONING_EFFORT_VALUES.has(normalized)
    ? normalized
    : DEFAULT_MODEL_REASONING_EFFORT;
}

function dedupeReasoningEffortOptions(
  options: ReadonlyArray<ModelReasoningEffortOption<string>>,
): ModelReasoningEffortOption<string>[] {
  const seen = new Set<string>();
  const deduped: ModelReasoningEffortOption<string>[] = [];

  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    deduped.push(option);
  }

  return deduped;
}

function resolveRoutedAnthropicClaudeCapabilitiesForContext(context?: ModelReasoningEffortContext) {
  const model = context?.model?.trim();
  if (!model) {
    return undefined;
  }
  const routedModelId = isRoutedAnthropicClaudeModel(model) ? model : `anthropic/${model}`;
  if (!isRoutedAnthropicClaudeModel(routedModelId)) {
    return undefined;
  }
  return resolveRoutedAnthropicClaudeCapabilities(routedModelId);
}

function anthropicClaudeReasoningEffortOptions(
  context?: ModelReasoningEffortContext,
  supportedEffortsOverride?: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const capabilities = resolveRoutedAnthropicClaudeCapabilitiesForContext(context);
  if (capabilities?.thinkingMode === "budget") {
    return [{ value: "default", label: "Default" }];
  }

  const supportedEfforts = supportedEffortsOverride ?? capabilities?.supportedEfforts;
  if (supportedEfforts !== undefined && supportedEfforts.length > 0) {
    return anthropicReasoningEffortOptionsForSupportedEfforts(supportedEfforts);
  }

  if (isAnthropicReasoningEffortModel(context)) {
    return ANTHROPIC_REASONING_EFFORT_OPTIONS;
  }

  return [{ value: "default", label: "Default" }];
}

function anthropicReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts?: ReadonlySet<string>,
): ModelReasoningEffort | undefined {
  if (!ANTHROPIC_REASONING_EFFORT_VALUES.has(normalized)) {
    return undefined;
  }
  if (!supportedEfforts) {
    return normalized;
  }
  return normalized === "default" || supportedEfforts.has(normalized) ? normalized : undefined;
}

function anthropicReasoningEffortOptionsForSupportedEfforts(
  supportedEfforts: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const supported = normalizeSupportedReasoningEfforts(supportedEfforts) ?? new Set<string>();
  return ANTHROPIC_REASONING_EFFORT_OPTIONS.filter(
    (option) => option.value === "default" || supported.has(option.value),
  );
}

function moonshotReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts?: ReadonlySet<string>,
): ModelReasoningEffort | undefined {
  if (!MOONSHOT_REASONING_EFFORT_VALUES.has(normalized)) {
    return undefined;
  }
  if (!supportedEfforts) {
    return normalized;
  }
  return normalized === "default" || supportedEfforts.has(normalized) ? normalized : undefined;
}

function moonshotReasoningEffortOptionsForSupportedEfforts(
  supportedEfforts: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const supported = normalizeSupportedReasoningEfforts(supportedEfforts) ?? new Set<string>();
  return MOONSHOT_REASONING_EFFORT_OPTIONS.filter(
    (option) => option.value === "default" || supported.has(option.value),
  );
}

const GROQ_REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "None",
  default: "Default",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function isGroqReasoningEffortModel(context?: ModelReasoningEffortContext): boolean {
  return (
    context?.provider === "groq" &&
    context.supportedEfforts !== undefined &&
    context.supportedEfforts.length > 0
  );
}

function defaultGroqModelReasoningEffort(
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  const supported = readGroqSupportedReasoningEffortSet(context?.supportedEfforts);
  if (supported.has("default")) {
    return "default";
  }
  if (supported.has("medium")) {
    return "medium";
  }
  return supported.values().next().value ?? DEFAULT_MODEL_REASONING_EFFORT;
}

function readGroqSupportedReasoningEffortSet(
  supportedEfforts: readonly ModelReasoningEffort[] | undefined,
): ReadonlySet<string> {
  if (!supportedEfforts) {
    return new Set<string>();
  }
  const normalized = new Set<string>();
  for (const value of supportedEfforts) {
    const effort = normalizeModelReasoningEffort(value) ?? value;
    if (effort) {
      normalized.add(effort);
    }
  }
  return normalized;
}

function groqReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts: readonly ModelReasoningEffort[] | undefined,
): ModelReasoningEffort | undefined {
  const supported = readGroqSupportedReasoningEffortSet(supportedEfforts);
  if (supported.has(normalized)) {
    return normalized;
  }
  if (normalized === "minimal") {
    if (supported.has("default")) {
      return "default";
    }
    if (supported.has("low")) {
      return "low";
    }
  }
  return undefined;
}

function groqReasoningEffortOptionsForSupportedEfforts(
  supportedEfforts: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  return supportedEfforts.map((value) => {
    const effort = normalizeModelReasoningEffort(value) ?? value;
    return {
      value: effort,
      label: GROQ_REASONING_EFFORT_LABELS[effort] ?? effort,
    };
  });
}

function gpt56ReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts?: ReadonlySet<string>,
): ModelReasoningEffort | undefined {
  if (!GPT56_REASONING_EFFORT_VALUES.has(normalized)) {
    return undefined;
  }
  if (!supportedEfforts) {
    return normalized;
  }
  return normalized === "default" || supportedEfforts.has(normalized) ? normalized : undefined;
}

function gpt56ReasoningEffortOptionsForContext(
  context?: ModelReasoningEffortContext,
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
  const options =
    supportedEfforts && supportedEfforts.size > 0
      ? GPT56_REASONING_EFFORT_OPTIONS.filter(
          (option) => option.value === "default" || supportedEfforts.has(option.value),
        )
      : GPT56_REASONING_EFFORT_OPTIONS;

  if (isOpenAiGpt6AstraModel(context?.model ?? "")) {
    return options.filter((option) => option.value !== "none");
  }

  return options;
}

function normalizeSupportedReasoningEfforts(
  values: readonly ModelReasoningEffort[] | undefined,
): ReadonlySet<string> | undefined {
  if (!values) {
    return undefined;
  }
  const normalized = new Set<string>();
  for (const value of values) {
    const effort = normalizeModelReasoningEffort(value);
    if (!effort || effort === "default") {
      continue;
    }
    normalized.add(effort);
  }
  return normalized;
}
