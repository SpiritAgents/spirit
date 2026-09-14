import type { JsonObject, JsonValue } from "../ports.js";
import { isArkLlmVendor } from "../ark/ark-provider.js";
import type { LlmModelCapabilities, TransportRequestProfile } from "../llm-provider-shared.js";
import { resolveOpenAiTransportReasoningEffortForContext } from "../reasoning-effort.js";
import {
  modelSupportsOpenAiGpt56ReasoningControls,
  resolveOpenAiTransportReasoningModeForContext,
  type ModelReasoningMode,
} from "../openai/gpt-reasoning-controls.js";
import { cloneJsonValue } from "../tool-agent.js";
import {
  isThinkingSwitchDisabledModel,
  normalizeUpstreamModelId,
} from "./thinking-switch-disabled-models.js";
import {
  buildOpenRouterClaudeReasoningBody,
  isOpenRouterAnthropicClaudeModel,
} from "./openrouter-anthropic-reasoning.js";

/** Aligned with the host's `ModelProfile.provider`; used to attach vendor extension fields on OpenAI-form APIs. */
export type OpenAiLlmVendor =
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
  | "custom";

export type OpenAiModelCapabilities = LlmModelCapabilities;

export interface OpenAiModelCompatibilityProfile {
  /**
   * Only when this is `true` does the compat layer proactively trim requests based on capabilities.
   *
   * Relying solely on the AI SDK's warning is not enough here:
   * 1. the warning happens after the request has already been constructed and sent, too late to intercept;
   * 2. the provider's `file` capability warning is too broad to map reliably onto our own image/audio/video input semantics;
   * 3. once unsupported content stays in the history, every subsequent request triggers the same warning again.
   *
   * So for providers/models with known compatibility sensitivity, maintain an explicit capabilities table
   * and trim upfront before serialization; unknown models are left as-is, with no arbitrary downgrade.
   */
  hasExplicitCapabilities: boolean;
  capabilities: OpenAiModelCapabilities;
}

export interface OpenAiImageGenerationConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: OpenAiModelCapabilities;
  /** Hugging Face Inference Providers routing hint (resolved from the Hub catalog). */
  inferenceProvider?: string;
}

export interface OpenAiVideoGenerationConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: OpenAiModelCapabilities;
  /** Hugging Face Inference Providers routing hint (resolved from the Hub catalog). */
  inferenceProvider?: string;
}

export interface OpenAiTransportConfig {
  transportKind?: "openai-compatible";
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  /**
   * The provider of the current model in the config (lowercase). When unset, no vendor-specific request body fields are attached.
   */
  llmVendor?: OpenAiLlmVendor;
  /**
   * User-configured explicit model capabilities. When provided, these override
   * provider/model inference for compatibility decisions such as image input.
   */
  modelCapabilities?: OpenAiModelCapabilities;
  /**
   * Optional dedicated model role used by the `generate_image` tool.
   */
  imageGeneration?: OpenAiImageGenerationConfig;
  /**
   * Optional dedicated model role used by the `generate_video` tool.
   */
  videoGeneration?: OpenAiVideoGenerationConfig;
  /**
   * Abstract reasoning effort; `default` means unspecified, leaving it to the upstream or the model's default behavior.
   * When not `default`, it maps directly to the official OpenAI chat.completions field `reasoning_effort`.
   */
  reasoningEffort?: "default" | "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningMode?: ModelReasoningMode;
  /**
   * Only for `deepseek` / `moonshot-ai`: whether to include
   * `thinking: { type: 'enabled' | 'disabled' }` in every chat.completions request body through this transport
   * (main conversation, tool rounds, and history compaction).
   * Defaults to `true` (enabled); when set to `false`, `disabled` is sent.
   */
  vendorExtendedThinking?: boolean;
  /**
   * Catalog flag: the model supports the `thinking.type` switch (e.g. Meituan LongCat).
   * The thinking parameter is sent to `meituan` only when this is true.
   */
  supportsThinkingSwitch?: boolean;
  /** Google Vertex AI project ID (may be omitted in Express mode). */
  vertexProject?: string;
  /** Google Vertex AI region, e.g. `us-central1` (may be omitted in Express mode). */
  vertexLocation?: string;
  /** Service account `client_email` (paired with `vertexPrivateKey`). */
  vertexClientEmail?: string;
  /** Service account `private_key` (paired with `vertexClientEmail`). */
  vertexPrivateKey?: string;
  /** Policy profile for non-Agent lightweight requests such as code completion; defaults to the agent path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /**
   * Pass-through of `createVertex`'s `googleAuthOptions` (e.g. ADC customization or a test `authClient`).
   * If `vertexClientEmail` / `vertexPrivateKey` are set, the host-built credentials take precedence over this field.
   */
  vertexGoogleAuthOptions?: Record<string, unknown>;
  /** Cloudflare AI Gateway name; injected as `cf-aig-gateway-id` on requests. */
  cloudflareGatewayId?: string;
}

export interface OpenAiRequestTrace extends JsonObject {
  kind:
    | "openai_sdk_chat_completions"
    | "deepseek_sdk_chat_completions"
    | "xai_sdk_chat_completions"
    | "moonshot_sdk_chat_completions"
    | "alibaba_sdk_chat_completions"
    | "gateway_sdk_chat_completions";
  stepIndex: number;
  model: string;
  stream: boolean;
  /** OpenAI-compatible chat.completions request field. */
  reasoning_effort?: JsonValue;
  toolChoice?: "auto";
  messages: JsonValue[];
  tools?: JsonValue[];
  /** Genuine vendor extension sent alongside the SDK request body (if any), e.g. DeepSeek/Moonshot's `thinking`. */
  vendorExtras?: JsonValue;
}

