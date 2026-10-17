import type { JsonObject, JsonValue, AgentMode } from "../ports.js";
import type { FileUploadConfig } from "../file-upload/uploader.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  ThinkingSwitchDeclaration,
  TransportRequestProfile,
} from "../llm-provider-shared.js";
import type { ModelServiceTier } from "../model-service-tier.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import type {
  OpenAiImageGenerationConfig,
  OpenAiLlmVendor,
  OpenAiVideoGenerationConfig,
} from "../openai/openai-compat.js";
import { isGatewayAnthropicClaudeModel } from "../openai/gateway-anthropic-thinking.js";
import {
  buildOpenRouterClaudeReasoningBody,
  isOpenRouterAnthropicClaudeModel,
} from "../openai/openrouter-anthropic-reasoning.js";
import { resolveOpenAiTransportReasoningEffortForContext } from "../reasoning-effort.js";
import {
  resolveOpenAiTransportReasoningModeForContext,
  type ModelReasoningMode,
} from "../openai/gpt-reasoning-controls.js";
import { extractAzureResourceNameFromApiBase } from "../azure-resource.js";
import { cloneJsonValue } from "../tool-agent.js";
import { isArkLlmVendor } from "../ark/ark-provider.js";

/** Underlying AI SDK provider: official OpenAI Responses, official Azure Responses, or an Open Responses compatible endpoint. */
export type OpenResponsesSdkProvider = "openai" | "xai" | "azure" | "open-responses-compatible";

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
  /**
   * Aligned with the host `ModelProfile.provider`; used to infer the default `responsesProvider`.
   */
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: LlmModelCapabilities;
  /**
   * Explicitly selects the underlying SDK. Default: `openai` → official OpenAI, `xai` → official `@ai-sdk/xai`,
   * Gateway `openai/*` → `@ai-sdk/openai`, all other Gateway routes and vendors → `open-responses-compatible`.
   */
  responsesProvider?: OpenResponsesSdkProvider;
  /** Official OpenAI Responses: whether the conversation is stored server-side by OpenAI. Defaults to true when unset. */
  store?: boolean;
  /** @deprecated Determined by responsesUsesStoredState; field kept only for compatibility with serialized legacy configs. */
  previousResponseMode?: OpenResponsesPreviousResponseMode;
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
  /** Azure resource name; aligned with `@ai-sdk/azure`'s `resourceName`. */
  azureResourceName?: string;
  /** Cloudflare AI Gateway name; injected as `cf-aig-gateway-id` on requests. */
  cloudflareGatewayId?: string;
  /** Request policy profile for non-agent lightweight requests such as code completion; defaults to the agent path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /** Vendor extended thinking; false disables the Claude / DeepSeek style thinking toggle. */
  vendorExtendedThinking?: boolean;
  /**
   * Per-model service tier preference (canonical Spirit value). Mapped to provider-specific
   * request fields at request time; unsupported combinations are rejected at config parse time.
   */
  serviceTier?: ModelServiceTier;
  /**
   * Aggregator upstream identity fact from the model catalog (Vercel `owned_by` / OpenRouter
   * `canonical_slug` author prefix); used to map `serviceTier` behind aggregator routes.
   */
  upstreamProvider?: string;
  /** Full npm package name of the SDK adapter (e.g. `@ai-sdk/openai`); absent = inferred by `resolveOpenResponsesSdkProvider`. */
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
  /** Declared output token limit for the model. */
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
  | "open_responses_sdk_responses"
  | "alibaba_open_responses"
  | "deepseek_open_responses";

export interface OpenResponsesRequestTrace extends JsonObject {
  kind: OpenResponsesRequestTraceKind;
  stepIndex: number;
  model: string;
  stream: boolean;
  /** Configured per-model service tier preference (requested preference, not the upstream-granted tier). */
  serviceTier?: ModelServiceTier;
  input?: JsonValue;
  tools?: JsonValue[];
  store?: boolean;
  previousResponseId?: string;
  reasoning?: JsonValue;
  truncation?: string;
}

/**
 * Strips Gateway-style `openai/` routing prefix. Other vendor prefixes return undefined.
 */
export function normalizeGatewayOpenAiModelId(model: string): string | undefined {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  const prefix = "openai/";
  if (!lower.startsWith(prefix)) {
    return undefined;
  }

  return trimmed.slice(prefix.length).trim();
}

export function isGatewayOpenAiRoutedModel(model: string): boolean {
  return normalizeGatewayOpenAiModelId(model) !== undefined;
}

/**
 * Aggregators uniformly strip the `openai/*` model id (`resolveOpenResponsesLanguageModelId` etc.).
 * Do not use for apply_patch shape decisions: Gateway uses a function tool, OpenRouter uses built-in (see apply-patch-eligibility).
 */
export function isAggregatedOpenAiRoutedVendor(
  llmVendor: OpenAiLlmVendor | undefined,
): llmVendor is "vercel-ai-gateway" | "cloudflare-ai-gateway" | "openrouter" {
  return (
    llmVendor === "vercel-ai-gateway" ||
    llmVendor === "cloudflare-ai-gateway" ||
    llmVendor === "openrouter"
  );
}

