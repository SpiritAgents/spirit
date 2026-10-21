import { getLlmFetch } from "../llm-fetch.js";
import { resolveProviderEndpointUrl } from "./resolve.js";
import {
  isOpenAiFunctionToolEntry,
  readJsonDotPathValue,
  type OpenAiFunctionToolEntry,
  type ProviderToolsFromDeclaration,
} from "./types.js";

type FetchFn = typeof fetch;

export const PROVIDER_TOOLS_FROM_CACHE_TTL_MS = 5 * 60 * 1000;

type ProviderToolsFromCacheEntry = {
  expiresAt: number;
  tools: OpenAiFunctionToolEntry[];
};

const providerToolsFromCache = new Map<string, ProviderToolsFromCacheEntry>();

export interface FetchProviderToolsFromOptions {
  apiBase: string;
  apiKey: string;
  fetchImpl?: FetchFn;
}

/**
 * Fetches the dynamic tool list of a `toolsFrom` declaration: GET with the provider Bearer key,
 * the response is read at `listPath` (default `"tools"`) as an array and filtered down to
 * OpenAI-function-shaped entries. Results are cached in memory per URL+key for the TTL.
 */
export async function fetchProviderToolsFrom(
  toolsFrom: ProviderToolsFromDeclaration,
  options: FetchProviderToolsFromOptions,
): Promise<OpenAiFunctionToolEntry[]> {
  const url = resolveProviderEndpointUrl(options.apiBase, toolsFrom);
  const cacheKey = `${url}\0${options.apiKey}`;
  const cached = providerToolsFromCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tools;
  }

  const fetchImpl = options.fetchImpl ?? getLlmFetch();
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiKey.trim()}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Provider tools list request failed (${response.status}): ${body.trim() || response.statusText}`,
    );
  }

  const payload: unknown = await response.json();
  const listPath = toolsFrom.listPath?.trim() || "tools";
  const list = readJsonDotPathValue(payload, listPath);
  const tools = (Array.isArray(list) ? list : []).filter(isOpenAiFunctionToolEntry);

  providerToolsFromCache.set(cacheKey, {
    expiresAt: Date.now() + PROVIDER_TOOLS_FROM_CACHE_TTL_MS,
    tools,
  });
  return tools;
}

/** @internal Test helper */
export function clearProviderToolsFromCacheForTests(): void {
  providerToolsFromCache.clear();
}
