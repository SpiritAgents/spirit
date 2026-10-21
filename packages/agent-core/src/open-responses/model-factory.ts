import { createGateway } from "@ai-sdk/gateway";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createXai } from "@ai-sdk/xai";
import { createHuggingFace } from "@ai-sdk/huggingface";

import { getLlmFetch } from "../llm-fetch.js";
import { createDeclaredWireMergeFetch } from "../llm-declared-wire-fetch.js";
import {
  mergeServiceTierProviderOptions,
  resolveServiceTierRequestPlan,
  type ServiceTierRequestPlan,
  type ServiceTierRequestSurface,
} from "../service-tier-request.js";
import type { JsonObject } from "../ports.js";
import {
  EMPTY_RESOLVED_PROVIDER_TOOLS,
  type ResolvedProviderTools,
} from "../provider-tools/runtime.js";
import { createProviderToolsWireFetch } from "../provider-tools/wire-fetch.js";
import {
  createResponsesStoredStateAwareFetch,
  shouldUseResponsesStoredStateFetch,
} from "./responses-stored-state-fetch.js";
import { createEchoServerToolCallsFetch } from "./echo-server-tool-calls.js";
import { createDefaultInputItemStatusFetch } from "./responses-input-item-status.js";
import { createApplyPatchAwareFetch } from "./apply-patch-responses-fetch.js";
import {
  resolveBedrockMantleOpenResponsesApiKey,
  wrapFetchForBedrockMantleIamAuth,
} from "./bedrock-mantle-auth-fetch.js";
import {
  buildResponsesAiSdkTools,
  type OpenAiFunctionToolDefinition,
} from "./ai-sdk-message-bridge.js";
import {
  buildApplyPatchFunctionToolDefinition,
  shouldUseApplyPatchFileTools,
  shouldUseApplyPatchFunctionTool,
  shouldUseOpenAiSdkApplyPatchTool,
} from "./apply-patch-eligibility.js";
import { responsesUsesStoredState } from "./responses-incremental-input.js";
import { createOpenRouterAnthropicReasoningFetch } from "../openrouter-anthropic-reasoning.js";
import { buildGatewayV3ProviderOptions } from "./gateway-v3-provider-options.js";
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  openResponsesReasoningMode,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
  resolveAzureResourceName,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";

/**
 * Provider-options namespace of the generic `@ai-sdk/open-responses` adapter; the factory name and
 * the options key must stay in sync for the adapter to pick the values up.
 */
const OPEN_RESPONSES_GENERIC_PROVIDER_NAME = "spirit";

/**
 * The bundled adapter set for the open-responses transport, keyed by the declared `sdk` npm
 * package name. Unknown values are a fail-fast config error.
 */
export const OPEN_RESPONSES_SDK_ADAPTER_PACKAGES = [
  "@ai-sdk/openai",
  "@ai-sdk/xai",
  "@ai-sdk/azure",
  "@ai-sdk/gateway",
  "@ai-sdk/huggingface",
  "@ai-sdk/open-responses",
] as const;

/** The local contract smoke maps the …/v1 mock to the Gateway SDK's …/v3/ai. */
function resolveGatewaySdkBaseUrl(config: OpenResponsesTransportConfig): string | undefined {
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return undefined;
    }
    url.pathname = "/v3/ai";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

/**
 * Per-request service tier plan for the open-responses transport. The `@ai-sdk/gateway` adapter
 * speaks the gateway v3 language-model protocol; everything else on this transport is a Responses
 * surface (official OpenAI SDK or generic Open Responses).
 */
function responsesServiceTierSurface(
  config: OpenResponsesTransportConfig,
): ServiceTierRequestSurface {
  return config.sdk === "@ai-sdk/gateway" ? "gateway-v3" : "responses";
}

function resolveResponsesServiceTierPlan(
  config: OpenResponsesTransportConfig,
): ServiceTierRequestPlan {
  if (config.serviceTier === undefined) {
    return {};
  }
  return resolveServiceTierRequestPlan({
    serviceTier: config.serviceTier,
    ...(config.serviceTiers !== undefined ? { serviceTiers: config.serviceTiers } : {}),
    surface: responsesServiceTierSurface(config),
  });
}

