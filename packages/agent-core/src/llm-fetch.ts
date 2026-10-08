import { createRequire } from "node:module";
import { product } from "@spiritagent/product";

import { Agent, fetch as undiciFetch } from "undici";

import { observeLlmFetchResponse } from "./llm-retry.js";

export type LlmHttpVersion = "http1.1" | "http2";

export const SPIRIT_UA_PRODUCT = encodeURIComponent(product.name);

const require = createRequire(import.meta.url);
const defaultClientVersion = (require("../package.json") as { version: string }).version;

const LLM_HTTP_VERSIONS: readonly LlmHttpVersion[] = ["http1.1", "http2"];

/**
 * Extended headers/body idle wait for Flex service tier requests (30 minutes). Standard-tier
 * requests keep the undici defaults; only requests whose resolved plan carries `flexWaiting`
 * use the flex dispatcher.
 */
export const FLEX_SERVICE_TIER_WAIT_MS = 1_800_000;

let configuredVersion: LlmHttpVersion = "http2";
let llmDispatcher: Agent | undefined;
let flexLlmDispatcher: Agent | undefined;
let configuredClientVersion: string = defaultClientVersion;
let llmFetchTransportOverride: typeof fetch | undefined;

interface LlmDispatcherOptions {
  allowH2: boolean;
  pipelining: number;
  headersTimeout?: number;
  bodyTimeout?: number;
}

export interface LlmDispatcherConstruction {
  kind: "standard" | "flex";
  options: LlmDispatcherOptions;
}

const llmDispatcherConstructions: LlmDispatcherConstruction[] = [];

/** @internal Unit tests read recorded dispatcher options instead of waiting on real timeouts. */
export function getLlmDispatcherConstructionsForTests(): readonly LlmDispatcherConstruction[] {
  return llmDispatcherConstructions.map((entry) => ({
    kind: entry.kind,
    options: { ...entry.options },
  }));
}

/** @internal Unit tests may replace the underlying transport after UA merge. */
export function setLlmFetchTransportOverrideForTests(fetchImpl: typeof fetch | undefined): void {
  llmFetchTransportOverride = fetchImpl;
}

export function buildSpiritUserAgent(version: string): string {
  return `${SPIRIT_UA_PRODUCT}/${version.trim()}`;
}

export function getLlmClientVersion(): string {
  return configuredClientVersion;
}

export function configureLlmClientVersion(version: string): void {
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    return;
  }
  configuredClientVersion = trimmed;
}

export function mergeLlmFetchInit(init?: RequestInit): RequestInit {
  const userAgent = buildSpiritUserAgent(configuredClientVersion);
  const sourceHeaders = init?.headers;

  if (sourceHeaders instanceof Headers) {
    const headers = new Headers(sourceHeaders);
    headers.set("User-Agent", userAgent);
    return { ...init, headers };
  }

  const headers = new Headers();
  if (Array.isArray(sourceHeaders)) {
    for (const [key, value] of sourceHeaders) {
      headers.append(key, value);
    }
  } else if (sourceHeaders && typeof sourceHeaders === "object") {
    for (const [key, value] of Object.entries(sourceHeaders)) {
      if (value !== undefined) {
        headers.set(key, value);
      }
    }
  }
  headers.set("User-Agent", userAgent);
  return { ...init, headers };
}

export function normalizeLlmHttpVersion(value: unknown): LlmHttpVersion {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "http1.1" || normalized === "http/1.1" || normalized === "http1") {
      return "http1.1";
    }
    if (normalized === "http2" || normalized === "http/2" || normalized === "h2") {
      return "http2";
    }
  }
  return "http2";
}

export function getLlmHttpVersion(): LlmHttpVersion {
  return configuredVersion;
}

export function configureLlmHttpVersion(version: LlmHttpVersion): void {
  const normalized = normalizeLlmHttpVersion(version);
  if (!LLM_HTTP_VERSIONS.includes(normalized)) {
    return;
  }
  if (configuredVersion === normalized && llmDispatcher !== undefined) {
    return;
  }
  configuredVersion = normalized;
  llmDispatcher = undefined;
  flexLlmDispatcher = undefined;
}

function llmDispatcherInstance(): Agent {
  if (llmDispatcher === undefined) {
    const options: LlmDispatcherOptions = {
      allowH2: configuredVersion === "http2",
      pipelining: 0,
    };
    llmDispatcherConstructions.push({ kind: "standard", options });
    llmDispatcher = new Agent(options);
  }
  return llmDispatcher;
}

/** Flex tier requests get an extended header/body idle wait; cancellation via AbortSignal is unchanged. */
function flexLlmDispatcherInstance(): Agent {
  if (flexLlmDispatcher === undefined) {
    const options: LlmDispatcherOptions = {
      allowH2: configuredVersion === "http2",
      pipelining: 0,
      headersTimeout: FLEX_SERVICE_TIER_WAIT_MS,
      bodyTimeout: FLEX_SERVICE_TIER_WAIT_MS,
    };
    llmDispatcherConstructions.push({ kind: "flex", options });
    flexLlmDispatcher = new Agent(options);
  }
  return flexLlmDispatcher;
}

/** LLM outbound requests: undici fetch; HTTP/2 is config-driven (TLS ALPN, falls back to HTTP/1.1 when the peer does not support it). */
export function getLlmFetch(options?: { flexWaiting?: boolean | undefined }): typeof fetch {
  const dispatcher =
    options?.flexWaiting === true ? flexLlmDispatcherInstance() : llmDispatcherInstance();
  const fetchWithDispatcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const mergedInit = mergeLlmFetchInit(init);
    if (llmFetchTransportOverride) {
      return observeLlmFetchResponse(
        (await llmFetchTransportOverride(input, mergedInit)) as Response,
      );
    }
    const response = await undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...mergedInit, dispatcher } as Parameters<typeof undiciFetch>[1],
    );
    return observeLlmFetchResponse(response as unknown as Response);
  };
  return fetchWithDispatcher as unknown as typeof fetch;
}
