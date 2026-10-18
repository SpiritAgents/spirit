import type { JsonObject, JsonValue, AgentMode } from "../ports.js";
import type { FileUploadConfig } from "../file-upload/uploader.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  ThinkingSwitchDeclaration,
  TransportRequestProfile,
} from "../llm-provider-shared.js";
import type { ModelServiceTier, ModelServiceTiersDeclaration } from "../model-service-tier.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import type {
  OpenAiImageGenerationConfig,
  OpenAiVideoGenerationConfig,
} from "../openai/openai-compat.js";
import {
  resolveDeclaredReasoningEffort,
  resolveDeclaredReasoningMode,
  type ModelReasoningMode,
} from "../reasoning-effort.js";
import { extractAzureResourceNameFromApiBase } from "../azure-resource.js";
import { cloneJsonValue } from "../tool-agent.js";

export type OpenResponsesPreviousResponseMode = "disabled" | "stored" | "stateless";

export type OpenResponsesReasoningSummary = "auto" | "detailed" | "off";

export interface OpenResponsesTransportConfig extends LlmWebToolExposure {
  transportKind: "open-responses";
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  modelCapabilities?: LlmModelCapabilities;
  /** Official OpenAI Responses: whether the conversation is stored server-side by OpenAI. Defaults to true when unset. */
  store?: boolean;
  /** @deprecated Determined by responsesUsesStoredState; field kept only for compatibility with serialized legacy configs. */
  previousResponseMode?: OpenResponsesPreviousResponseMode;
  /** Declared reasoning effort selection; sent to the wire verbatim. `default`/absent sends nothing. */
  reasoningEffort?: "default" | "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max";
  reasoningMode?: ModelReasoningMode;
  reasoningSummary?: OpenResponsesReasoningSummary;
  truncation?: "disabled" | "auto";
  /** Host run mode; Ask disables apply_patch injection. */
  agentMode?: AgentMode;
  /** Optional dedicated model role used by the `generate_image` tool. */
  imageGeneration?: OpenAiImageGenerationConfig;
  /** Optional dedicated model role used by the `generate_video` tool. */
  videoGeneration?: OpenAiVideoGenerationConfig;
  /**
   * Bedrock Mantle Open Responses: generates a short-lived token via IAM when there is no static Bearer.
   * A static `apiKey` takes precedence; with neither, the request fails at the SDK layer.
   */
  bedrockMantleIam?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Request policy profile for non-agent lightweight requests such as code completion; defaults to the agent path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /** User thinking-switch state: `false` selects the `thinkingSwitch.off` encoding. Absent = on. */
  vendorExtendedThinking?: boolean;
  /**
   * Selected service tier (validated at config load). The wire effect comes from the fixed
   * transport API table (simple form) or the tier's literal `serviceTiers` declaration.
   */
  serviceTier?: ModelServiceTier;
  /** Declared service tiers: a tier-name list (simple form) or a tier → wire-patch map (literal). */
  serviceTiers?: ModelServiceTiersDeclaration;
  /** Full npm package name of the SDK adapter (e.g. `@ai-sdk/openai`); absent = the generic `@ai-sdk/open-responses` adapter. */
  sdk?: string;
  /** Literal extra headers merged into every outbound request; explicit declarations win on conflicts. */
  headers?: Record<string, string>;
  /** Literal fields merged unconditionally into every request body top level; escape hatch, prefer structured declarations. */
  body?: JsonObject;
  /** Declared provider tools; injected, recognized, and executed purely by declaration. */
  providerTools?: ProviderToolEntry[];
  /** Declared generic upload channel; absent = media inputs use the transport's inline path. */
  fileUpload?: FileUploadConfig;
  /** Transport option namespace (`auth` / `storedState` / `applyPatch`); unknown keys are rejected at config load. */
  options?: Record<string, unknown>;
  /** Declared output token limit for the model; mapped to the Responses `max_output_tokens` parameter. */
  outputLimit?: number;
  /** Declared reasoning mode set; the picker and validation source for `reasoningMode`. */
  supportedReasoningModes?: readonly ModelReasoningMode[];
  /** Declared wire encoding of the thinking on/off switch; absent = transport default encoding. */
  thinkingSwitch?: ThinkingSwitchDeclaration;
}

export type OpenResponsesRequestTraceKind =
  | "openai_sdk_responses"
  | "xai_sdk_responses"
  | "azure_sdk_responses"
  | "open_responses_sdk_responses";

export interface OpenResponsesRequestTrace extends JsonObject {
  kind: OpenResponsesRequestTraceKind;
  stepIndex: number;
  model: string;
  stream: boolean;
  /** Configured per-model service tier preference (requested preference, not the upstream-granted tier). */
  serviceTier?: ModelServiceTier;
  input?: JsonValue[];
  tools?: JsonValue[];
  store?: boolean;
  previousResponseId?: string;
  reasoning?: JsonValue;
  truncation?: string;
}

/**
 * Model id passed to the adapter's language model factory. Gateway-routed models keep their
 * `openai/` prefix: the gateway adapter needs it for routing, and `@ai-sdk/openai` is never used
 * for gateway-routed models (it assumes a direct OpenAI endpoint, strips the routing prefix, and
 * injects direct-only request shaping).
 */
export function resolveOpenResponsesLanguageModelId(
  config: Pick<OpenResponsesTransportConfig, "model">,
): string {
  return config.model;
}

/** `options.auth: "aws-sigv4"`: the Bedrock Mantle Open Responses surface (SigV4 IAM auth). */
export function isAwsSigV4AuthConfig(
  config: Pick<OpenResponsesTransportConfig, "options">,
): boolean {
  return config.options?.auth === "aws-sigv4";
}

