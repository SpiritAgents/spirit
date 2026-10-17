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
import { createAlibabaResponsesAwareFetch } from "./alibaba-responses-fetch.js";
import { createDeepSeekResponsesAwareFetch } from "./deepseek-responses-fetch.js";
import {
  createResponsesStoredStateAwareFetch,
  shouldUseResponsesStoredStateFetch,
} from "./responses-stored-state-fetch.js";
import { createApplyPatchAwareFetch } from "./apply-patch-responses-fetch.js";
import {
  resolveBedrockMantleOpenResponsesApiKey,
  wrapFetchForBedrockMantleIamAuth,
} from "./bedrock-mantle-auth-fetch.js";
import { shouldUseAlibabaResponsesBuiltInTools } from "./alibaba-built-in-tools.js";
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
import { buildGatewayWebSearchTool, shouldUseGatewayWebSearch } from "./gateway-web-search.js";
import { resolveProviderWebSearchMode } from "./web-search-eligibility.js";
import { responsesUsesStoredState } from "./responses-incremental-input.js";
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  openResponsesReasoningMode,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
  resolveAzureResourceName,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * Provider-options namespace of the generic `@ai-sdk/open-responses` adapter; the factory name and
 * the options key must stay in sync for the adapter to pick the values up.
 */
const OPEN_RESPONSES_GENERIC_PROVIDER_NAME = "spirit";

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
 * Per-request service tier plan for the open-responses transport. The gateway web-search route
 * speaks the gateway v3 language-model protocol; everything else on this transport is a Responses
 * surface (official OpenAI SDK or generic Open Responses).
 */
