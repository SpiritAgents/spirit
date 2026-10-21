import { isCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import type { FileUploadConfig } from "../file-upload/uploader.js";
import type { ModelReasoningMode } from "../reasoning-effort.js";
import type { JsonObject, JsonValue } from "../ports.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import { cloneJsonValue } from "../tool-agent.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  ThinkingSwitchDeclaration,
  TransportRequestProfile,
} from "../llm-provider-shared.js";
import type { ModelServiceTier, ModelServiceTiersDeclaration } from "../model-service-tier.js";

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
  /** Declared reasoning effort, already filtered to the Anthropic protocol enum at config load. */
  effort?: AnthropicEffort;
  /**
   * Declared supported effort list (config `supportedReasoningEfforts` filtered to the protocol
   * enum). Reserved for picker-facing plumbing; the transport does not infer thinking from it.
   */
  supportedEfforts?: readonly AnthropicEffort[];
  sendReasoning?: boolean;
  disableParallelToolUse?: boolean;
  structuredOutputMode?: AnthropicStructuredOutputMode;
  /** Policy profile for lightweight non-Agent requests such as code completion; defaults to agent-path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /**
   * Catalog flag: the model supports the thinking on/off switch. Capability marker for pickers;
   * the wire encoding is declared by `thinkingSwitch`.
   */
  supportsThinkingSwitch?: boolean;
  /** User thinking-switch state: `false` selects the `thinkingSwitch.off` encoding (default: the protocol's `{type: "disabled"}`). */
  vendorExtendedThinking?: boolean;
  /**
   * Selected service tier (validated at config load). `fast` maps to the Messages API's public
   * `speed` parameter; other mappings arrive via literal `serviceTiers` declarations.
   */
  serviceTier?: ModelServiceTier;
  /** Declared service tiers: a tier-name list (simple form) or a tier → wire-patch map (literal). */
  serviceTiers?: ModelServiceTiersDeclaration;
  /** Full npm package name of the SDK adapter (e.g. `@ai-sdk/anthropic`); absent = default for the transport kind. */
  sdk?: string;
  /** Literal extra headers merged into every outbound request; explicit declarations win on conflicts. */
  headers?: Record<string, string>;
  /** Literal fields merged unconditionally into every request body top level; escape hatch, prefer structured declarations. */
  body?: JsonObject;
  /** Declared provider tools; injected, recognized, and executed purely by declaration. */
  providerTools?: ProviderToolEntry[];
  /** Declared generic upload channel; absent = media inputs use the transport's inline path. */
  fileUpload?: FileUploadConfig;
  /** Transport option namespace; the valid key set is defined by transportKind × sdk, unknown keys are rejected. */
  options?: Record<string, unknown>;
  /** Declared output token limit for the model; mapped to the Messages `max_tokens` parameter. */
  outputLimit?: number;
  /** Declared reasoning mode; `"standard"` or absent sends nothing on the wire. */
  reasoningMode?: ModelReasoningMode;
  /** Declared reasoning mode set; the picker and validation source for `reasoningMode`. */
  supportedReasoningModes?: readonly ModelReasoningMode[];
  /** Declared wire encoding of the thinking on/off switch; absent = transport default encoding. */
  thinkingSwitch?: ThinkingSwitchDeclaration;
}

export interface AnthropicRequestTrace extends JsonObject {
  kind: "anthropic_sdk_messages";
  stepIndex: number;
  model: string;
  stream: boolean;
  /** Configured per-model service tier preference (requested preference, not the upstream-granted tier). */
  serviceTier?: ModelServiceTier;
  messages: JsonValue[];
  tools?: JsonValue[];
  providerOptions?: JsonValue;
}

/**
 * Transport default thinking encoding: the code-completion profile and the user-off state send
 * the protocol's `{type: "disabled"}`; otherwise nothing is sent and the upstream default applies
 * (for adaptive-era Claude models that is thinking on). A declared `thinkingSwitch` state patch
 * overrides this encoding at the literal body merge layer.
 */
export function resolveAnthropicThinkingConfig(
  config: Pick<AnthropicTransportConfig, "vendorExtendedThinking" | "transportRequestProfile">,
): AnthropicThinkingConfig | undefined {
  if (isCodeCompletionTransportProfile(config)) {
    return { type: "disabled" };
  }

  if (config.vendorExtendedThinking === false) {
    return { type: "disabled" };
  }

  return undefined;
}

export function buildAnthropicProviderOptions(
  config: Pick<
    AnthropicTransportConfig,
    | "vendorExtendedThinking"
    | "effort"
    | "sendReasoning"
    | "disableParallelToolUse"
    | "structuredOutputMode"
    | "transportRequestProfile"
    | "serviceTier"
  >,
): Record<string, JsonObject> {
  const thinking = resolveAnthropicThinkingConfig(config);
  const options: JsonObject = {
    toolStreaming: true,
    ...(thinking !== undefined ? { thinking: thinking as unknown as JsonValue } : {}),
  };

  // Native Fast mode: the SDK maps speed "fast" onto the body and merges the fast-mode beta header.
  // Off/unset sends nothing (never `speed: "standard"`).
  if (config.serviceTier === "fast") {
    options.speed = "fast";
  }

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
  const providerOptions = buildAnthropicProviderOptions(config);
  const trace: AnthropicRequestTrace = {
    kind: "anthropic_sdk_messages",
    stepIndex,
    model: config.model,
    stream,
    ...(config.serviceTier === undefined ? {} : { serviceTier: config.serviceTier }),
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0 ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) } : {}),
    ...(Object.keys(providerOptions).length > 0
      ? { providerOptions: providerOptions as JsonValue }
      : {}),
  };

  return [trace];
}