/** The declared reasoning effort for the wire, verbatim; `default`/absent sends nothing. */
export function openResponsesReasoningEffort(
  config: Pick<OpenResponsesTransportConfig, "reasoningEffort">,
): string | undefined {
  return resolveDeclaredReasoningEffort(config.reasoningEffort);
}

/** The declared reasoning mode for the wire; only `"pro"` is sent. */
export function openResponsesReasoningMode(
  config: Pick<OpenResponsesTransportConfig, "reasoningMode">,
): ModelReasoningMode | undefined {
  return resolveDeclaredReasoningMode(config.reasoningMode);
}

/**
 * Responses-protocol adapters whose wire honors `reasoning.summary` (mechanism-keyed on the
 * declared `sdk` package). Other adapters silently drop or reject the field, so nothing is sent.
 */
const RESPONSES_REASONING_SUMMARY_SDKS: ReadonlySet<string> = new Set([
  "@ai-sdk/openai",
  "@ai-sdk/azure",
  "@ai-sdk/xai",
  "@ai-sdk/open-responses",
  "@ai-sdk/gateway",
]);

/**
 * Resolves whether to request a reasoning summary from Responses.
 * When not explicitly configured: disabled when reasoningEffort is none, otherwise defaults to auto (so the UI can show the thinking summary).
 */
export function resolveOpenResponsesReasoningSummary(
  config: Pick<
    OpenResponsesTransportConfig,
    "reasoningEffort" | "reasoningSummary" | "sdk" | "options"
  >,
): OpenResponsesReasoningSummary | undefined {
  // The SigV4 (Bedrock Mantle) Open Responses surface has no reasoning summary support.
  if (isAwsSigV4AuthConfig(config)) {
    return undefined;
  }

  if (!RESPONSES_REASONING_SUMMARY_SDKS.has(config.sdk ?? "@ai-sdk/open-responses")) {
    return undefined;
  }

  if (config.reasoningSummary === "off" || config.reasoningEffort === "none") {
    return undefined;
  }

  if (config.reasoningSummary === "auto" || config.reasoningSummary === "detailed") {
    return config.reasoningSummary;
  }

  return "auto";
}

export function openResponsesReasoningTrace(
  config: Pick<
    OpenResponsesTransportConfig,
    "model" | "reasoningEffort" | "reasoningMode" | "reasoningSummary" | "sdk" | "options"
  >,
): JsonObject | undefined {
  const effort = openResponsesReasoningEffort(config);
  const mode = openResponsesReasoningMode(config);
  const summary = resolveOpenResponsesReasoningSummary(config);
  if (effort === undefined && mode === undefined && summary === undefined) {
    return undefined;
  }

  return {
    ...(effort !== undefined ? { effort } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

export function buildOpenResponsesTraceExtras(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Pick<OpenResponsesRequestTrace, "store" | "previousResponseId" | "reasoning" | "truncation"> {
  const reasoning = openResponsesReasoningTrace(config);

  return {
    ...(config.store !== undefined ? { store: config.store } : {}),
    ...(previousResponseId ? { previousResponseId } : {}),
    ...(config.truncation ? { truncation: config.truncation } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

export function buildOpenResponsesRequestTrace(
  config: OpenResponsesTransportConfig,
  stepIndex: number,
  input: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
  extras?: Pick<
    OpenResponsesRequestTrace,
    "store" | "previousResponseId" | "reasoning" | "truncation"
  >,
): JsonValue[] {
  const kind: OpenResponsesRequestTraceKind =
    config.sdk === "@ai-sdk/openai"
      ? "openai_sdk_responses"
      : config.sdk === "@ai-sdk/xai"
        ? "xai_sdk_responses"
        : config.sdk === "@ai-sdk/azure"
          ? "azure_sdk_responses"
          : "open_responses_sdk_responses";

  const trace: OpenResponsesRequestTrace = {
    kind,
    stepIndex,
    model: config.model,
    stream,
    ...(config.serviceTier !== undefined ? { serviceTier: config.serviceTier } : {}),
    input: input.map((item) => cloneJsonValue(item)),
    ...(tools.length > 0 ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) } : {}),
    ...(extras?.store !== undefined ? { store: extras.store } : {}),
    ...(extras?.previousResponseId !== undefined
      ? { previousResponseId: extras.previousResponseId }
      : {}),
    ...(extras?.reasoning !== undefined ? { reasoning: extras.reasoning } : {}),
    ...(extras?.truncation !== undefined ? { truncation: extras.truncation } : {}),
  };

  return [trace];
}

export function normalizeOpenResponsesApiBase(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "https://api.openai.com/v1";
}

export function openResponsesPostUrl(baseUrl: string | undefined): string {
  const normalized = normalizeOpenResponsesApiBase(baseUrl);
  return normalized.endsWith("/responses") ? normalized : `${normalized}/responses`;
}

/**
 * The `@ai-sdk/azure` adapter's `resourceName`: parsed from the materialized apiBase
 * (`https://{resourceName}.openai.azure.com/openai/v1`).
 */
export function resolveAzureResourceName(
  config: Pick<OpenResponsesTransportConfig, "baseUrl">,
): string {
  const fromBase = extractAzureResourceNameFromApiBase(config.baseUrl ?? "");
  if (fromBase) {
    return fromBase;
  }

  throw new Error(
    "Azure resource name cannot be parsed from apiBase (expected https://{resourceName}.openai.azure.com/...).",
  );
}
