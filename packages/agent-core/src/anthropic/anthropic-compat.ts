import { isCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { isMeituanAnthropicThinkingSwitchConfig } from "../meituan/meituan-anthropic-fetch.js";
import type { JsonObject, JsonValue } from "../ports.js";
import { cloneJsonValue } from "../tool-agent.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  TransportRequestProfile,
} from "../llm-provider-shared.js";
import { buildMinimaxProviderOptions } from "./minimax-provider-options.js";

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export type AnthropicThinkingConfig =
  | { type: "adaptive"; display?: "omitted" | "summarized" }
  | { type: "enabled"; budgetTokens: number; display?: "omitted" | "summarized" }
  | { type: "disabled" };

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicStructuredOutputMode = "outputFormat" | "jsonTool" | "auto";

export interface AnthropicTransportConfig extends LlmWebToolExposure {
  transportKind: "anthropic";
  apiKey: string;
  model: string;
  baseUrl?: string;
  compactModel?: string;
  workspaceRoot?: string;
  modelCapabilities?: LlmModelCapabilities;
  thinking?: AnthropicThinkingConfig;
  effort?: AnthropicEffort;
  supportedEfforts?: readonly AnthropicEffort[];
  sendReasoning?: boolean;
  disableParallelToolUse?: boolean;
  structuredOutputMode?: AnthropicStructuredOutputMode;
  /** Policy profile for lightweight non-Agent requests such as code completion; defaults to agent-path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /** Cloudflare AI Gateway name; injected as `cf-aig-gateway-id` on requests. */
  cloudflareGatewayId?: string;
  /** Aligned with the host ModelProfile.provider; used for Messages API vendor extensions. */
  llmVendor?: import("../openai/openai-compat.js").OpenAiLlmVendor;
  /**
   * Catalog marker: vendors such as Meituan LongCat send `thinking.type` via the Messages API.
   * Only injects enabled/disabled for `meituan` when true.
   */
  supportsThinkingSwitch?: boolean;
  /** Defaults to enabled; when false, sends `thinking.type: disabled`. */
  vendorExtendedThinking?: boolean;
  /**
   * Per-model service tier preference (canonical Spirit value). The direct Anthropic provider
   * persists `fast` for eligible Claude Opus models, mapped to `speed: "fast"` at request time.
   */
  serviceTier?: import("../model-service-tier.js").ModelServiceTier;
}

export interface AnthropicRequestTrace extends JsonObject {
  kind: "anthropic_sdk_messages";
  stepIndex: number;
  model: string;
  stream: boolean;
  messages: JsonValue[];
  tools?: JsonValue[];
  providerOptions?: JsonValue;
}

export function resolveAnthropicThinkingConfig(
  config: Pick<
    AnthropicTransportConfig,
    "model" | "thinking" | "effort" | "supportedEfforts" | "transportRequestProfile"
  >,
): AnthropicThinkingConfig | undefined {
  if (config.thinking !== undefined) {
    return config.thinking;
  }

  if (isCodeCompletionTransportProfile(config)) {
    return { type: "disabled" };
  }

  if (Array.isArray(config.supportedEfforts) && config.supportedEfforts.length === 0) {
    return { type: "disabled" };
  }

  const normalizedModel = config.model.trim().toLowerCase();
  if (
    normalizedModel.includes("claude-fable-5") ||
    normalizedModel.includes("claude-mythos-5") ||
    normalizedModel.includes("claude-opus-4-7") ||
    normalizedModel.includes("claude-opus-4-8")
  ) {
    return { type: "adaptive", display: "summarized" };
  }

  if (normalizedModel.includes("claude-sonnet-5")) {
    return { type: "adaptive" };
  }

  if (
    normalizedModel.includes("claude-opus-4-6") ||
    normalizedModel.includes("claude-sonnet-4-6") ||
    normalizedModel.includes("claude-haiku-4-5")
  ) {
    return { type: "adaptive" };
  }

  if (
    config.effort !== undefined ||
    (Array.isArray(config.supportedEfforts) && config.supportedEfforts.length > 0)
  ) {
    return { type: "enabled", budgetTokens: 12_000 };
  }

  return undefined;
}

export function buildAnthropicProviderOptions(
  config: Pick<
    AnthropicTransportConfig,
    | "model"
    | "thinking"
    | "effort"
    | "supportedEfforts"
    | "sendReasoning"
    | "disableParallelToolUse"
    | "structuredOutputMode"
    | "transportRequestProfile"
    | "llmVendor"
    | "supportsThinkingSwitch"
  >,
): Record<string, JsonObject> {
  const thinking = isMeituanAnthropicThinkingSwitchConfig(config)
    ? undefined
    : resolveAnthropicThinkingConfig(config);
  const options: JsonObject = {
    toolStreaming: true,
    ...(thinking !== undefined ? { thinking: thinking as unknown as JsonValue } : {}),
  };

  if (config.effort !== undefined) {
    options.effort = config.effort;
  }

  if (config.sendReasoning === false) {
    options.sendReasoning = false;
  }

  if (config.disableParallelToolUse === true) {
    options.disableParallelToolUse = true;
  }

  if (config.structuredOutputMode !== undefined) {
    options.structuredOutputMode = config.structuredOutputMode;
  }

  return {
    anthropic: options,
  };
}

export function buildAnthropicRequestTrace(
  config: AnthropicTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const providerOptions = {
    ...buildAnthropicProviderOptions(config),
    ...buildMinimaxProviderOptions(config),
  };
  const trace: AnthropicRequestTrace = {
    kind: "anthropic_sdk_messages",
    stepIndex,
    model: config.model,
    stream,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0 ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) } : {}),
    ...(Object.keys(providerOptions).length > 0
      ? { providerOptions: providerOptions as JsonValue }
      : {}),
  };

  return [trace];
}
