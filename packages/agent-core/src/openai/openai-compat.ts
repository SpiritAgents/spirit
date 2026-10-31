import type { JsonObject, JsonValue } from "../ports.js";
import type { FileUploadConfig } from "../file-upload/uploader.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  ThinkingSwitchDeclaration,
  TransportRequestProfile,
} from "../llm-provider-shared.js";
import type { ModelServiceTier, ModelServiceTiersDeclaration } from "../model-service-tier.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import { resolveDeclaredReasoningEffort, type ModelReasoningMode } from "../reasoning-effort.js";
import { cloneJsonValue } from "../tool-agent.js";

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
   * The declared `capabilities` of the model entry are the only source; undeclared models are left
   * as-is, with no arbitrary downgrade.
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
  /** Declared image API shape name (`imageApi`); selects the generation backend. Absent = `openai-images`. */
  imageApi?: string;
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
  /** Declared video API shape name (`videoApi`); selects the generation backend (fail-fast). */
  videoApi?: string;
  modelCapabilities?: OpenAiModelCapabilities;
  /** Hugging Face Inference Providers routing hint (resolved from the Hub catalog). */
  inferenceProvider?: string;
}

export interface OpenAiTransportConfig extends LlmWebToolExposure {
  transportKind?: "openai-compatible";
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  /**
   * Declared model capabilities; when present, they are the only source for compatibility
   * decisions such as image input trimming.
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
   * Declared reasoning effort selection; sent to the wire verbatim. `default`/absent sends nothing.
   */
  reasoningEffort?: "default" | "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max";
  effortSemantics?: "output";
  /** Output-wide effort used by declarations such as OpenRouter's unified reasoning adapter. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Declared reasoning mode; only `"pro"` produces a wire parameter (Open Responses `reasoning`). */
  reasoningMode?: ModelReasoningMode;
  /**
   * User thinking-switch state: `false` selects the `thinkingSwitch.off` encoding (or the
   * transport default disable encoding when no off patch is declared). Absent = on.
   */
  vendorExtendedThinking?: boolean;
  /**
   * Catalog flag: the model supports the thinking on/off switch. Capability marker for pickers;
   * the wire encoding is declared by `thinkingSwitch`.
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
  /**
   * Selected service tier (validated at config load). The wire effect comes from the fixed
   * transport API table (simple form) or the tier's literal `serviceTiers` declaration.
   */
  serviceTier?: ModelServiceTier;
  /** Declared service tiers: a tier-name list or a literal map with wire effects and input limits. */
  serviceTiers?: ModelServiceTiersDeclaration;
  /** Runtime-only last upstream input usage used by conditional tiers; never persisted in config.json. */
  lastInputTokens?: number;
  /** Full npm package name of the SDK adapter (e.g. `@ai-sdk/openai-compatible`); absent = default for the transport kind. */
  sdk?: string;
  /** Literal extra headers merged into every outbound request; explicit declarations win on conflicts. */
  headers?: Record<string, string>;
  /** Literal fields merged unconditionally into every request body top level; escape hatch, prefer structured declarations. */
  body?: JsonObject;
  /** Declared provider tools; injected, recognized, and executed purely by declaration. */
  providerTools?: ProviderToolEntry[];
  /** Declared generic upload channel; absent = media inputs use the transport's inline path. */
  fileUpload?: FileUploadConfig;
  /** Transport option namespace (e.g. `toolsRejectReasoningEffort` / `maxInlineMediaBytes`); the valid key set is defined by transportKind × sdk, unknown keys are rejected. */
  options?: Record<string, unknown>;
  /** Declared output token limit for the model; mapped to the transport's wire parameter (`max_tokens` here). */
  outputLimit?: number;
  /** Declared reasoning mode set; the picker and validation source for `reasoningMode`. */
  supportedReasoningModes?: readonly ModelReasoningMode[];
  /** Declared wire encoding of the thinking on/off switch; absent = transport default encoding. */
  thinkingSwitch?: ThinkingSwitchDeclaration;
}

export interface OpenAiRequestTrace extends JsonObject {
  kind: "openai_sdk_chat_completions";
  stepIndex: number;
  model: string;
  stream: boolean;
  /** Configured per-model service tier preference (requested preference, not the upstream-granted tier). */
  serviceTier?: ModelServiceTier;
  /** Declared reasoning effort as sent on the wire (`reasoning_effort`). */
  reasoning_effort?: JsonValue;
  toolChoice?: "auto";
  messages: JsonValue[];
  tools?: JsonValue[];
}

export function resolveOpenAiModelCompatibilityProfile(
  config: Pick<OpenAiTransportConfig, "model" | "modelCapabilities">,
): OpenAiModelCompatibilityProfile {
  if (config.modelCapabilities !== undefined) {
    return {
      hasExplicitCapabilities: true,
      capabilities: { ...config.modelCapabilities },
    };
  }

  return {
    hasExplicitCapabilities: false,
    capabilities: {},
  };
}

/**
 * The declared reasoning effort for the wire, verbatim; `default`/absent leaves it to the upstream
 * or the model's default behavior. Maps to the chat.completions `reasoning_effort` field.
 */
export function openAiReasoningEffort(
  config: Pick<OpenAiTransportConfig, "reasoningEffort">,
): string | undefined {
  return resolveDeclaredReasoningEffort(config.reasoningEffort);
}

export function buildOpenAiRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const reasoningEffort = openAiReasoningEffort(config);
  const trace: OpenAiRequestTrace = {
    kind: "openai_sdk_chat_completions",
    stepIndex,
    model: config.model,
    stream,
    ...(config.serviceTier === undefined ? {} : { serviceTier: config.serviceTier }),
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? {
          toolChoice: "auto",
          tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)),
        }
      : {}),
  };

  return [trace];
}