function responsesFetchForConfig(
  config: OpenResponsesTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
): typeof fetch {
  const serviceTierPlan = resolveResponsesServiceTierPlan(config);
  // Provider tool literals/entry bodies merge first; the declared wire merge (provider-level
  // headers/body, thinkingSwitch, serviceTier) wraps it so explicit declarations win on conflict.
  // The `openRouterAnthropicReasoning` patch sits innermost so the unified shape replaces whatever
  // reasoning/thinking encoding the merges produced for the route.
  let fetchFn: typeof fetch = createProviderToolsWireFetch(
    providerTools,
    createDeclaredWireMergeFetch(
      config,
      responsesServiceTierSurface(config),
      createOpenRouterAnthropicReasoningFetch(
        config,
        getLlmFetch({ flexWaiting: serviceTierPlan.flexWaiting }),
      ),
    ),
  );
  // `options.echoServerToolCalls`: re-injects captured server-side tool call items into `input`;
  // self-gates on the declaration.
  fetchFn = createEchoServerToolCallsFetch(config, fetchFn);
  // `options.defaultInputItemStatus`: fills the declared status onto replayed input items that
  // lack one. Wraps the echo injection so injected items keep their server-provided status
  // verbatim instead of getting the default filled in.
  fetchFn = createDefaultInputItemStatusFetch(config, fetchFn);
  if (shouldUseResponsesStoredStateFetch(config)) {
    fetchFn = createResponsesStoredStateAwareFetch(config, fetchFn);
  }
  if (shouldUseApplyPatchFileTools(config)) {
    fetchFn = createApplyPatchAwareFetch(config, fetchFn);
  }
  return wrapFetchForBedrockMantleIamAuth(config, fetchFn);
}

function createOpenAIResponsesProvider(
  config: OpenResponsesTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
): OpenAIProvider {
  return createOpenAI({
    apiKey: resolveBedrockMantleOpenResponsesApiKey(config),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
    fetch: responsesFetchForConfig(config, providerTools),
  });
}

/**
 * Adapter dispatch on the declared `sdk` package name; absent = the generic
 * `@ai-sdk/open-responses` adapter. The gateway adapter is always the v3 language-model: declared
 * provider tools are literal entries it passes through. Unknown packages fail fast.
 */
export function createResponsesLanguageModel(
  config: OpenResponsesTransportConfig,
  providerTools: Pick<
    ResolvedProviderTools,
    "literalEntries" | "bodyPatches"
  > = EMPTY_RESOLVED_PROVIDER_TOOLS,
): unknown {
  const languageModelId = resolveOpenResponsesLanguageModelId(config);

  switch (config.sdk ?? "@ai-sdk/open-responses") {
    case "@ai-sdk/openai":
      return createOpenAIResponsesProvider(config, providerTools).responses(languageModelId);
    case "@ai-sdk/xai":
      return createXai({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        fetch: responsesFetchForConfig(config, providerTools),
      }).responses(languageModelId);
    case "@ai-sdk/azure":
      return createAzure({
        apiKey: config.apiKey,
        resourceName: resolveAzureResourceName(config),
        fetch: responsesFetchForConfig(config, providerTools),
      })(languageModelId);
    case "@ai-sdk/gateway": {
      const gatewayBaseUrl = resolveGatewaySdkBaseUrl(config);
      return createGateway({
        apiKey: config.apiKey,
        fetch: responsesFetchForConfig(config, providerTools),
        ...(gatewayBaseUrl !== undefined ? { baseURL: gatewayBaseUrl } : {}),
      }).languageModel(config.model);
    }
    case "@ai-sdk/huggingface":
      return createHuggingFace({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        fetch: responsesFetchForConfig(config, providerTools),
      }).responses(languageModelId);
    case "@ai-sdk/open-responses":
      return createOpenResponses({
        name: OPEN_RESPONSES_GENERIC_PROVIDER_NAME,
        url: openResponsesPostUrl(config.baseUrl),
        apiKey: config.apiKey,
        fetch: responsesFetchForConfig(config, providerTools),
      })(config.model);
    default:
      throw new Error(
        `Unknown open-responses SDK adapter package ${JSON.stringify(config.sdk)}. Bundled adapters: ${OPEN_RESPONSES_SDK_ADAPTER_PACKAGES.join(", ")}.`,
      );
  }
}

