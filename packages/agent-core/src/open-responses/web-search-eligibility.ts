import type { JsonObject } from "../ports.js";
import { shouldUseMinimaxServerToolsWebSearch } from "../anthropic/minimax-server-tools.js";
import { isOpenResponsesTransportConfig, type LlmTransportConfig } from "../provider-config.js";
import { shouldUseAlibabaBuiltInTools } from "./alibaba-built-in-tools.js";
import { shouldUseGatewayWebSearch } from "./gateway-web-search.js";
import {
  resolveOpenResponsesSdkProvider,
  isBedrockMantleOpenResponsesConfig,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";

/**
 * Set true when xAI Responses accepts `xai.tools.webSearch()` alongside host function tools.
 * Phase 3 enables this after the coexistence spike.
 */
export const XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED = true;

export type ProviderWebSearchMode =
  | "openai-sdk-web-search"
  | "xai-sdk-web-search"
  | "gateway-sdk-web-search"
  | "alibaba-responses-built-in-tools"
  | "minimax-server-tools-web-search"
  | "deepseek-responses-built-in-tools";

export function shouldUseProviderWebSearch(config: LlmTransportConfig): boolean {
  // User opt-out (agents.webSearch.enabled=false in config.json): the provider is treated as if it
  // had no web search capability everywhere (tool injection, apply_patch bridge, turn routing).
  if (config.webSearchEnabled === false) {
    return false;
  }
  return resolveProviderWebSearchMode(config) !== undefined || shouldUseAlibabaBuiltInTools(config);
}

export function resolveProviderWebSearchMode(
  config: LlmTransportConfig,
): ProviderWebSearchMode | undefined {
  if (config.webSearchEnabled === false) {
    return undefined;
  }
  if (shouldUseMinimaxServerToolsWebSearch(config)) {
    return "minimax-server-tools-web-search";
  }

  if (!isOpenResponsesTransportConfig(config)) {
    return undefined;
  }

  return resolveOpenResponsesWebSearchMode(config);
}

function resolveOpenResponsesWebSearchMode(
  config: OpenResponsesTransportConfig,
): ProviderWebSearchMode | undefined {
  if (isBedrockMantleOpenResponsesConfig(config)) {
    return undefined;
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  if (config.llmVendor === "openai" && provider === "openai") {
    return "openai-sdk-web-search";
  }

  if (config.llmVendor === "xai" && provider === "xai" && XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED) {
    return "xai-sdk-web-search";
  }

  if (config.llmVendor === "alibaba") {
    return "alibaba-responses-built-in-tools";
  }

  if (config.llmVendor === "deepseek") {
    return "deepseek-responses-built-in-tools";
  }

  if (shouldUseGatewayWebSearch(config)) {
    return "gateway-sdk-web-search";
  }

  return undefined;
}

/** Model-visible guidance when OpenAI/xAI SDK web search is available (not injected for Alibaba). */
export function buildProviderWebSearchPromptSection(
  _config: LlmTransportConfig,
): string | undefined {
  // Built-in web search is declared in the request tools field; host prompt already
  // states that only declared tools may be used. Do not duplicate in system message.
  return undefined;
}

export function buildWebSearchResponsesTraceToolEntry(): JsonObject {
  return { type: "web_search" };
}