/**
 * Model id passed to `@ai-sdk/openai` / `@ai-sdk/xai` language model factories.
 * Gateway OpenAI routes use the stripped id (e.g. `gpt-5.1` from `openai/gpt-5.1`).
 */
export function resolveOpenResponsesLanguageModelId(
  config: Pick<OpenResponsesTransportConfig, "model" | "llmVendor">,
): string {
  if (isAggregatedOpenAiRoutedVendor(config.llmVendor)) {
    const routed = normalizeGatewayOpenAiModelId(config.model);
    if (routed) {
      return routed;
    }
  }

  return config.model;
}

/** Bedrock Mantle Open Responses (e.g. openai.gpt-5.5 @ bedrock-mantle.*.api.aws/openai/v1). */
export function isBedrockMantleOpenResponsesConfig(
  config: Pick<OpenResponsesTransportConfig, "baseUrl" | "model">,
): boolean {
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? "";
  if (baseUrl.includes("bedrock-mantle.") && baseUrl.includes("/openai/")) {
    return true;
  }

  return /^openai\.gpt-/i.test(config.model.trim());
}

export function resolveOpenResponsesSdkProvider(
  config: Pick<OpenResponsesTransportConfig, "llmVendor" | "responsesProvider" | "model">,
): OpenResponsesSdkProvider {
  // Honor an explicit choice (including `openai`) when the caller sets one.
  if (config.responsesProvider !== undefined) {
    return config.responsesProvider;
  }

  if (config.llmVendor === "openai") {
    return "openai";
  }

  if (config.llmVendor === "xai") {
    return "xai";
  }

  if (config.llmVendor === "azure") {
    return "azure";
  }

  // Gateway-routed OpenAI models (e.g. `openai/gpt-5.4`) MUST use the generic
  // `@ai-sdk/open-responses` provider, not `@ai-sdk/openai`. The latter assumes a
  // direct OpenAI endpoint: it strips the `openai/` routing prefix and injects
  // direct-only request shaping, which makes the Vercel AI Gateway silently stop
  // streaming reasoning summaries. apply_patch stays available via the flat
  // function-tool path (shouldUseApplyPatchFunctionTool).
  return "open-responses-compatible";
}

export function openResponsesReasoningEffort(
  config: Pick<OpenResponsesTransportConfig, "llmVendor" | "model" | "reasoningEffort">,
): string | undefined {
  return resolveOpenAiTransportReasoningEffortForContext(config.reasoningEffort, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
    transportKind: "open-responses",
  });
}

/**
 * Resolves whether to request a reasoning summary from Responses.
 * When not explicitly configured: disabled when reasoningEffort is none, otherwise defaults to auto (so the UI can show the thinking summary).
 */
export function resolveOpenResponsesReasoningSummary(
  config: Pick<
    OpenResponsesTransportConfig,
    "baseUrl" | "llmVendor" | "model" | "reasoningEffort" | "reasoningSummary"
  >,
): OpenResponsesReasoningSummary | undefined {
  if (isBedrockMantleOpenResponsesConfig(config)) {
    return undefined;
  }

  // Ark Responses only supports reasoning.effort and rejects OpenAI-style reasoning.summary.
  if (
    isArkLlmVendor(config.llmVendor) ||
    config.llmVendor === "stepfun" ||
    config.llmVendor === "deepseek"
  ) {
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

export function openResponsesReasoningMode(
  config: Pick<OpenResponsesTransportConfig, "llmVendor" | "model" | "reasoningMode">,
): ModelReasoningMode | undefined {
  return resolveOpenAiTransportReasoningModeForContext(config.reasoningMode, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
  });
}

export function openResponsesReasoningTrace(
  config: Pick<
    OpenResponsesTransportConfig,
    "llmVendor" | "model" | "reasoningEffort" | "reasoningMode" | "reasoningSummary"
  >,
): JsonObject | undefined {
  if (isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
    return undefined;
  }

  if (isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model)) {
    const reasoning = buildOpenRouterClaudeReasoningBody(config);
    return reasoning;
  }

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
  const provider = resolveOpenResponsesSdkProvider(config);
  const kind: OpenResponsesRequestTraceKind =
    config.llmVendor === "deepseek" && provider === "open-responses-compatible"
      ? "deepseek_open_responses"
      : config.llmVendor === "alibaba" && provider === "open-responses-compatible"
        ? "alibaba_open_responses"
        : provider === "openai"
          ? "openai_sdk_responses"
          : provider === "xai"
            ? "xai_sdk_responses"
            : provider === "azure"
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
    ...(extras?.previousResponseId ? { previousResponseId: extras.previousResponseId } : {}),
    ...(extras?.reasoning !== undefined ? { reasoning: extras.reasoning } : {}),
    ...(extras?.truncation ? { truncation: extras.truncation } : {}),
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

export function resolveAzureResourceName(
  config: Pick<OpenResponsesTransportConfig, "azureResourceName" | "baseUrl">,
): string {
  const explicit = config.azureResourceName?.trim();
  if (explicit) {
    return explicit;
  }

  const fromBase = extractAzureResourceNameFromApiBase(config.baseUrl ?? "");
  if (fromBase) {
    return fromBase;
  }

  throw new Error("Azure azureResourceName configuration is missing.");
}