export function buildResponsesGenerateTools(
  config: OpenResponsesTransportConfig,
  normalizedTools: readonly OpenAiFunctionToolDefinition[],
  providerTools: Pick<ResolvedProviderTools, "functionTools"> = EMPTY_RESOLVED_PROVIDER_TOOLS,
): Record<string, unknown> {
  let merged = buildResponsesAiSdkTools([
    ...normalizedTools,
    ...providerTools.functionTools,
  ]) as Record<string, unknown>;
  if (shouldUseApplyPatchFunctionTool(config)) {
    merged = {
      ...merged,
      ...buildResponsesAiSdkTools([
        buildApplyPatchFunctionToolDefinition() as OpenAiFunctionToolDefinition,
      ]),
    };
  }

  // The official OpenAI adapter exposes apply_patch as an SDK-native tool.
  if (shouldUseOpenAiSdkApplyPatchTool(config)) {
    const openai = createOpenAIResponsesProvider(config, EMPTY_RESOLVED_PROVIDER_TOOLS);
    return { ...merged, apply_patch: openai.tools.applyPatch({}) };
  }

  return merged;
}

export function buildResponsesProviderOptions(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Record<string, JsonObject> {
  const reasoningEffort = openResponsesReasoningEffort(config);
  const reasoningMode = openResponsesReasoningMode(config);
  const reasoningSummary = resolveOpenResponsesReasoningSummary(config);
  const sdk = config.sdk ?? "@ai-sdk/open-responses";

  if (sdk === "@ai-sdk/xai") {
    if (reasoningEffort === undefined) {
      return {};
    }

    return {
      xai: {
        reasoningEffort,
      } as JsonObject,
    };
  }

  if (sdk === "@ai-sdk/azure") {
    const azureOptions: JsonObject = {
      store: config.store ?? true,
      ...(config.truncation === "auto" ? { truncation: "auto" } : { truncation: "disabled" }),
    };

    if (reasoningEffort !== undefined) {
      azureOptions.reasoningEffort = reasoningEffort;
    }

    if (reasoningSummary !== undefined) {
      azureOptions.reasoningSummary = reasoningSummary;
    }

    if (previousResponseId && responsesUsesStoredState(config)) {
      azureOptions.previousResponseId = previousResponseId;
    }

    return { azure: azureOptions };
  }

  if (sdk === "@ai-sdk/openai") {
    const openaiOptions: JsonObject = {
      store: config.store ?? responsesUsesStoredState(config),
      ...(config.truncation === "auto" ? { truncation: "auto" } : { truncation: "disabled" }),
    };

    if (reasoningEffort !== undefined) {
      openaiOptions.reasoningEffort = reasoningEffort;
    }

    if (reasoningMode !== undefined) {
      openaiOptions.reasoningMode = reasoningMode;
    }

    if (reasoningSummary !== undefined) {
      openaiOptions.reasoningSummary = reasoningSummary;
    }

    if (previousResponseId && responsesUsesStoredState(config)) {
      openaiOptions.previousResponseId = previousResponseId;
    }

    return { openai: openaiOptions };
  }

  if (sdk === "@ai-sdk/huggingface") {
    if (reasoningEffort === undefined) {
      return {};
    }
    return { huggingface: { reasoningEffort } as JsonObject };
  }

  if (sdk === "@ai-sdk/gateway") {
    return buildGatewayV3ProviderOptions(config);
  }

  // Generic Open Responses adapter (`@ai-sdk/open-responses`): reasoning/store declarations pass
  // through verbatim; server-side stored state requires the endpoint's `options.storedState`.
  const providerOptions: JsonObject = {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
  };

  if (config.options?.storedState === true) {
    providerOptions.store = config.store ?? true;
    if (previousResponseId) {
      providerOptions.previousResponseId = previousResponseId;
    }
  }

  if (Object.keys(providerOptions).length === 0) {
    return {};
  }

  return {
    [OPEN_RESPONSES_GENERIC_PROVIDER_NAME]: providerOptions,
  };
}

/**
 * The service tier fragment is merged into the provider options builder result here instead of
 * editing each adapter branch, so existing reasoning/store/previousResponseId options are never
 * dropped.
 */
export function buildResponsesProviderOptionsWithServiceTier(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Record<string, JsonObject> {
  return mergeServiceTierProviderOptions(
    buildResponsesProviderOptions(config, previousResponseId),
    resolveResponsesServiceTierPlan(config),
  );
}
