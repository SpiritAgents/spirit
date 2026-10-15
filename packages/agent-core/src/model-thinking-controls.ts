import type { AnthropicThinkingConfig } from "./anthropic/anthropic-compat.js";
import type { ModelReasoningEffortContext, ModelReasoningProvider } from "./reasoning-effort.js";
import {
  isDeepSeekV4ReasoningEffortModel,
  isGoogleReasoningEffortModel,
  isGroqReasoningEffortModel,
  isKimiCodeReasoningEffortModel,
  isKimiCodeThinkingOnlyModel,
  isMoonshotReasoningEffortModel,
  isOpenRouterAnthropicClaudeReasoningModel,
  isXaiReasoningEffortModel,
} from "./reasoning-effort.js";
import { parseGatewayUpstreamSlug } from "./openai/gateway-code-completion-thinking.js";
import { isMinimaxM3ThinkingSwitchModel } from "./openai/gateway-minimax-thinking.js";
import { isThinkingSwitchDisabledModel } from "./openai/thinking-switch-disabled-models.js";
import { isMuseReasoningEffortModel } from "./openai/muse-reasoning-effort.js";
import { isMoonshotThinkingSwitchModel } from "./openai/moonshot-thinking-switch.js";
import {
  isXiaomiResponsesReasoningEffortContext,
  isXiaomiThinkingSwitchEligibleModel,
} from "./openai/gateway-xiaomi-thinking.js";
import { isZaiThinkingSwitchEligibleModel } from "./openai/gateway-zai-thinking.js";
import { isTokenHubReasoningEffortModel } from "./openai/tokenhub-reasoning-effort.js";
import {
  isRoutedAnthropicClaudeModel,
  resolveRoutedAnthropicClaudeCapabilities,
  routedAnthropicClaudeThinkingSwitchable,
  type RoutedAnthropicClaudeCapabilities,
} from "./openai/routed-anthropic-claude-capabilities.js";

const DIRECT_THINKING_SWITCH_PROVIDERS = new Set([
  "z-ai",
  "zhipu-ai",
  "xiaomi",
  "volcengine",
  "byteplus",
  "alibaba",
  "siliconflow",
  "tencent-tokenhub",
  // DeepInfra disables thinking via the flat reasoning_effort / reasoning.enabled runtime fields (guaranteed at the OpenAPI layer).
  "deepinfra",
]);

const GATEWAY_REASONING_EFFORT_SLUGS = new Set(["openai", "google", "anthropic", "xai"]);

/** Aggregators: catalog capability fields are incomplete, so the reasoning effort UI and OpenAI-compatible effort tiers are fully enabled. */
const AGGREGATED_REASONING_EFFORT_PRIMARY_PROVIDERS = new Set<ModelReasoningProvider>([
  "fireworks-ai",
  "hugging-face",
  "openrouter",
  "cloudflare-ai-gateway",
]);

export type ModelEffortControlLabelKind = "effort" | "reasoningEffort";

function normalizeModelId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function routedAnthropicModelId(context?: ModelReasoningEffortContext): string | undefined {
  const model = context?.model?.trim();
  if (!model) {
    return undefined;
  }
  if (isRoutedAnthropicClaudeModel(model)) {
    return model;
  }
  const prefixed = `anthropic/${model}`;
  return isRoutedAnthropicClaudeModel(prefixed) ? prefixed : undefined;
}

function resolveAnthropicClaudeCapabilitiesForContext(
  context?: ModelReasoningEffortContext,
): RoutedAnthropicClaudeCapabilities | undefined {
  const modelId = routedAnthropicModelId(context);
  if (modelId === undefined) {
    return undefined;
  }
  return resolveRoutedAnthropicClaudeCapabilities(modelId);
}

/** Claude adaptive thinking (4.6+): UI Effort control with output_config.effort semantics. */
export function isAnthropicClaudeEffortModel(context?: ModelReasoningEffortContext): boolean {
  return isAnthropicClaudeAdaptiveThinkingModel(context);
}

/** Claude adaptive thinking (4.6+): thinking.type=adaptive when enabled. */
export function isAnthropicClaudeAdaptiveThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);
  return capabilities?.thinkingMode === "adaptive";
}