function responsesServiceTierSurface(
  config: OpenResponsesTransportConfig,
): ServiceTierRequestSurface {
  return shouldUseGatewayWebSearch(config) ? "gateway-v3" : "responses";
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

function responsesFetchForConfig(config: OpenResponsesTransportConfig): typeof fetch {
  const serviceTierPlan = resolveResponsesServiceTierPlan(config);
  // Declared headers/body/thinkingSwitch/serviceTier merge innermost so declarations win over
  // every other request patch.
  let fetchFn: typeof fetch = createDeclaredWireMergeFetch(
    config,
    responsesServiceTierSurface(config),
    getLlmFetch({ flexWaiting: serviceTierPlan.flexWaiting }),
  );
  if (shouldUseAlibabaResponsesBuiltInTools(config)) {
    fetchFn = createAlibabaResponsesAwareFetch(config, fetchFn);
  }
  // Self-gates on its own predicate (vendor tool module pending declaration-driven rewiring).
  fetchFn = createDeepSeekResponsesAwareFetch(config, fetchFn);
  if (shouldUseResponsesStoredStateFetch(config)) {
    fetchFn = createResponsesStoredStateAwareFetch(config, fetchFn);
  }
  if (shouldUseApplyPatchFileTools(config)) {
    fetchFn = createApplyPatchAwareFetch(config, fetchFn);
  }
  return wrapFetchForBedrockMantleIamAuth(config, fetchFn);
}

export function createOpenAIResponsesProvider(
  config: OpenResponsesTransportConfig,
): OpenAIProvider | undefined {
  if (resolveOpenResponsesSdkProvider(config) !== "openai") {
    return undefined;
  }

  return createOpenAI({
    apiKey: resolveBedrockMantleOpenResponsesApiKey(config),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
    fetch: responsesFetchForConfig(config),
  });
}

export function createResponsesLanguageModel(config: OpenResponsesTransportConfig): unknown {
  const languageModelId = resolveOpenResponsesLanguageModelId(config);

  if (config.sdk === "@ai-sdk/huggingface") {
    return createHuggingFace({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://router.huggingface.co/v1",
      fetch: responsesFetchForConfig(config),
    }).responses(languageModelId);
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === "openai") {
    const openai = createOpenAIResponsesProvider(config);
    if (!openai) {
      throw new Error("OpenAI Responses provider is not configured.");
    }
    return openai.responses(languageModelId);
  }

  if (provider === "xai") {
    return createXaiResponsesProvider(config).responses(languageModelId);
  }

  if (provider === "azure") {
    return createAzureResponsesProvider(config)(languageModelId);
  }

  // Gateway Perplexity must use @ai-sdk/gateway v3 language-model; fetch must still go through responsesFetchForConfig to strip apply_patch responses
  if (shouldUseGatewayWebSearch(config)) {
    const gatewayBaseUrl = resolveGatewaySdkBaseUrl(config);
    return createGateway({
      apiKey: config.apiKey,
      fetch: responsesFetchForConfig(config),
      ...(gatewayBaseUrl !== undefined ? { baseURL: gatewayBaseUrl } : {}),
    }).languageModel(config.model);
  }

  const openResponses = createOpenResponses({
    name: OPEN_RESPONSES_GENERIC_PROVIDER_NAME,
    url: openResponsesPostUrl(config.baseUrl),
    apiKey: config.apiKey,
    fetch: responsesFetchForConfig(config),
  });
  return openResponses(config.model);
}

function createXaiResponsesProvider(config: OpenResponsesTransportConfig) {
  return createXai({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_XAI_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAzureResponsesProvider(config: OpenResponsesTransportConfig) {
  return createAzure({
    apiKey: config.apiKey,
    resourceName: resolveAzureResourceName(config),
    fetch: responsesFetchForConfig(config),
  });
}

export function buildResponsesGenerateTools(
  config: OpenResponsesTransportConfig,
  normalizedTools: readonly OpenAiFunctionToolDefinition[],
): Record<string, unknown> {
  let merged = buildResponsesAiSdkTools([...normalizedTools]) as Record<string, unknown>;
  if (shouldUseApplyPatchFunctionTool(config)) {
    merged = {
      ...merged,
      ...buildResponsesAiSdkTools([
        buildApplyPatchFunctionToolDefinition() as OpenAiFunctionToolDefinition,
      ]),
    };
  }

  const webSearchMode = resolveProviderWebSearchMode(config);
  const provider = resolveOpenResponsesSdkProvider(config);

  if (provider === "openai") {
    const openai = createOpenAIResponsesProvider(config);
    if (openai) {
      const sdkTools: Record<string, unknown> = {};
      if (shouldUseOpenAiSdkApplyPatchTool(config)) {
        sdkTools.apply_patch = openai.tools.applyPatch({});
      }
      if (webSearchMode === "openai-sdk-web-search") {
        sdkTools.web_search = openai.tools.webSearch({});
      }
      if (Object.keys(sdkTools).length > 0) {
        return { ...merged, ...sdkTools };
      }
    }
  }

  if (provider === "xai" && webSearchMode === "xai-sdk-web-search") {
    const xai = createXaiResponsesProvider(config);
    return {
      ...merged,
      web_search: xai.tools.webSearch({}),
    };
  }

  if (webSearchMode === "gateway-sdk-web-search") {
    return {
      ...merged,
      web_search: buildGatewayWebSearchTool(config),
    };
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
  const provider = resolveOpenResponsesSdkProvider(config);

  if (provider === "xai") {
    if (reasoningEffort === undefined) {
      return {};
    }

    return {
      xai: {
        reasoningEffort,
      } as JsonObject,
    };
  }

  if (provider === "azure") {
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

  if (provider === "openai") {
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

  if (config.sdk === "@ai-sdk/huggingface") {
    if (reasoningEffort === undefined) {
      return {};
    }
    return { huggingface: { reasoningEffort } as JsonObject };
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
 * `buildResponsesProviderOptions` has many early-return vendor branches; the service tier fragment
 * is merged into its result here instead of editing each branch, so existing reasoning/store/
 * previousResponseId options are never dropped.
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
