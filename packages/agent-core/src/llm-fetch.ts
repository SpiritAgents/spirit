import { createRequire } from "node:module";
import { product } from "@spiritagent/product";

import { Agent, fetch as undiciFetch } from "undici";

import { observeLlmFetchResponse } from "./llm-retry.js";

export const SPIRIT_UA_PRODUCT = encodeURIComponent(product.name);

const require = createRequire(import.meta.url);
const defaultClientVersion = (require("../package.json") as { version: string }).version;

/**
 * Extended headers/body idle wait for Flex service tier requests (30 minutes). Standard-tier
 * requests keep the undici defaults; only requests whose resolved plan carries `flexWaiting`
 * use the flex dispatcher.
 */
export const FLEX_SERVICE_TIER_WAIT_MS = 1_800_000;

let llmDispatcher: Agent | undefined;
let flexLlmDispatcher: Agent | undefined;
let configuredClientVersion: string = defaultClientVersion;
let llmFetchTransportOverride: typeof fetch | undefined;

interface LlmDispatcherOptions {
  /** H2 adds little value for LLM requests and shares session-level failures across streams. */
  allowH2: false;
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

function llmDispatcherInstance(): Agent {
  if (llmDispatcher === undefined) {
    const options: LlmDispatcherOptions = {
      allowH2: false,
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
      allowH2: false,
      pipelining: 0,
      headersTimeout: FLEX_SERVICE_TIER_WAIT_MS,
      bodyTimeout: FLEX_SERVICE_TIER_WAIT_MS,
    };
    llmDispatcherConstructions.push({ kind: "flex", options });
    flexLlmDispatcher = new Agent(options);
  }
  return flexLlmDispatcher;
}

/** LLM outbound requests use HTTP/1.1-only dispatchers. */
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
