import type { AnthropicTransportConfig } from "../anthropic/anthropic-compat.js";
import type { BedrockTransportConfig } from "../bedrock/bedrock-compat.js";
import type { OpenAiTransportConfig } from "../openai/openai-compat.js";
import type { OpenResponsesTransportConfig } from "../open-responses/responses-compat.js";
import type { ThinkingSwitchDeclaration, TransportRequestProfile } from "../llm-provider-shared.js";
import type { LlmTransportConfig } from "../provider-config.js";
import {
  isAnthropicTransportConfig,
  isBedrockTransportConfig,
  isOpenAiCompatibleTransportConfig,
  isOpenResponsesTransportConfig,
} from "../provider-config.js";

export function isCodeCompletionTransportProfile(config: {
  transportRequestProfile?: TransportRequestProfile;
}): boolean {
  return config.transportRequestProfile === "code-completion";
}

function withCodeCompletionProfile<T extends LlmTransportConfig>(config: T): T {
  return {
    ...config,
    transportRequestProfile: "code-completion",
  };
}

/**
 * The completion path turns thinking off through the declared thinking-switch encoding: the off
 * state is only meaningful for models that declared the switch (`supportsThinkingSwitch` or a
 * `thinkingSwitch` block); other models have no thinking parameter to suppress.
 */
function withThinkingOff<
  T extends {
    supportsThinkingSwitch?: boolean;
    thinkingSwitch?: ThinkingSwitchDeclaration;
    vendorExtendedThinking?: boolean;
  },
>(config: T): T {
  if (
    config.supportsThinkingSwitch === false ||
    (config.supportsThinkingSwitch !== true && config.thinkingSwitch === undefined)
  ) {
    return config;
  }
  return {
    ...config,
    vendorExtendedThinking: false,
  };
}

/**
 * Chat adapters whose wire speaks an explicit `none` effort token (OpenAI-compatible
 * `reasoning_effort: "none"`; the Gemini adapters map it to `thinkingBudget: 0`). Other adapters
 * omit the reasoning parameter entirely (`default`).
 */
const CHAT_NONE_REASONING_EFFORT_SDKS: ReadonlySet<string> = new Set([
  "@ai-sdk/openai-compatible",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
]);

/** Responses adapters whose wire is the OpenAI Responses reasoning payload, which accepts `"none"`. */
const RESPONSES_NONE_REASONING_EFFORT_SDKS: ReadonlySet<string> = new Set([
  "@ai-sdk/openai",
  "@ai-sdk/azure",
  "@ai-sdk/xai",
  "@ai-sdk/gateway",
]);

function applyOpenAiCompatibleCodeCompletionProfile(
  config: OpenAiTransportConfig,
): OpenAiTransportConfig {
  const { effort: _effort, ...profiled } = withThinkingOff(withCodeCompletionProfile(config));
  return {
    ...profiled,
    reasoningEffort: CHAT_NONE_REASONING_EFFORT_SDKS.has(config.sdk ?? "@ai-sdk/openai-compatible")
      ? "none"
      : "default",
  };
}

function applyAnthropicCodeCompletionProfile(
  config: AnthropicTransportConfig,
): AnthropicTransportConfig {
  const { effort: _effort, ...withoutEffort } = withThinkingOff(withCodeCompletionProfile(config));
  return withoutEffort;
}

function applyOpenResponsesCodeCompletionProfile(
  config: OpenResponsesTransportConfig,
): OpenResponsesTransportConfig {
  const { effort: _effort, ...profiled } = withThinkingOff(withCodeCompletionProfile(config));
  return {
    ...profiled,
    reasoningEffort: RESPONSES_NONE_REASONING_EFFORT_SDKS.has(
      config.sdk ?? "@ai-sdk/open-responses",
    )
      ? "none"
      : "default",
    reasoningSummary: "off",
  };
}

function applyBedrockCodeCompletionProfile(config: BedrockTransportConfig): BedrockTransportConfig {
  const { effort: _effort, ...profiled } = withThinkingOff(withCodeCompletionProfile(config));
  return {
    ...profiled,
    reasoningEffort: "none",
  };
}

/**
 * Marks any transport config as a code-completion request profile and suppresses reasoning:
 * thinking off via the declared switch encoding (or the transport default), and the reasoning
 * effort parameter omitted — or pinned to the wire's explicit `none` token where the declared
 * adapter speaks one.
 */
export function applyCodeCompletionTransportProfile(
  config: LlmTransportConfig,
): LlmTransportConfig {
  if (isAnthropicTransportConfig(config)) {
    return applyAnthropicCodeCompletionProfile(config);
  }
  if (isOpenResponsesTransportConfig(config)) {
    return applyOpenResponsesCodeCompletionProfile(config);
  }
  if (isBedrockTransportConfig(config)) {
    return applyBedrockCodeCompletionProfile(config);
  }
  if (isOpenAiCompatibleTransportConfig(config)) {
    return applyOpenAiCompatibleCodeCompletionProfile(config);
  }
  return withCodeCompletionProfile(config);
}