/** Claude budget thinking (4.5 and earlier models supporting extended thinking): thinking.type=enabled when enabled. */
export function isAnthropicClaudeBudgetThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);
  return capabilities?.thinkingMode === "budget";
}

/** Claude switchable thinking (adaptive or budget); thinkingMode=none and always-on adaptive are excluded. */
export function isAnthropicClaudeSwitchableThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);
  if (capabilities === undefined) {
    return false;
  }
  return routedAnthropicClaudeThinkingSwitchable(capabilities);
}

export function modelEffortControlLabelKind(
  context?: ModelReasoningEffortContext,
): ModelEffortControlLabelKind {
  return isAnthropicClaudeEffortModel(context) ? "effort" : "reasoningEffort";
}

/** DeepSeek R1 / reasoner: always thinks; no thinking toggle. */
export function isDeepSeekReasoningOnlyModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== "deepseek") {
    return false;
  }
  const model = normalizeModelId(context.model);
  return (
    model.includes("deepseek-reasoner") || model.includes("deepseek-r1") || model === "deepseek-r1"
  );
}

function isDeepSeekThinkingSwitchModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== "deepseek") {
    return false;
  }
  if (isDeepSeekReasoningOnlyModel(context)) {
    return false;
  }
  return isDeepSeekV4ReasoningEffortModel(context);
}

function isGatewayThinkingSwitchModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== "vercel-ai-gateway") {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? "");
  if (slug === undefined) {
    return false;
  }
  if (GATEWAY_REASONING_EFFORT_SLUGS.has(slug)) {
    return false;
  }
  // DeepSeek V3 and below distinguish thinking variants by model name; no extended thinking switch.
  if (slug === "deepseek") {
    return isDeepSeekV4ReasoningEffortModel(context);
  }
  if (slug === "moonshotai") {
    return isMoonshotThinkingSwitchModel(context);
  }
  if (slug === "xiaomi") {
    if (context.transportKind === "open-responses") {
      return false;
    }
    return isXiaomiThinkingSwitchEligibleModel(context.model ?? "");
  }
  if (slug === "zai") {
    return isZaiThinkingSwitchEligibleModel(context.model ?? "");
  }
  if (slug === "minimax") {
    return isMinimaxM3ThinkingSwitchModel(context.model ?? "");
  }
  return true;
}

function isGatewayReasoningEffortPrimaryControlModel(
  context?: ModelReasoningEffortContext,
): boolean {
  if (context?.provider !== "vercel-ai-gateway") {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? "");
  if (slug === undefined) {
    return false;
  }
  if (slug === "moonshotai") {
    return !isMoonshotThinkingSwitchModel(context);
  }
  return GATEWAY_REASONING_EFFORT_SLUGS.has(slug);
}

/** OpenAI / Reasoning Effort primary-control vendors: no Thinking switch (excludes DeepSeek V4 hybrid and Claude switchable). */
export function modelUsesReasoningEffortPrimaryControl(
  context?: ModelReasoningEffortContext,
): boolean {
  if (isMuseReasoningEffortModel(context?.model ?? "")) {
    return true;
  }
  if (isAnthropicClaudeSwitchableThinkingModel(context)) {
    return false;
  }
  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return false;
  }

  const provider = context?.provider;
  if (provider === "openai" || provider === "azure" || provider === "amazon-bedrock") {
    return true;
  }
  if (provider === "anthropic") {
    return true;
  }
  if (isXaiReasoningEffortModel(context)) {
    return true;
  }
  if (isMoonshotReasoningEffortModel(context) && !isMoonshotThinkingSwitchModel(context)) {
    return true;
  }
  if (isKimiCodeReasoningEffortModel(context) && isKimiCodeThinkingOnlyModel(context)) {
    return true;
  }
  if (isKimiCodeReasoningEffortModel(context) && context?.supportsThinkingType === undefined) {
    return true;
  }
  if (isGoogleReasoningEffortModel(context)) {
    return true;
  }
  if (isGroqReasoningEffortModel(context)) {
    return true;
  }
  if (isGatewayReasoningEffortPrimaryControlModel(context)) {
    return true;
  }
  if (isOpenRouterAnthropicClaudeReasoningModel(context)) {
    return true;
  }
  if (isXiaomiResponsesReasoningEffortContext(context)) {
    return true;
  }
  if (provider !== undefined && AGGREGATED_REASONING_EFFORT_PRIMARY_PROVIDERS.has(provider)) {
    return true;
  }

  return false;
}

