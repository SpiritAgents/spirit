import type { JsonObject } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import { isAnthropicTransportConfig, type LlmTransportConfig } from "../provider-config.js";
import type { AnthropicTransportConfig } from "./anthropic-compat.js";

/**
 * MiniMax Server Tools web search schema version.
 * Doc: https://platform.minimaxi.io/docs/guides/server-tools.md (minimax.io, 20250305)
 */
export const MINIMAX_WEB_SEARCH_SERVER_TOOL_TYPE = "web_search_20250305" as const;
export const MINIMAX_WEB_SEARCH_SERVER_TOOL_NAME = "web_search" as const;

export function shouldUseMinimaxServerToolsWebSearch(
  config: LlmTransportConfig | undefined,
): config is AnthropicTransportConfig {
  return (
    isAnthropicTransportConfig(config) &&
    config.llmVendor === "minimax" &&
    config.webSearchEnabled !== false
  );
}

export function buildMinimaxWebSearchServerToolEntry(): JsonObject {
  return {
    type: MINIMAX_WEB_SEARCH_SERVER_TOOL_TYPE,
    name: MINIMAX_WEB_SEARCH_SERVER_TOOL_NAME,
  };
}

export function buildMinimaxWebSearchTraceToolEntry(): JsonObject {
  return buildMinimaxWebSearchServerToolEntry();
}

function isMinimaxAnthropicMessagesUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "api.minimax.cn" || parsed.hostname === "api.minimax.io") &&
      parsed.pathname.includes("/messages")
    );
  } catch {
    return false;
  }
}

function mergeMinimaxServerToolsIntoRequestBody(body: JsonObject): JsonObject {
  const next: JsonObject = { ...body };
  const existingTools = Array.isArray(next.tools) ? next.tools : [];
  const hasWebSearch = existingTools.some(
    (entry) =>
      isJsonObject(entry as JsonObject) &&
      (entry as JsonObject).type === MINIMAX_WEB_SEARCH_SERVER_TOOL_TYPE &&
      (entry as JsonObject).name === MINIMAX_WEB_SEARCH_SERVER_TOOL_NAME,
  );

  if (!hasWebSearch) {
    next.tools = [...existingTools, buildMinimaxWebSearchServerToolEntry()];
  }

  return next;
}

export function createMinimaxAnthropicServerToolsFetch(
  fetchImpl: typeof fetch,
  options: { webSearchEnabled: boolean },
): typeof fetch {
  if (!options.webSearchEnabled) {
    return fetchImpl;
  }

  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (
      init?.method?.toUpperCase() === "POST" &&
      typeof init.body === "string" &&
      isMinimaxAnthropicMessagesUrl(url)
    ) {
      try {
        const parsed = JSON.parse(init.body) as JsonObject;
        return fetchImpl(input, {
          ...init,
          body: JSON.stringify(mergeMinimaxServerToolsIntoRequestBody(parsed)),
        });
      } catch {
        // Fall through to the original request when body is not JSON.
      }
    }

    return fetchImpl(input, init);
  };
}