export function resolveOpenAiModelCompatibilityProfile(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "modelCapabilities">,
): OpenAiModelCompatibilityProfile {
  if (config.modelCapabilities !== undefined) {
    return {
      hasExplicitCapabilities: true,
      capabilities: { ...config.modelCapabilities },
    };
  }

  if (config.llmVendor === "deepseek") {
    return {
      hasExplicitCapabilities: true,
      capabilities: isDeepSeekV4VisionModelId(config.model) ? { imageInput: true } : {},
    };
  }

  if (config.llmVendor === "moonshot-ai" || config.llmVendor === "kimi-code") {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === "xiaomi") {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === "deepinfra") {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === "minimax") {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === "siliconflow") {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  return {
    hasExplicitCapabilities: false,
    capabilities: {},
  };
}

/** Official experimental vision model; GA names will not keep a `-vision` suffix. */
export function isDeepSeekV4VisionModelId(model: string): boolean {
  return normalizeUpstreamModelId(model) === "deepseek-v4-flash-vision-exp";
}

/**
 * OpenAI's official chat.completions reasoning effort field.
 */
export function openAiReasoningEffort(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "reasoningEffort">,
): string | undefined {
  return resolveOpenAiTransportReasoningEffortForContext(config.reasoningEffort, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
    transportKind: "openai-compatible",
  });
}

export function openAiReasoningMode(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "reasoningMode">,
): ModelReasoningMode | undefined {
  return resolveOpenAiTransportReasoningModeForContext(config.reasoningMode, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
  });
}

function buildOpenAiGpt56ReasoningBody(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "reasoningEffort" | "reasoningMode">,
): Record<string, unknown> | undefined {
  if (
    !modelSupportsOpenAiGpt56ReasoningControls({
      ...(config.llmVendor ? { provider: config.llmVendor } : {}),
      model: config.model,
    })
  ) {
    return undefined;
  }

  const mode = openAiReasoningMode(config);
  const effort = openAiReasoningEffort(config);
  if (mode === undefined && effort === undefined) {
    return undefined;
  }

  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
}

export function openAiVendorChatCompletionBodyExtras(
  config: Pick<
    OpenAiTransportConfig,
    | "llmVendor"
    | "model"
    | "reasoningEffort"
    | "reasoningMode"
    | "vendorExtendedThinking"
    | "transportRequestProfile"
    | "supportsThinkingSwitch"
  >,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (config.llmVendor === "meituan" && config.supportsThinkingSwitch === true) {
    const enabled = config.vendorExtendedThinking !== false;
    extras.thinking = { type: enabled ? "enabled" : "disabled" };
  } else if (
    config.llmVendor === "deepseek" ||
    config.llmVendor === "z-ai" ||
    config.llmVendor === "zhipu-ai" ||
    config.llmVendor === "xiaomi" ||
    isArkLlmVendor(config.llmVendor)
  ) {
    const enabled = config.vendorExtendedThinking !== false;
    extras.thinking = { type: enabled ? "enabled" : "disabled" };
  } else if (
    config.llmVendor === "tencent-tokenhub" &&
    !isThinkingSwitchDisabledModel(config.model)
  ) {
    const enabled = config.vendorExtendedThinking !== false;
    extras.thinking = { type: enabled ? "enabled" : "disabled" };
  }

  if (config.llmVendor === "siliconflow" && config.transportRequestProfile === "code-completion") {
    extras.enable_thinking = false;
  } else if (config.llmVendor === "siliconflow" && config.vendorExtendedThinking === false) {
    extras.enable_thinking = false;
  }

  const openRouterReasoning = buildOpenRouterClaudeReasoningBody(config);
  if (openRouterReasoning !== undefined) {
    extras.reasoning = openRouterReasoning;
  } else {
    const gpt56Reasoning = buildOpenAiGpt56ReasoningBody(config);
    if (gpt56Reasoning !== undefined) {
      extras.reasoning = gpt56Reasoning;
    }
  }

  return extras;
}

/** Ark streaming Chat Completions only returns usage in the final chunk when the request body carries stream_options. */
export function openAiStreamingUsageBodyExtras(
  config: Pick<OpenAiTransportConfig, "llmVendor">,
  stream: boolean,
): Record<string, unknown> {
  if (!stream || !isArkLlmVendor(config.llmVendor)) {
    return {};
  }

  return {
    stream_options: {
      include_usage: true,
    },
  };
}

export function buildOpenAiRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const openRouterClaude = isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model);
  const gpt56Reasoning = openRouterClaude ? undefined : buildOpenAiGpt56ReasoningBody(config);
  const reasoningEffort =
    openRouterClaude || gpt56Reasoning !== undefined ? undefined : openAiReasoningEffort(config);
  const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
  const streamingUsageExtras = openAiStreamingUsageBodyExtras(config, stream);
  const trace: OpenAiRequestTrace = {
    kind: "openai_sdk_chat_completions",
    stepIndex,
    model: config.model,
    stream,
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    ...(gpt56Reasoning !== undefined ? { reasoning: gpt56Reasoning as JsonValue } : {}),
    ...(openRouterClaude && vendorExtras.reasoning !== undefined
      ? { reasoning: vendorExtras.reasoning as JsonValue }
      : {}),
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? {
          toolChoice: "auto",
          tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)),
        }
      : {}),
    ...(Object.keys(vendorExtras).length > 0 ? { vendorExtras: vendorExtras as JsonValue } : {}),
    ...(Object.keys(streamingUsageExtras).length > 0
      ? { streamingUsageExtras: streamingUsageExtras as JsonValue }
      : {}),
  };

  return [trace];
}
