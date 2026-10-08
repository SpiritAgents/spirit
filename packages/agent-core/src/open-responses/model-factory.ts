import { createGateway } from "@ai-sdk/gateway";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createXai } from "@ai-sdk/xai";
import { createHuggingFace } from "@ai-sdk/huggingface";

import { getLlmFetch } from "../llm-fetch.js";
import {
  mergeServiceTierProviderOptions,
  resolveServiceTierRequestPlan,
  type ServiceTierRequestPlan,
} from "../service-tier-request.js";
import { isArkLlmVendor } from "../ark/ark-provider.js";
import { wrapFetchForCloudflareAiGateway } from "../cloudflare-ai-gateway-fetch.js";
import type { JsonObject } from "../ports.js";
import { createAlibabaResponsesAwareFetch } from "./alibaba-responses-fetch.js";
import {
  createDeepSeekResponsesAwareFetch,
  resolveDeepSeekResponsesReasoningEffort,
} from "./deepseek-responses-fetch.js";
import {
  createResponsesStoredStateAwareFetch,
  shouldUseResponsesStoredStateFetch,
} from "./responses-stored-state-fetch.js";
import { createApplyPatchAwareFetch } from "./apply-patch-responses-fetch.js";
import { createOpenRouterReasoningAwareFetch } from "./openrouter-reasoning-responses-fetch.js";
import { createServiceTierResponsesFetch } from "./service-tier-responses-fetch.js";
import {
  resolveBedrockMantleOpenResponsesApiKey,
  wrapFetchForBedrockMantleIamAuth,
} from "./bedrock-mantle-auth-fetch.js";
import { shouldUseAlibabaResponsesBuiltInTools } from "./alibaba-built-in-tools.js";
import { isCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
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
import {
  buildGatewayMinimaxProviderOptions,
  isGatewayMinimaxModel,
} from "../openai/gateway-minimax-thinking.js";
import {
  buildGatewayAlibabaProviderOptions,
  isGatewayAlibabaModel,
} from "../openai/gateway-alibaba-thinking.js";
import {
  buildGatewayAnthropicProviderOptions,
  isGatewayAnthropicClaudeModel,
} from "../openai/gateway-anthropic-thinking.js";
import {
  buildGatewayCodeCompletionProviderOptions,
  shouldUseGatewayCodeCompletionProviderOptions,
} from "../openai/gateway-code-completion-thinking.js";
import {
  buildGatewayDeepSeekProviderOptions,
  isGatewayDeepSeekModel,
} from "../openai/gateway-deepseek-thinking.js";
import {
  buildGatewayMoonshotProviderOptions,
  isGatewayMoonshotModel,
} from "../openai/moonshot-thinking-switch.js";
import {
  buildDirectXiaomiResponsesProviderOptions,
  buildGatewayXiaomiResponsesProviderOptions,
  isGatewayXiaomiModel,
} from "../openai/gateway-xiaomi-thinking.js";
import {
  buildGatewayZaiProviderOptions,
  isGatewayZaiModel,
} from "../openai/gateway-zai-thinking.js";
import {
  buildGatewayXaiProviderOptions,
  isGatewayXaiModel,
  resolveXaiProviderReasoningEffort,
} from "../openai/gateway-xai-reasoning.js";
import {
  buildGatewayGoogleProviderOptions,
  isGatewayGoogleGeminiModel,
} from "../openai/gateway-google-thinking.js";
import { isOpenRouterAnthropicClaudeModel } from "../openai/openrouter-anthropic-reasoning.js";
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
 * Per-request service tier plan for the open-responses transport. The Vercel web-search route
 * speaks the gateway v3 language-model protocol; everything else on this transport is a Responses
 * surface (official OpenAI SDK or generic Open Responses).
 */
function resolveResponsesServiceTierPlan(
  config: OpenResponsesTransportConfig,
): ServiceTierRequestPlan {
  if (config.serviceTier === undefined) {
    return {};
  }
  return resolveServiceTierRequestPlan({
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
    serviceTier: config.serviceTier,
    ...(config.upstreamProvider !== undefined ? { upstreamProvider: config.upstreamProvider } : {}),
    surface: shouldUseGatewayWebSearch(config) ? "gateway-v3" : "responses",
  });
}

function responsesFetchForConfig(config: OpenResponsesTransportConfig): typeof fetch {
  const serviceTierPlan = resolveResponsesServiceTierPlan(config);
  let fetchFn: typeof fetch = getLlmFetch({ flexWaiting: serviceTierPlan.flexWaiting });
  if (shouldUseAlibabaResponsesBuiltInTools(config)) {
    fetchFn = createAlibabaResponsesAwareFetch(config, fetchFn);
  }
  if (config.llmVendor === "deepseek") {
    fetchFn = createDeepSeekResponsesAwareFetch(config, fetchFn);
  }
  if (shouldUseResponsesStoredStateFetch(config)) {
    fetchFn = createResponsesStoredStateAwareFetch(config, fetchFn);
  }
  fetchFn = createOpenRouterReasoningAwareFetch(config, fetchFn);
  fetchFn = createServiceTierResponsesFetch(serviceTierPlan, fetchFn);
  if (shouldUseApplyPatchFileTools(config)) {
    fetchFn = createApplyPatchAwareFetch(config, fetchFn);
  }
  fetchFn = wrapFetchForCloudflareAiGateway(config.cloudflareGatewayId, fetchFn);
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

  if (config.llmVendor === "hugging-face") {
    return createHuggingFace({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://router.huggingface.co/v1",
      fetch: getLlmFetch(),
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
    name: config.llmVendor ?? "spirit",
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

  if (shouldUseGatewayWebSearch(config)) {
    if (shouldUseGatewayCodeCompletionProviderOptions(config)) {
      return buildGatewayCodeCompletionProviderOptions(config);
    }

    if (isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
      return buildGatewayAnthropicProviderOptions(config);
    }

    if (isGatewayGoogleGeminiModel(config.llmVendor, config.model)) {
      return buildGatewayGoogleProviderOptions(config, reasoningEffort);
    }

    if (isGatewayDeepSeekModel(config.llmVendor, config.model)) {
      return buildGatewayDeepSeekProviderOptions(config);
    }

    if (isGatewayMoonshotModel(config.llmVendor, config.model)) {
      const moonshotOptions = buildGatewayMoonshotProviderOptions(config);
      if (Object.keys(moonshotOptions).length > 0) {
        return moonshotOptions;
      }
    }

    if (isGatewayXiaomiModel(config.llmVendor, config.model)) {
      const xiaomiOptions = buildGatewayXiaomiResponsesProviderOptions(
        config,
        reasoningEffort,
        reasoningSummary,
      );
      if (Object.keys(xiaomiOptions).length > 0) {
        return xiaomiOptions;
      }
    }

    if (isGatewayZaiModel(config.llmVendor, config.model)) {
      const zaiOptions = buildGatewayZaiProviderOptions(config);
      if (Object.keys(zaiOptions).length > 0) {
        // Gateway Z.ai does not return a displayable thinking stream upstream under the open-responses transport; see #169.
        return zaiOptions;
      }
    }

    if (isGatewayAlibabaModel(config.llmVendor, config.model)) {
      const alibabaOptions = buildGatewayAlibabaProviderOptions(config);
      if (Object.keys(alibabaOptions).length > 0) {
        return alibabaOptions;
      }
    }

    if (isGatewayMinimaxModel(config.llmVendor, config.model)) {
      const minimaxOptions = buildGatewayMinimaxProviderOptions(config);
      if (Object.keys(minimaxOptions).length > 0) {
        // Gateway MiniMax M3 does not return a displayable thinking stream under open-responses; see #170.
        return minimaxOptions;
      }
    }

    if (isGatewayXaiModel(config.llmVendor, config.model)) {
      const xaiOptions = buildGatewayXaiProviderOptions(
        config.llmVendor,
        config.model,
        openResponsesReasoningEffort(config),
      );
      if (Object.keys(xaiOptions).length > 0) {
        return xaiOptions;
      }
    }

    // Gateway v3 language-model forwards providerOptions as-is; OpenAI-routed models must use the openai namespace (see Vercel AI Gateway reasoning docs).
    const openaiOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };
    const result = Object.keys(openaiOptions).length > 0 ? { openai: openaiOptions } : {};
    return result;
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === "xai") {
    const xaiReasoningEffort = resolveXaiProviderReasoningEffort(reasoningEffort);
    if (xaiReasoningEffort === undefined) {
      return {};
    }

    return {
      xai: {
        reasoningEffort: xaiReasoningEffort,
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

  if (provider !== "openai") {
    if (isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model)) {
      return {};
    }

    if (config.llmVendor === "xiaomi") {
      const xiaomiOptions = buildDirectXiaomiResponsesProviderOptions(
        config,
        reasoningEffort,
        reasoningSummary,
      );
      if (Object.keys(xiaomiOptions).length > 0) {
        return xiaomiOptions;
      }
    }

    if (config.llmVendor === "hugging-face") {
      const huggingfaceOptions: JsonObject = {};
      if (reasoningEffort !== undefined) {
        huggingfaceOptions.reasoningEffort = reasoningEffort;
      }
      return Object.keys(huggingfaceOptions).length > 0 ? { huggingface: huggingfaceOptions } : {};
    }

    if (config.llmVendor === "deepseek") {
      const effort = resolveDeepSeekResponsesReasoningEffort(config);
      if (effort === undefined) {
        return {};
      }
      return {
        deepseek: { reasoningEffort: effort },
      };
    }

    const providerOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };

    if (config.llmVendor === "alibaba") {
      providerOptions.enable_thinking = !isCodeCompletionTransportProfile(config);
    }

    if (
      (config.llmVendor === "alibaba" || isArkLlmVendor(config.llmVendor)) &&
      responsesUsesStoredState(config)
    ) {
      providerOptions.store = config.store ?? true;
      if (previousResponseId) {
        providerOptions.previousResponseId = previousResponseId;
      }
    }

    if (Object.keys(providerOptions).length === 0) {
      return {};
    }

    return {
      [config.llmVendor ?? "open-responses"]: providerOptions,
    };
  }

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