export function modelSupportsThinkingSwitch(context?: ModelReasoningEffortContext): boolean {
  if (
    isThinkingSwitchDisabledModel(context?.model ?? "") ||
    isMuseReasoningEffortModel(context?.model ?? "")
  ) {
    return false;
  }
  if (isAnthropicClaudeSwitchableThinkingModel(context)) {
    return true;
  }
  if (context?.supportsThinkingType === "only") {
    return false;
  }
  if (context?.supportsThinkingSwitch === true) {
    return true;
  }
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  if (isDeepSeekReasoningOnlyModel(context)) {
    return false;
  }

  const provider = context?.provider;
  if (provider === "minimax") {
    return isMinimaxM3ThinkingSwitchModel(context?.model ?? "");
  }
  if (provider !== undefined && DIRECT_THINKING_SWITCH_PROVIDERS.has(provider)) {
    if (provider === "xiaomi" && context?.transportKind === "open-responses") {
      return false;
    }
    return true;
  }
  if (isDeepSeekThinkingSwitchModel(context)) {
    return true;
  }
  if (isMoonshotThinkingSwitchModel(context)) {
    return true;
  }
  if (isGatewayThinkingSwitchModel(context)) {
    return true;
  }

  return false;
}

/** DeepSeek V4: the API accepts reasoning_effort (high/max) only when thinking is enabled. */
export function modelSupportsReasoningEffortWhileThinking(
  context?: ModelReasoningEffortContext,
): boolean {
  return isDeepSeekV4ReasoningEffortModel(context);
}

/**
 * Inspector: whether to show the Effort / Reasoning Effort control.
 * Claude adaptive (4.6+) always shows Effort; budget-type Claude shows only the Thinking switch;
 * Reasoning Effort primary-control models always show it; other thinking-type models show it only when thinking is enabled.
 */
export function modelShowsReasoningEffortControl(
  context?: ModelReasoningEffortContext,
  thinkingEnabled?: boolean,
): boolean {
  if (isAnthropicClaudeAdaptiveThinkingModel(context)) {
    return true;
  }
  if (isAnthropicClaudeBudgetThinkingModel(context)) {
    return false;
  }
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return true;
  }
  if (context?.provider === "tencent-tokenhub" && !isTokenHubReasoningEffortModel(context)) {
    return false;
  }
  if (!modelSupportsThinkingSwitch(context)) {
    return false;
  }
  return thinkingEnabled !== false;
}

export function resolveVendorExtendedThinking(thinkingEnabled?: boolean): boolean | undefined {
  if (thinkingEnabled === false) {
    return false;
  }
  return undefined;
}

/** Strips reasoning effort when thinking is off; Claude adaptive Effort and Reasoning Effort primary-control models keep the user's tier. */
export function shouldPinReasoningEffortToDefault(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): boolean {
  if (isAnthropicClaudeAdaptiveThinkingModel(context)) {
    return false;
  }
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  return thinkingEnabled === false;
}

export function resolveModelThinkingEnabled(thinkingEnabled?: boolean): boolean {
  return thinkingEnabled !== false;
}

/** Anthropic direct transport: explicit thinking config (adaptive / enabled / disabled). */
export function resolveAnthropicExplicitThinkingConfig(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): AnthropicThinkingConfig | undefined {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);

  if (capabilities?.thinkingMode === "adaptive") {
    if (thinkingEnabled === false && routedAnthropicClaudeThinkingSwitchable(capabilities)) {
      return { type: "disabled" };
    }
    return {
      type: "adaptive",
      ...(capabilities.adaptiveDisplay ? { display: capabilities.adaptiveDisplay } : {}),
    };
  }

  if (capabilities?.thinkingMode === "budget") {
    if (thinkingEnabled === false) {
      return { type: "disabled" };
    }
    return undefined;
  }

  if (thinkingEnabled === false && modelSupportsThinkingSwitch(context)) {
    return { type: "disabled" };
  }

  return undefined;
}
