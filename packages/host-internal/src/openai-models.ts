/**
 * OpenAI-compatible `GET /v1/models` listing (host-side; no secrets stored here).
 */

import {
  gatewayAnthropicClaudeSupportedEfforts,
  gatewayGoogleGeminiSupportedEfforts,
  routedAnthropicClaudeSupportedEfforts,
} from "@spiritagent/agent-core";

import type { ModelProviderId, ProviderModelTransportKind } from "./model-provider-presets.js";
import { resolveProviderConnectApiBase } from "./model-provider-presets.js";
import { assertGoogleGeminiApiBase, googleNativeModelsListUrl } from "./google-gemini-endpoints.js";
import { extractAwsRegionFromBedrockApiBase } from "./bedrock-region.js";
import { extractVertexProjectAndLocationFromApiBase } from "./google-vertex-endpoints.js";
import { normalizeOpenAiApiBase } from "./openai-api-base.js";
import { formatTitleFromId } from "./id-display-title.js";
import { WELL_KNOWN_CASING_OVERRIDES } from "./well-known-casing.js";

export { normalizeOpenAiApiBase } from "./openai-api-base.js";

export type { ProviderModelTransportKind };

export interface ProviderListedModelVideoDurationPricing {
  resolution: string;
  costPerSecondUsd: string;
  audio?: boolean;
}

/** Together etc.: example price plus applicable spec notes (e.g. 720x1280, 1080p / 5s). */
export interface ProviderListedModelExamplePricing {
  priceUsd: string;
  description: string;
}

export interface ProviderListedModelPricing {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  cachedInputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
  videoDurationPricing?: ProviderListedModelVideoDurationPricing[];
  /** Together `pricing.image_pixel.price_per_megapixel`。 */
  imagePerMegapixelUsd?: string;
  imageExamplePricing?: ProviderListedModelExamplePricing;
  videoExamplePricing?: ProviderListedModelExamplePricing;
}

export type KimiCodeSupportsThinkingType = "only";

export interface ProviderListedModelEntry {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: ProviderListedModelPricing;
  supportsImageInput?: boolean;
  supportsVideoInput?: boolean;
  supportsVideoGeneration?: boolean;
  supportsImageGeneration?: boolean;
  supportsReasoning?: boolean;
  /** LongCat etc.: when `supported_parameters` includes `thinking`, extended thinking can be toggled. */
  supportsThinkingSwitch?: boolean;
  supportsThinkingType?: KimiCodeSupportsThinkingType;
  contextLength?: number;
  maxCompletionTokens?: number;
  supportedReasoningEfforts?: string[];
  /** Hugging Face Hub media models: Inference Providers routing hint (optional for backend use). */
  inferenceProvider?: string;
  /** DeepInfra `is_partner`: partner models (data forwarded to third parties); kept as catalog metadata only in this first version, not filtered. */
  isPartner?: boolean;
}

export const OPENAI_MODELS_PATH = "/models";
export const ANTHROPIC_MODELS_PATH = "/models";
const ANTHROPIC_VERSION = "2023-06-01";

/** Full URL for the models list request. */
export function openAiCompatibleModelsListUrl(baseUrl: string): string {
  return `${normalizeOpenAiApiBase(baseUrl)}${OPENAI_MODELS_PATH}`;
}

/** Full URL for a single OpenAI-compatible model detail request. */
export function openAiCompatibleModelDetailUrl(baseUrl: string, modelId: string): string {
  const trimmedId = modelId.trim();
  return `${normalizeOpenAiApiBase(baseUrl)}${OPENAI_MODELS_PATH}/${encodeURIComponent(trimmedId)}`;
}

export function anthropicModelsListUrl(baseUrl: string): string {
  return `${normalizeOpenAiApiBase(baseUrl)}${ANTHROPIC_MODELS_PATH}`;
}

/** MiniMax Messages transport lists models via OpenAI-compatible GET /v1/models on the same site origin. */
export function minimaxOpenAiCompatibleListingBaseFromConnectBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return resolveProviderConnectApiBase("minimax", "openai-compatible");
  }

  const withoutAnthropic = trimmed.replace(/\/anthropic\/v1$/i, "/v1");
  if (withoutAnthropic !== trimmed) {
    return withoutAnthropic;
  }

  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/**
 * Extract model ids from a JSON body shaped like OpenAI's list models response.
 * Tolerates missing `data` by returning an empty list.
 */
export function parseOpenAiModelsPayload(body: unknown): string[] {
  return parseOpenAiCompatibleModelEntriesPayload(body).map((entry) => entry.id);
}

/**
 * OpenAI-shaped `GET /v1/models` list. Moonshot AI extends each item with
 * `supports_image_in`, `supports_video_in`, `supports_reasoning`, and `context_length`.
 */
export function parseOpenAiCompatibleModelEntriesPayload(
  body: unknown,
  provider?: ModelProviderId,
): ProviderListedModelEntry[] {
  if (provider === "moonshot-ai") {
    return parseMoonshotModelEntriesPayload(body);
  }

  if (provider === "kimi-code") {
    return parseKimiCodeModelEntriesPayload(body);
  }

  if (provider === "vercel-ai-gateway") {
    return parseVercelAiGatewayModelEntriesPayload(body);
  }

  if (provider === "openrouter") {
    return parseOpenRouterModelEntriesPayload(body);
  }

  if (provider === "volcengine" || provider === "byteplus") {
    return parseArkModelEntriesPayload(body);
  }

  if (provider === "xiaomi") {
    return parseXiaomiModelEntriesPayload(body);
  }

  if (provider === "minimax") {
    return parseMinimaxModelEntriesPayload(body);
  }

  if (provider === "stepfun") {
    return parseStepfunModelEntriesPayload(body);
  }

  if (provider === "siliconflow") {
    return parseSiliconFlowModelEntriesPayload(body, "chat");
  }

  if (provider === "google") {
    return parseGoogleModelEntriesPayload(body);
  }

  if (provider === "tencent-tokenhub") {
    return parseTencentTokenHubModelEntriesPayload(body);
  }

  if (provider === "mistral") {
    return parseMistralModelEntriesPayload(body);
  }

  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id === "string" && id.trim().length > 0) {
      const modelId = id.trim();
      entries.push({
        id: modelId,
        ...(provider === "deepseek" && isDeepSeekV4VisionListedModelId(modelId)
          ? { supportsImageInput: true }
          : {}),
      });
    }
  }
  return entries.map(attachGatewayModelReasoningEfforts);
}

const SKIPPED_TENCENT_TOKENHUB_MODEL_STATUSES = new Set(["pre-offline"]);

export function parseTencentTokenHubModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
    if (status && SKIPPED_TENCENT_TOKENHUB_MODEL_STATUSES.has(status)) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const displayName = readOptionalTrimmedString(record.name);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    entries.push(modelEntry);
  }
  return entries;
}

export function parseMistralModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const capabilities = record.capabilities;
    if (typeof capabilities !== "object" || capabilities === null) {
      continue;
    }
    const caps = capabilities as Record<string, unknown>;
    if (caps.completion_chat !== true) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const displayName = readOptionalTrimmedString(record.name);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    const description = readOptionalTrimmedString(record.description);
    if (description) {
      modelEntry.description = description;
    }
    const contextLength = readPositiveIntegerModelTrait(record, "max_context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    if (caps.vision === true) {
      modelEntry.supportsImageInput = true;
    }
    entries.push(modelEntry);
  }
  return entries;
}

const STEPFUN_IMAGE_GENERATION_MODEL_IDS = new Set([
  "step-image-edit-2",
  "step-2x-large",
  "step-1x-medium",
]);

const STEPFUN_VISION_MODEL_IDS = new Set(["step-3.7-flash", "step-1o-turbo-vision"]);

export function parseStepfunModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }
    const trimmedId = id.trim();
    const isVision = STEPFUN_VISION_MODEL_IDS.has(trimmedId);
    entries.push({
      id: trimmedId,
      ...(isVision ? { supportsImageInput: true, supportsVideoInput: true } : {}),
      ...(STEPFUN_IMAGE_GENERATION_MODEL_IDS.has(trimmedId)
        ? { supportsImageGeneration: true }
        : {}),
    });
  }
  return entries;
}

export function parseMoonshotModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const supportsImageInput = readBooleanModelTrait(record, "supports_image_in");
    if (supportsImageInput !== undefined) {
      modelEntry.supportsImageInput = supportsImageInput;
    }
    const supportsVideoInput = readBooleanModelTrait(record, "supports_video_in");
    if (supportsVideoInput !== undefined) {
      modelEntry.supportsVideoInput = supportsVideoInput;
    }
    const supportsReasoning = readBooleanModelTrait(record, "supports_reasoning");
    if (supportsReasoning !== undefined) {
      modelEntry.supportsReasoning = supportsReasoning;
      modelEntry.supportedReasoningEfforts = moonshotSupportedReasoningEfforts(
        supportsReasoning,
        id.trim(),
      );
    }
    const contextLength = readPositiveIntegerModelTrait(record, "context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    entries.push(modelEntry);
  }
  return entries;
}

/** Kimi Code `GET /v1/models`: Moonshot-shaped traits + `display_name` + `supports_thinking_type`. */
export function parseKimiCodeModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const displayName = readOptionalTrimmedString(record.display_name);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    const supportsImageInput = readBooleanModelTrait(record, "supports_image_in");
    if (supportsImageInput !== undefined) {
      modelEntry.supportsImageInput = supportsImageInput;
    }
    const supportsVideoInput = readBooleanModelTrait(record, "supports_video_in");
    if (supportsVideoInput !== undefined) {
      modelEntry.supportsVideoInput = supportsVideoInput;
    }
    const supportsReasoning = readBooleanModelTrait(record, "supports_reasoning");
    if (supportsReasoning !== undefined) {
      modelEntry.supportsReasoning = supportsReasoning;
      modelEntry.supportedReasoningEfforts = moonshotSupportedReasoningEfforts(
        supportsReasoning,
        id.trim(),
      );
    }
    const contextLength = readPositiveIntegerModelTrait(record, "context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    const supportsThinkingType = readKimiCodeSupportsThinkingType(record);
    if (supportsThinkingType !== undefined) {
      modelEntry.supportsThinkingType = supportsThinkingType;
    }
    entries.push(modelEntry);
  }
  return entries;
}

function readKimiCodeSupportsThinkingType(
  record: Record<string, unknown>,
): KimiCodeSupportsThinkingType | undefined {
  const value = record.supports_thinking_type;
  if (typeof value === "string" && value.trim().toLowerCase() === "only") {
    return "only";
  }
  return undefined;
}

export type SiliconFlowModelListKind = "chat" | "image" | "video";

/** SiliconFlow `GET /v1/models`: OpenAI-shaped list; capabilities are annotated from the request query source. */
export function parseSiliconFlowModelEntriesPayload(
  body: unknown,
  kind: SiliconFlowModelListKind,
): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    switch (kind) {
      case "image":
        modelEntry.supportsImageGeneration = true;
        break;
      case "video":
        modelEntry.supportsVideoGeneration = true;
        break;
      case "chat":
        if (inferSiliconFlowVisionInputFromModelId(modelEntry.id)) {
          modelEntry.supportsImageInput = true;
        }
        break;
      default:
        break;
    }
    entries.push(modelEntry);
  }
  return entries;
}

function inferSiliconFlowVisionInputFromModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.includes("vl") ||
    normalized.includes("vision") ||
    normalized.includes("omni") ||
    normalized.includes("multimodal")
  );
}

function mergeSiliconFlowListedModelEntries(
  entries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const byId = new Map<string, ProviderListedModelEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, { ...entry });
      continue;
    }
    byId.set(entry.id, {
      ...existing,
      ...entry,
      ...(existing.supportsImageInput || entry.supportsImageInput
        ? { supportsImageInput: true }
        : {}),
      ...(existing.supportsVideoInput || entry.supportsVideoInput
        ? { supportsVideoInput: true }
        : {}),
      ...(existing.supportsImageGeneration || entry.supportsImageGeneration
        ? { supportsImageGeneration: true }
        : {}),
      ...(existing.supportsVideoGeneration || entry.supportsVideoGeneration
        ? { supportsVideoGeneration: true }
        : {}),
      ...(existing.supportsReasoning || entry.supportsReasoning ? { supportsReasoning: true } : {}),
      ...((existing.contextLength ?? entry.contextLength)
        ? { contextLength: existing.contextLength ?? entry.contextLength }
        : {}),
      ...((existing.supportedReasoningEfforts ?? entry.supportedReasoningEfforts)
        ? {
            supportedReasoningEfforts:
              existing.supportedReasoningEfforts ?? entry.supportedReasoningEfforts,
          }
        : {}),
    });
  }
  return [...byId.values()];
}

async function fetchSiliconFlowModelsPayload(
  options: ListOpenAiCompatibleModelIdsOptions,
  query: string,
): Promise<unknown> {
  const baseListUrl = openAiCompatibleModelsListUrl(options.baseUrl);
  const url = `${baseListUrl}?${query}`;
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  return fetchModelsListJson(url, init);
}

export async function listSiliconFlowModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const queries: Array<{ kind: SiliconFlowModelListKind; query: string }> = [
    { kind: "chat", query: "type=text&sub_type=chat" },
    { kind: "image", query: "type=image" },
    { kind: "video", query: "sub_type=text-to-video" },
  ];

  const allEntries: ProviderListedModelEntry[] = [];
  for (const { kind, query } of queries) {
    const json = await fetchSiliconFlowModelsPayload(options, query);
    allEntries.push(...parseSiliconFlowModelEntriesPayload(json, kind));
  }

  return mergeSiliconFlowListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
}

/** Fireworks Gateway API root (the model catalog differs from the inference base). */
export const FIREWORKS_AI_GATEWAY_API_ROOT = "https://api.fireworks.ai";

const FIREWORKS_AI_SERVERLESS_MODELS_FILTER = "supports_serverless=true";

const FIREWORKS_AI_NON_CHAT_MODEL_KINDS = new Set(["EMBEDDING_MODEL"]);

export function fireworksAiGatewayModelsListUrl(pageToken?: string): string {
  const url = new URL(`${FIREWORKS_AI_GATEWAY_API_ROOT}/v1/accounts/fireworks/models`);
  url.searchParams.set("filter", FIREWORKS_AI_SERVERLESS_MODELS_FILTER);
  url.searchParams.set("pageSize", "200");
  if (pageToken?.trim()) {
    url.searchParams.set("pageToken", pageToken.trim());
  }
  return url.toString();
}

function readFireworksAiGatewayModelString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function readFireworksAiGatewayModelNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readFireworksAiGatewayModelBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function isFireworksAiGatewayChatModel(record: Record<string, unknown>): boolean {
  const kind = readFireworksAiGatewayModelString(record, "kind");
  if (kind && FIREWORKS_AI_NON_CHAT_MODEL_KINDS.has(kind)) {
    return false;
  }
  if (!isJsonObject(record.conversationConfig)) {
    return false;
  }
  return true;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFireworksAiGatewayModelsPayload(body: unknown): ProviderListedModelEntry[] {
  if (!isJsonObject(body) || !Array.isArray(body.models)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const item of body.models) {
    if (!isJsonObject(item)) {
      continue;
    }

    if (!isFireworksAiGatewayChatModel(item)) {
      continue;
    }

    const id = readFireworksAiGatewayModelString(item, "name");
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };
    const displayName = readFireworksAiGatewayModelString(item, "displayName");
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    const description = readFireworksAiGatewayModelString(item, "description");
    if (description) {
      modelEntry.description = description;
    }
    const contextLength = readFireworksAiGatewayModelNumber(item, "contextLength");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    const supportsImageInput = readFireworksAiGatewayModelBoolean(item, "supportsImageInput");
    if (supportsImageInput) {
      modelEntry.supportsImageInput = true;
    }
    entries.push(modelEntry);
  }

  return entries;
}

export function mergeFireworksAiGatewayModelPages(
  pages: readonly unknown[],
): ProviderListedModelEntry[] {
  const allEntries: ProviderListedModelEntry[] = [];
  for (const page of pages) {
    allEntries.push(...parseFireworksAiGatewayModelsPayload(page));
  }
  return dedupeProviderListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchFireworksAiGatewayModelsPage(
  options: ListOpenAiCompatibleModelIdsOptions,
  pageToken?: string,
): Promise<unknown> {
  const url = fireworksAiGatewayModelsListUrl(pageToken);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  return fetchModelsListJson(url, init);
}

export async function listFireworksAiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const pages: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const json = await fetchFireworksAiGatewayModelsPage(options, pageToken);
    pages.push(json);
    pageToken =
      isJsonObject(json) &&
      typeof json.nextPageToken === "string" &&
      json.nextPageToken.trim().length > 0
        ? json.nextPageToken.trim()
        : undefined;
  } while (pageToken);

  return mergeFireworksAiGatewayModelPages(pages);
}

/** Cohere model catalog API root (v1/models; differs from the Chat v2 base). */
export const COHERE_CATALOG_API_ROOT = "https://api.cohere.com";

const COHERE_MODELS_PAGE_SIZE = "1000";

export function cohereModelsListUrl(pageToken?: string): string {
  const url = new URL(`${COHERE_CATALOG_API_ROOT}/v1/models`);
  url.searchParams.set("endpoint", "chat");
  url.searchParams.set("page_size", COHERE_MODELS_PAGE_SIZE);
  if (pageToken?.trim()) {
    url.searchParams.set("page_token", pageToken.trim());
  }
  return url.toString();
}

function cohereModelHasChatEndpoint(endpoints: unknown): boolean {
  if (!Array.isArray(endpoints)) {
    return false;
  }
  return endpoints.some(
    (endpoint) => typeof endpoint === "string" && endpoint.trim().toLowerCase() === "chat",
  );
}

function cohereModelFeaturesIncludeVision(features: unknown): boolean {
  if (!Array.isArray(features)) {
    return false;
  }
  return features.some(
    (feature) => typeof feature === "string" && feature.trim().toLowerCase() === "vision",
  );
}

export function parseCohereModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (!isJsonObject(body) || !Array.isArray(body.models)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const item of body.models) {
    if (!isJsonObject(item)) {
      continue;
    }
    if (item.is_deprecated === true) {
      continue;
    }
    if (!cohereModelHasChatEndpoint(item.endpoints)) {
      continue;
    }

    const name = readOptionalTrimmedString(item.name);
    if (!name) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = {
      id: name,
      supportsImageInput: true,
    };
    const contextLength = readPositiveIntegerModelTrait(item, "context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    if (cohereModelFeaturesIncludeVision(item.features)) {
      modelEntry.supportsImageInput = true;
    }
    entries.push(modelEntry);
  }
  return entries;
}

export function mergeCohereModelPages(pages: readonly unknown[]): ProviderListedModelEntry[] {
  const allEntries: ProviderListedModelEntry[] = [];
  for (const page of pages) {
    allEntries.push(...parseCohereModelEntriesPayload(page));
  }
  return dedupeProviderListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchCohereModelsPage(
  options: ListOpenAiCompatibleModelIdsOptions,
  pageToken?: string,
): Promise<unknown> {
  const url = cohereModelsListUrl(pageToken);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  return fetchModelsListJson(url, init);
}

export async function listCohereModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const pages: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const json = await fetchCohereModelsPage(options, pageToken);
    pages.push(json);
    pageToken =
      isJsonObject(json) &&
      typeof json.next_page_token === "string" &&
      json.next_page_token.trim().length > 0
        ? json.next_page_token.trim()
        : undefined;
  } while (pageToken);

  return mergeCohereModelPages(pages);
}

const TOGETHER_AI_LISTED_MODEL_TYPES = new Set(["chat", "language", "image", "video"]);

function readTogetherAiModelsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (isJsonObject(body) && Array.isArray(body.data)) {
    return body.data;
  }
  return [];
}

function readTogetherAiPositiveNumber(value: unknown): number | undefined {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }
  return amount;
}

function readTogetherAiExamplePricing(
  value: unknown,
): ProviderListedModelExamplePricing | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const price = readTogetherAiPositiveNumber(record.example_price);
  const description = readOptionalTrimmedString(record.example_description);
  if (price === undefined || !description) {
    return undefined;
  }
  return {
    priceUsd: String(price),
    description,
  };
}

function readTogetherAiPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }

  const inputPerMillion = readTogetherAiPositiveNumber(pricing.input);
  const outputPerMillion = readTogetherAiPositiveNumber(pricing.output);
  const inputPerTokenUsd =
    inputPerMillion !== undefined ? String(inputPerMillion / 1_000_000) : undefined;
  const outputPerTokenUsd =
    outputPerMillion !== undefined ? String(outputPerMillion / 1_000_000) : undefined;

  const imagePixel = asRecord(pricing.image_pixel);
  const imagePerMegapixel =
    imagePixel !== undefined
      ? readTogetherAiPositiveNumber(imagePixel.price_per_megapixel)
      : undefined;
  const imagePerMegapixelUsd =
    imagePerMegapixel !== undefined ? String(imagePerMegapixel) : undefined;

  const imageExamplePricing = readTogetherAiExamplePricing(pricing.image);
  const videoExamplePricing = readTogetherAiExamplePricing(pricing.video);

  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerMegapixelUsd ? { imagePerMegapixelUsd } : {}),
    ...(imageExamplePricing ? { imageExamplePricing } : {}),
    ...(videoExamplePricing ? { videoExamplePricing } : {}),
  });
}

export function parseTogetherAiModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  const raw = readTogetherAiModelsArray(body);
  const entries: ProviderListedModelEntry[] = [];

  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue;
    }

    const type = readOptionalTrimmedString(item.type)?.toLowerCase();
    if (!type || !TOGETHER_AI_LISTED_MODEL_TYPES.has(type)) {
      continue;
    }

    const id = readOptionalTrimmedString(item.id);
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };
    const displayName = readOptionalTrimmedString(item.display_name);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    const contextLength = readPositiveIntegerModelTrait(item, "context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }

    if (type === "chat" || type === "language") {
      modelEntry.supportsImageInput = true;
    } else if (type === "image") {
      modelEntry.supportsImageGeneration = true;
    } else if (type === "video") {
      modelEntry.supportsVideoGeneration = true;
    }

    const pricing = readTogetherAiPricing(item);
    if (pricing) {
      modelEntry.pricing = pricing;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export async function listTogetherAiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const json = await fetchModelsListJson(url, init);
  const entries = parseTogetherAiModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

function readBasetenModelsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (isJsonObject(body) && Array.isArray(body.data)) {
    return body.data;
  }
  return [];
}

function readBasetenSupportedFeatures(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  const features = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      features.add(item.trim().toLowerCase());
    }
  }
  return features;
}

function readBasetenPerTokenUsd(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const amount = Number(trimmed);
    if (!Number.isFinite(amount) || amount < 0) {
      return undefined;
    }
    const perToken = amount >= 1 ? amount / 1_000_000 : amount;
    if (perToken <= 0) {
      return undefined;
    }
    if (amount < 1) {
      return trimmed;
    }
    return formatBasetenPerTokenUsdNumber(perToken);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return undefined;
    }
    const perToken = value >= 1 ? value / 1_000_000 : value;
    if (perToken <= 0) {
      return undefined;
    }
    return formatBasetenPerTokenUsdNumber(perToken);
  }
  return undefined;
}

function formatBasetenPerTokenUsdNumber(value: number): string {
  const fixed = value.toFixed(12);
  return fixed.replace(/\.?0+$/, "");
}

function isBasetenChatModel(record: Record<string, unknown>): boolean {
  const object = readOptionalTrimmedString(record.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const type = readOptionalTrimmedString(record.type)?.toLowerCase();
  if (type && type !== "chat") {
    return false;
  }
  return true;
}

function readBasetenPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = readBasetenPerTokenUsd(pricing.prompt);
  const outputPerTokenUsd = readBasetenPerTokenUsd(pricing.completion);
  const cachedInputPerTokenUsd = readBasetenPerTokenUsd(pricing.input_cache_read);
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(cachedInputPerTokenUsd ? { cachedInputPerTokenUsd } : {}),
  });
}

function basetenSupportedReasoningEfforts(
  modelId: string,
  features: ReadonlySet<string>,
): string[] | undefined {
  if (!features.has("reasoning") && !features.has("reasoning_effort")) {
    return undefined;
  }
  const normalizedId = modelId.trim().toLowerCase();
  const bareId = normalizedId.includes("/")
    ? normalizedId.slice(normalizedId.lastIndexOf("/") + 1)
    : normalizedId;
  if (/^kimi-k3(?:-|$)/.test(bareId)) {
    return moonshotK3SupportedReasoningEfforts();
  }
  return ["low", "medium", "high"];
}

export function parseBasetenModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  const raw = readBasetenModelsArray(body);
  const entries: ProviderListedModelEntry[] = [];

  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue;
    }
    if (!isBasetenChatModel(item)) {
      continue;
    }

    const id = readOptionalTrimmedString(item.id);
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };
    const displayName = readOptionalTrimmedString(item.name);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    const description = readOptionalTrimmedString(item.description);
    if (description) {
      modelEntry.description = description;
    }
    const contextLength = readPositiveIntegerModelTrait(item, "context_length");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    const maxCompletionTokens = readPositiveIntegerModelTrait(item, "max_completion_tokens");
    if (maxCompletionTokens !== undefined) {
      modelEntry.maxCompletionTokens = maxCompletionTokens;
    }

    modelEntry.supportsImageInput = true;
    const features = readBasetenSupportedFeatures(item.supported_features);
    if (features.has("vision")) {
      modelEntry.supportsImageInput = true;
    }

    const supportedReasoningEfforts = basetenSupportedReasoningEfforts(id, features);
    if (supportedReasoningEfforts !== undefined) {
      modelEntry.supportsReasoning = true;
      modelEntry.supportedReasoningEfforts = supportedReasoningEfforts;
    }

    const pricing = readBasetenPricing(item);
    if (pricing) {
      modelEntry.pricing = pricing;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export async function listBasetenModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const json = await fetchModelsListJson(url, init);
  const entries = parseBasetenModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

const GROQ_NON_CHAT_MODEL_ID_PATTERNS = [
  /^whisper-/i,
  /^distil-whisper-/i,
  /^playai-tts/i,
] as const;

const GROQ_VISION_MODEL_IDS = new Set([
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
]);

const GROQ_GPT_OSS_REASONING_MODEL_IDS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-safeguard-20b",
]);

const GROQ_QWEN_REASONING_MODEL_IDS = new Set(["qwen/qwen3.6-27b"]);

function isGroqNonChatModelId(id: string): boolean {
  const trimmed = id.trim();
  return GROQ_NON_CHAT_MODEL_ID_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function groqSupportedReasoningEfforts(id: string): string[] | undefined {
  const normalized = id.trim();
  if (GROQ_GPT_OSS_REASONING_MODEL_IDS.has(normalized)) {
    return ["low", "medium", "high"];
  }
  if (GROQ_QWEN_REASONING_MODEL_IDS.has(normalized)) {
    return ["none", "default"];
  }
  return undefined;
}

export function resolveGroqDisplayNameFromId(modelId: string): string {
  const segment = resolveHuggingFaceDisplayNameFromId(modelId);
  const formatted = formatTitleFromId(segment, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES });
  return formatted.length > 0 ? formatted : modelId.trim();
}

function isGroqListedChatModel(record: Record<string, unknown>): boolean {
  const object = readOptionalTrimmedString(record.object)?.toLowerCase();
  if (object !== "model") {
    return false;
  }
  return readBooleanModelTrait(record, "active") === true;
}

function readGroqModelsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isJsonObject(body)) {
    return [];
  }
  const data = body.data;
  return Array.isArray(data) ? data : [];
}

export function parseGroqModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  const raw = readGroqModelsArray(body);
  const entries: ProviderListedModelEntry[] = [];

  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue;
    }
    if (!isGroqListedChatModel(item)) {
      continue;
    }

    const id = readOptionalTrimmedString(item.id);
    if (!id || isGroqNonChatModelId(id)) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = {
      id,
      displayName: resolveGroqDisplayNameFromId(id),
    };

    const contextLength = readPositiveIntegerModelTrait(item, "context_window");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }

    const maxCompletionTokens = readPositiveIntegerModelTrait(item, "max_completion_tokens");
    if (maxCompletionTokens !== undefined) {
      modelEntry.maxCompletionTokens = maxCompletionTokens;
    }

    if (GROQ_VISION_MODEL_IDS.has(id)) {
      modelEntry.supportsImageInput = true;
    }

    const supportedReasoningEfforts = groqSupportedReasoningEfforts(id);
    if (supportedReasoningEfforts !== undefined) {
      modelEntry.supportsReasoning = true;
      modelEntry.supportedReasoningEfforts = supportedReasoningEfforts;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export async function listGroqModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const json = await fetchModelsListJson(url, init);
  const entries = parseGroqModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

/** DeepInfra model catalog `GET /models/list` (no auth); its `/v1/openai/models` subset is not used as the primary catalog source. */
export const DEEPINFRA_MODELS_LIST_URL = "https://api.deepinfra.com/models/list";

const DEEPINFRA_CHAT_MODEL_TYPE = "text-generation";
const DEEPINFRA_IMAGE_GENERATION_TYPES = new Set(["text-to-image"]);
// `world-model` has only 2 entries; treated as text-to-video.
const DEEPINFRA_VIDEO_GENERATION_TYPES = new Set(["text-to-video", "world-model"]);

function deepInfraModelsListUrl(baseUrl: string): string {
  // `/models/list` hangs off the site root rather than `/v1/openai`, so it is derived from the origin; falls back to the official constant when baseUrl is malformed.
  try {
    return new URL("/models/list", baseUrl).toString();
  } catch {
    return DEEPINFRA_MODELS_LIST_URL;
  }
}

function readDeepInfraModelsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (isJsonObject(body) && Array.isArray(body.data)) {
    return body.data;
  }
  return [];
}

function readDeepInfraTags(value: unknown): ReadonlySet<string> {
  const tags = new Set<string>();
  if (!Array.isArray(value)) {
    return tags;
  }
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      tags.add(item.trim().toLowerCase());
    }
  }
  return tags;
}

/** DeepInfra pricing values are in fractional cents (e.g. 0.0003 cents/token = $3/M); divide by 100 to get USD. */
function readDeepInfraPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/** Format a USD amount as a plain decimal string, avoiding floating-point noise and scientific notation (same approach as the Baseten formatting). */
function formatDeepInfraUsdAmount(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function readDeepInfraCentsAsUsd(value: unknown): string | undefined {
  const cents = readDeepInfraPositiveNumber(value);
  return cents !== undefined ? formatDeepInfraUsdAmount(cents / 100) : undefined;
}

/** `rate_per_input_token_cached` is a multiplier of the input price (not absolute cents); multiply by `cents_per_input_token`, then divide by 100. */
function readDeepInfraCachedInputUsd(pricing: Record<string, unknown>): string | undefined {
  const inputCents = readDeepInfraPositiveNumber(pricing.cents_per_input_token);
  const rate = readDeepInfraPositiveNumber(pricing.rate_per_input_token_cached);
  if (inputCents === undefined || rate === undefined) {
    return undefined;
  }
  return formatDeepInfraUsdAmount((inputCents * rate) / 100);
}

function readDeepInfraPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const type = readOptionalTrimmedString(pricing.type)?.toLowerCase();

  if (type === "tokens") {
    const inputPerTokenUsd = readDeepInfraCentsAsUsd(pricing.cents_per_input_token);
    const outputPerTokenUsd = readDeepInfraCentsAsUsd(pricing.cents_per_output_token);
    const cachedInputPerTokenUsd = readDeepInfraCachedInputUsd(pricing);
    return buildProviderListedModelPricing({
      ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
      ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
      ...(cachedInputPerTokenUsd ? { cachedInputPerTokenUsd } : {}),
    });
  }

  if (type === "image_units") {
    const imagePerUnitUsd = readDeepInfraCentsAsUsd(pricing.cents_per_image_unit);
    return buildProviderListedModelPricing(imagePerUnitUsd ? { imagePerUnitUsd } : {});
  }

  if (type === "output_length") {
    const costPerSecondUsd = readDeepInfraCentsAsUsd(pricing.cents_per_output_sec);
    return buildProviderListedModelPricing(
      costPerSecondUsd
        ? { videoDurationPricing: [{ resolution: "default", costPerSecondUsd }] }
        : {},
    );
  }

  // Unknown pricing.type: skip pricing without blocking the catalog.
  return undefined;
}

export function parseDeepInfraModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  const raw = readDeepInfraModelsArray(body);
  const entries: ProviderListedModelEntry[] = [];

  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue;
    }
    // `deprecated` is a Unix timestamp or null; any truthy value skips the model.
    if (item.deprecated) {
      continue;
    }

    const id = readOptionalTrimmedString(item.model_name);
    if (!id) {
      continue;
    }

    const type = readOptionalTrimmedString(item.type)?.toLowerCase();
    const isChat = type === DEEPINFRA_CHAT_MODEL_TYPE;
    const isImageGeneration = type !== undefined && DEEPINFRA_IMAGE_GENERATION_TYPES.has(type);
    const isVideoGeneration = type !== undefined && DEEPINFRA_VIDEO_GENERATION_TYPES.has(type);
    // Other types (embeddings / TTS / ASR / reranker / …) are not offered in the picker in this first version.
    if (!isChat && !isImageGeneration && !isVideoGeneration) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };

    const description = readOptionalTrimmedString(item.description);
    if (description) {
      modelEntry.description = description;
    }

    const contextLength = readPositiveIntegerModelTrait(item, "max_tokens");
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }

    if (isImageGeneration) {
      modelEntry.supportsImageGeneration = true;
    }
    if (isVideoGeneration) {
      modelEntry.supportsVideoGeneration = true;
    }

    // Chat capabilities only trust tags; reasoning is not inferred from tags (the runtime reasoning API is authoritative).
    if (isChat) {
      const tags = readDeepInfraTags(item.tags);
      if (tags.has("multimodal")) {
        modelEntry.supportsImageInput = true;
      }
      if (tags.has("input-video")) {
        modelEntry.supportsVideoInput = true;
      }
    }

    const isPartner = readBooleanModelTrait(item, "is_partner");
    if (isPartner !== undefined) {
      modelEntry.isPartner = isPartner;
    }

    const pricing = readDeepInfraPricing(item);
    if (pricing) {
      modelEntry.pricing = pricing;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export async function listDeepInfraModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  // `/models/list` needs no auth; when a key exists, Bearer is still sent (`bearerAuthHeaders` omits empty keys automatically).
  const url = deepInfraModelsListUrl(options.baseUrl);
  const init: RequestInit = {
    method: "GET",
    headers: bearerAuthHeaders(options.apiKey),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const json = await fetchModelsListJson(url, init);
  const entries = parseDeepInfraModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

/** Hugging Face Inference Providers router catalog root。 */
export const HUGGING_FACE_ROUTER_API_ROOT = "https://router.huggingface.co";

export const HUGGING_FACE_ROUTER_MODELS_URL = `${HUGGING_FACE_ROUTER_API_ROOT}/v1/models`;

const HUGGING_FACE_HUB_API_ROOT = "https://huggingface.co";

const HUGGING_FACE_HUB_MEDIA_PIPELINE_TAGS = [
  "text-to-image",
  "text-to-video",
  "image-to-video",
] as const;

const HUGGING_FACE_IMAGE_PIPELINE_TAGS = new Set(["text-to-image"]);

const HUGGING_FACE_VIDEO_PIPELINE_TAGS = new Set(["text-to-video", "image-to-video"]);

export function resolveHuggingFaceDisplayNameFromId(modelId: string): string {
  const trimmed = modelId.trim();
  const withoutRoutingSuffix = trimmed.includes(":")
    ? trimmed.slice(0, trimmed.lastIndexOf(":"))
    : trimmed;
  const lastSlash = withoutRoutingSuffix.lastIndexOf("/");
  const segment = lastSlash >= 0 ? withoutRoutingSuffix.slice(lastSlash + 1) : withoutRoutingSuffix;
  return segment.trim();
}

function readHuggingFaceModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function readHuggingFaceRouterProviderPricing(
  providerRecord: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(providerRecord.pricing);
  if (!pricing) {
    return undefined;
  }

  const inputPerMillion = readTogetherAiPositiveNumber(pricing.input);
  const outputPerMillion = readTogetherAiPositiveNumber(pricing.output);
  const inputPerTokenUsd =
    inputPerMillion !== undefined ? String(inputPerMillion / 1_000_000) : undefined;
  const outputPerTokenUsd =
    outputPerMillion !== undefined ? String(outputPerMillion / 1_000_000) : undefined;

  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
  });
}

function pickHuggingFaceRouterProviderRecord(
  providers: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(providers) || providers.length === 0) {
    return undefined;
  }

  const liveProviders = providers
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .filter((item) => readOptionalTrimmedString(item.status)?.toLowerCase() === "live");

  const candidates =
    liveProviders.length > 0
      ? liveProviders
      : providers
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => item !== undefined);

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((best, current) => {
    const bestContext = readPositiveIntegerModelTrait(best, "context_length") ?? 0;
    const currentContext = readPositiveIntegerModelTrait(current, "context_length") ?? 0;
    return currentContext > bestContext ? current : best;
  });
}

function readHuggingFaceHubInferenceProvider(record: Record<string, unknown>): string | undefined {
  const mappings = record.inferenceProviderMapping;
  if (!Array.isArray(mappings)) {
    return undefined;
  }

  for (const item of mappings) {
    const mapping = asRecord(item);
    if (!mapping) {
      continue;
    }
    const status = readOptionalTrimmedString(mapping.status)?.toLowerCase();
    if (status && status !== "live") {
      continue;
    }
    const provider = readOptionalTrimmedString(mapping.provider);
    if (provider) {
      return provider;
    }
  }

  return undefined;
}

export function parseHuggingFaceRouterModelsPayload(body: unknown): ProviderListedModelEntry[] {
  if (!isJsonObject(body) || !Array.isArray(body.data)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const item of body.data) {
    if (!isJsonObject(item)) {
      continue;
    }

    const id = readOptionalTrimmedString(item.id);
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = {
      id,
      displayName: resolveHuggingFaceDisplayNameFromId(id),
    };

    const architecture = asRecord(item.architecture);
    if (architecture) {
      const inputModalities = readHuggingFaceModalities(architecture.input_modalities);
      const outputModalities = readHuggingFaceModalities(architecture.output_modalities);
      if (inputModalities.includes("image")) {
        modelEntry.supportsImageInput = true;
      }
      if (outputModalities.includes("text") || outputModalities.length === 0) {
        // Conversational models from router source 1.
      }
    }

    const providerRecord = pickHuggingFaceRouterProviderRecord(item.providers);
    if (providerRecord) {
      const contextLength = readPositiveIntegerModelTrait(providerRecord, "context_length");
      if (contextLength !== undefined) {
        modelEntry.contextLength = contextLength;
      }
      const pricing = readHuggingFaceRouterProviderPricing(providerRecord);
      if (pricing) {
        modelEntry.pricing = pricing;
      }
    }

    const normalizedId = id.toLowerCase();
    if (normalizedId.includes("deepseek-r1") || normalizedId.includes("/r1")) {
      modelEntry.supportsReasoning = true;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export function parseHuggingFaceHubMediaModelsPayload(body: unknown): ProviderListedModelEntry[] {
  const raw = Array.isArray(body) ? body : [];
  const entries: ProviderListedModelEntry[] = [];

  for (const item of raw) {
    if (!isJsonObject(item)) {
      continue;
    }

    const id = readOptionalTrimmedString(item.id);
    const pipelineTag = readOptionalTrimmedString(item.pipeline_tag)?.toLowerCase();
    if (!id || !pipelineTag) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = {
      id,
      displayName: resolveHuggingFaceDisplayNameFromId(id),
    };

    if (HUGGING_FACE_IMAGE_PIPELINE_TAGS.has(pipelineTag)) {
      modelEntry.supportsImageGeneration = true;
    }
    if (HUGGING_FACE_VIDEO_PIPELINE_TAGS.has(pipelineTag)) {
      modelEntry.supportsVideoGeneration = true;
    }

    const inferenceProvider = readHuggingFaceHubInferenceProvider(item);
    if (inferenceProvider) {
      modelEntry.inferenceProvider = inferenceProvider;
    }

    entries.push(modelEntry);
  }

  return entries;
}

export function parseHuggingFaceHubLinkHeaderNextUrl(
  linkHeader: string | null,
): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

export function mergeHuggingFaceListedModelEntries(
  entries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const byId = new Map<string, ProviderListedModelEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, { ...entry });
      continue;
    }

    byId.set(entry.id, {
      ...existing,
      ...entry,
      ...((existing.displayName ?? entry.displayName)
        ? { displayName: existing.displayName ?? entry.displayName }
        : {}),
      ...((existing.pricing ?? entry.pricing)
        ? { pricing: existing.pricing ?? entry.pricing }
        : {}),
      ...((existing.contextLength ?? entry.contextLength)
        ? { contextLength: existing.contextLength ?? entry.contextLength }
        : {}),
      ...((existing.inferenceProvider ?? entry.inferenceProvider)
        ? { inferenceProvider: existing.inferenceProvider ?? entry.inferenceProvider }
        : {}),
      ...(existing.supportsImageInput || entry.supportsImageInput
        ? { supportsImageInput: true }
        : {}),
      ...(existing.supportsVideoInput || entry.supportsVideoInput
        ? { supportsVideoInput: true }
        : {}),
      ...(existing.supportsImageGeneration || entry.supportsImageGeneration
        ? { supportsImageGeneration: true }
        : {}),
      ...(existing.supportsVideoGeneration || entry.supportsVideoGeneration
        ? { supportsVideoGeneration: true }
        : {}),
      ...(existing.supportsReasoning || entry.supportsReasoning ? { supportsReasoning: true } : {}),
    });
  }

  return [...byId.values()];
}

function huggingFaceCatalogRequestHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = apiKey?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

async function fetchHuggingFaceRouterModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const init: RequestInit = {
    method: "GET",
    headers: huggingFaceCatalogRequestHeaders(options.apiKey),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const json = await fetchModelsListJson(HUGGING_FACE_ROUTER_MODELS_URL, init);
  return parseHuggingFaceRouterModelsPayload(json);
}

async function fetchHuggingFaceHubMediaModelsPage(
  url: string,
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<{ entries: ProviderListedModelEntry[]; nextUrl?: string }> {
  const init: RequestInit = {
    method: "GET",
    headers: huggingFaceCatalogRequestHeaders(options.apiKey),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Model list request failed: ${message}`, { cause: cause });
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : [];
  } catch {
    throw new Error(
      response.ok
        ? "Model list response is not valid JSON."
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }

  if (!response.ok) {
    throw new Error(`Model listing failed (HTTP ${String(response.status)}).`);
  }

  const nextUrl = parseHuggingFaceHubLinkHeaderNextUrl(response.headers.get("link"));
  return {
    entries: parseHuggingFaceHubMediaModelsPayload(json),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

async function listHuggingFaceHubMediaModelsForPipelineTag(
  pipelineTag: string,
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const allEntries: ProviderListedModelEntry[] = [];
  let nextUrl: string | undefined =
    `${HUGGING_FACE_HUB_API_ROOT}/api/models?inference_provider=all&pipeline_tag=${encodeURIComponent(pipelineTag)}`;

  while (nextUrl) {
    const page = await fetchHuggingFaceHubMediaModelsPage(nextUrl, options);
    allEntries.push(...page.entries);
    nextUrl = page.nextUrl;
  }

  return allEntries;
}

export async function listHuggingFaceModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const mediaLists = await Promise.all(
    HUGGING_FACE_HUB_MEDIA_PIPELINE_TAGS.map((pipelineTag) =>
      listHuggingFaceHubMediaModelsForPipelineTag(pipelineTag, options),
    ),
  );

  let chatModels: ProviderListedModelEntry[] = [];
  try {
    chatModels = await fetchHuggingFaceRouterModels(options);
  } catch (error) {
    console.error("[host-internal][list-models] hugging-face.router.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return mergeHuggingFaceListedModelEntries([...chatModels, ...mediaLists.flat()]).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Xiaomi Mimo: upstream /models returns no capability fields; multimodal models require a maintained allowlist. */
const XIAOMI_MULTIMODAL_MODEL_IDS = new Set(["mimo-v2.5", "mimo-v2-omni"]);

/** DeepSeek `/models` has no modality fields; only `deepseek-v4-flash-vision-exp` takes image input. */
function isDeepSeekV4VisionListedModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  const id = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return id === "deepseek-v4-flash-vision-exp";
}

export function parseXiaomiModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const modelId = id.trim();
    const isMultimodal = XIAOMI_MULTIMODAL_MODEL_IDS.has(modelId);
    entries.push({
      id: modelId,
      supportsImageInput: isMultimodal,
      supportsVideoInput: isMultimodal,
    });
  }
  return entries;
}

/** MiniMax: upstream /models returns no multimodal capability fields; only M3 supports image and video input. */
function isMinimaxM3MultimodalModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  const id = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return id.includes("m3") || id.includes("minimax-m3");
}

export function parseMinimaxModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const modelId = id.trim();
    const isMultimodal = isMinimaxM3MultimodalModelId(modelId);
    entries.push({
      id: modelId,
      supportsImageInput: isMultimodal,
      supportsVideoInput: isMultimodal,
    });
  }
  return entries;
}

const SKIPPED_ARK_MODEL_STATUSES = new Set(["shutdown", "retiring"]);

function readArkModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const modalities: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      modalities.push(item.trim().toLowerCase());
    }
  }
  return modalities;
}

function readArkInputModalities(record: Record<string, unknown>): string[] {
  const modalities = asRecord(record.modalities);
  return readArkModalities(modalities?.input_modalities);
}

/**
 * Ark `GET /api/v3/models`: OpenAI-shaped list with `domain`, `modalities`, `status`.
 */
export function parseArkModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
    if (status && SKIPPED_ARK_MODEL_STATUSES.has(status)) {
      continue;
    }

    const domain = typeof record.domain === "string" ? record.domain.trim() : "";
    const modelEntry: ProviderListedModelEntry = { id: id.trim() };

    const displayName = typeof record.name === "string" ? record.name.trim() : "";
    if (displayName.length > 0) {
      modelEntry.displayName = displayName;
    }

    const tokenLimits = asRecord(record.token_limits);
    const contextWindow = readPositiveIntegerModelTrait(tokenLimits ?? {}, "context_window");
    if (contextWindow !== undefined) {
      modelEntry.contextLength = contextWindow;
    }

    switch (domain) {
      case "VideoGeneration":
        modelEntry.supportsVideoGeneration = true;
        break;
      case "ImageGeneration":
        modelEntry.supportsImageGeneration = true;
        break;
      case "VLM": {
        const inputModalities = readArkInputModalities(record);
        if (inputModalities.includes("image")) {
          modelEntry.supportsImageInput = true;
        }
        if (inputModalities.includes("video")) {
          modelEntry.supportsVideoInput = true;
        }
        break;
      }
      default:
        break;
    }

    entries.push(modelEntry);
  }
  return entries;
}

/**
 * Native Gemini API `GET /v1beta/models` listing.
 * Only models whose `supportedGenerationMethods` include `generateContent` are kept.
 */
export function parseGoogleModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("models" in body)) {
    return [];
  }
  const raw = (body as { models?: unknown }).models;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const methods = record.supportedGenerationMethods;
    if (!Array.isArray(methods) || !methods.includes("generateContent")) {
      continue;
    }

    const baseModelId = readOptionalTrimmedString(record.baseModelId);
    const name = readOptionalTrimmedString(record.name);
    let id = baseModelId;
    if (!id && name) {
      id = name.startsWith("models/") ? name.slice("models/".length) : name;
    }
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };
    const displayName = readOptionalTrimmedString(record.displayName);
    const description = readOptionalTrimmedString(record.description);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    if (description) {
      modelEntry.description = description;
    }

    const inputLimit = readPositiveIntegerModelTrait(record, "inputTokenLimit");
    const outputLimit = readPositiveIntegerModelTrait(record, "outputTokenLimit");
    if (inputLimit !== undefined && outputLimit !== undefined) {
      modelEntry.contextLength = inputLimit + outputLimit;
    }

    entries.push(modelEntry);
  }
  return entries;
}

const SKIPPED_VERCEL_GATEWAY_MODEL_TYPES = new Set(["embedding", "reranking"]);

function vercelGatewayModelSupportsImageInput(record: Record<string, unknown>): boolean {
  const tags = record.tags;
  if (!Array.isArray(tags)) {
    return false;
  }

  return tags.some((tag) => typeof tag === "string" && tag.trim().toLowerCase() === "vision");
}

function attachGatewayAnthropicReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  const supportedReasoningEfforts = gatewayAnthropicClaudeSupportedEfforts(modelEntry.id);
  if (supportedReasoningEfforts === undefined) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts,
  };
}

function attachGatewayGeminiReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  const supportedReasoningEfforts = gatewayGoogleGeminiSupportedEfforts(modelEntry.id);
  if (supportedReasoningEfforts === undefined) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts: [...supportedReasoningEfforts],
  };
}

function attachGatewayMoonshotReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  const normalizedId = modelEntry.id.trim().toLowerCase();
  const bareId = normalizedId.includes("/")
    ? normalizedId.slice(normalizedId.lastIndexOf("/") + 1)
    : normalizedId;
  if (!/^kimi-k3(?:-|$)/.test(bareId)) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts: moonshotK3SupportedReasoningEfforts(),
  };
}

const OPENAI_GPT56_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

function isListedOpenAiGpt6AstraModel(modelId: string): boolean {
  const resolved = normalizeListedOpenAiModelIdForVersionCheck(modelId).toLowerCase();
  return /^gpt-6-astra(?:$|[-_])/.test(resolved);
}

function listedOpenAiGpt56ReasoningEfforts(modelId: string): readonly string[] {
  if (isListedOpenAiGpt6AstraModel(modelId)) {
    return OPENAI_GPT56_REASONING_EFFORTS.filter((effort) => effort !== "none");
  }

  return OPENAI_GPT56_REASONING_EFFORTS;
}

function normalizeListedOpenAiModelIdForVersionCheck(modelId: string): string {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("openai/")) {
    return trimmed.slice("openai/".length).trim();
  }
  if (lower.startsWith("openai.")) {
    return trimmed.slice("openai.".length).trim();
  }
  return trimmed;
}

function parseListedOpenAiGptModelVersion(
  modelId: string,
): { major: number; minor: number } | undefined {
  const normalized = normalizeListedOpenAiModelIdForVersionCheck(modelId).toLowerCase();

  const versioned = /^gpt-(\d+)\.(\d+)/.exec(normalized);
  if (versioned) {
    return {
      major: Number.parseInt(versioned[1] ?? "", 10),
      minor: Number.parseInt(versioned[2] ?? "", 10),
    };
  }

  const majorOnly = /^gpt-(\d+)(?:$|[-_])/.exec(normalized);
  if (majorOnly) {
    return {
      major: Number.parseInt(majorOnly[1] ?? "", 10),
      minor: 0,
    };
  }

  return undefined;
}

function isListedOpenAiGpt56OrLaterModel(modelId: string): boolean {
  const version = parseListedOpenAiGptModelVersion(modelId);
  if (!version) {
    return false;
  }

  if (version.major > 5) {
    return true;
  }

  return version.major === 5 && version.minor >= 6;
}

function attachGatewayOpenAiGpt56ReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  const normalizedId = modelEntry.id.trim().toLowerCase();
  const isGatewayOpenAiRoute = normalizedId.startsWith("openai/");
  const isDirectOpenAiGpt = !normalizedId.includes("/") && normalizedId.startsWith("gpt-");
  if (!isGatewayOpenAiRoute && !isDirectOpenAiGpt) {
    return modelEntry;
  }
  if (!isListedOpenAiGpt56OrLaterModel(modelEntry.id)) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts: [...listedOpenAiGpt56ReasoningEfforts(modelEntry.id)],
  };
}

function attachGatewayModelReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  return attachGatewayOpenAiGpt56ReasoningEfforts(
    attachGatewayMoonshotReasoningEfforts(
      attachGatewayGeminiReasoningEfforts(attachGatewayAnthropicReasoningEfforts(modelEntry)),
    ),
  );
}

function readOpenRouterSupportedReasoningEfforts(
  record: Record<string, unknown>,
): string[] | undefined {
  const reasoning = record.reasoning;
  if (typeof reasoning !== "object" || reasoning === null) {
    return undefined;
  }

  const supportedEfforts = (reasoning as Record<string, unknown>).supported_efforts;
  if (!Array.isArray(supportedEfforts)) {
    return undefined;
  }

  const efforts: string[] = [];
  for (const item of supportedEfforts) {
    if (typeof item === "string" && item.trim().length > 0) {
      efforts.push(item.trim().toLowerCase());
    }
  }

  // OpenRouter explicitly returns [] to indicate effort selection is unsupported; this must be distinguished from a missing field (undefined → fallback allowed).
  return efforts;
}

function attachOpenRouterAnthropicReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  if (modelEntry.supportedReasoningEfforts !== undefined) {
    return modelEntry;
  }

  const supportedReasoningEfforts = routedAnthropicClaudeSupportedEfforts(modelEntry.id);
  if (supportedReasoningEfforts === undefined) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts,
  };
}

export function parseVercelAiGatewayModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : undefined;
    if (type && SKIPPED_VERCEL_GATEWAY_MODEL_TYPES.has(type)) {
      continue;
    }

    if (!type) {
      entries.push(
        attachListedModelMetadata({ id: id.trim() }, record, readVercelGatewayPricing(record)),
      );
      continue;
    }

    if (type === "image") {
      entries.push(
        attachListedModelMetadata(
          { id: id.trim(), supportsImageGeneration: true },
          record,
          readVercelGatewayPricing(record),
        ),
      );
      continue;
    }

    if (type === "language") {
      const modelEntry: ProviderListedModelEntry = { id: id.trim() };
      const contextLength = readPositiveIntegerModelTrait(record, "context_window");
      if (contextLength !== undefined) {
        modelEntry.contextLength = contextLength;
      }
      if (vercelGatewayModelSupportsImageInput(record)) {
        modelEntry.supportsImageInput = true;
      }
      entries.push(attachListedModelMetadata(modelEntry, record, readVercelGatewayPricing(record)));
      continue;
    }

    if (type === "video") {
      entries.push(
        attachListedModelMetadata(
          { id: id.trim(), supportsVideoGeneration: true },
          record,
          readVercelGatewayPricing(record),
        ),
      );
      continue;
    }

    entries.push(
      attachListedModelMetadata({ id: id.trim() }, record, readVercelGatewayPricing(record)),
    );
  }
  return entries.map(attachGatewayModelReasoningEfforts);
}

function readOpenRouterModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const modalities: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      modalities.push(item.trim().toLowerCase());
    }
  }
  return modalities;
}

/** OpenRouter list item: `architecture.output_modalities` takes precedence, then top-level `output_modalities`. */
function readOpenRouterOutputModalities(record: Record<string, unknown>): string[] {
  const architecture = asRecord(record.architecture);
  const fromArchitecture = readOpenRouterModalities(architecture?.output_modalities);
  if (fromArchitecture.length > 0) {
    return fromArchitecture;
  }
  return readOpenRouterModalities(record.output_modalities);
}

/**
 * OpenRouter /models: distinguishes chat vs image generation solely via output_modalities; model id and pricing are not used for inference.
 * Contains image but not text → image generation; contains text → chat; neither → skip; missing → defaults to chat.
 */
export function parseOpenRouterModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    const outputModalities = readOpenRouterOutputModalities(record);
    if (outputModalities.length > 0) {
      const hasText = outputModalities.includes("text");
      const hasImage = outputModalities.includes("image");
      if (!hasText && !hasImage) {
        continue;
      }
      if (hasImage && !hasText) {
        entries.push(
          attachOpenRouterAnthropicReasoningEfforts(
            attachListedModelMetadata(
              { id: id.trim(), supportsImageGeneration: true },
              record,
              readOpenRouterPricing(record),
            ),
          ),
        );
        continue;
      }
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const supportedReasoningEfforts = readOpenRouterSupportedReasoningEfforts(record);
    if (supportedReasoningEfforts !== undefined) {
      modelEntry.supportedReasoningEfforts = supportedReasoningEfforts;
    }

    entries.push(
      attachOpenRouterAnthropicReasoningEfforts(
        attachListedModelMetadata(modelEntry, record, readOpenRouterPricing(record)),
      ),
    );
  }
  return entries;
}

export function parseAnthropicModelsPayload(body: unknown): string[] {
  return parseAnthropicModelEntriesPayload(body).map((entry) => entry.id);
}

export function parseAnthropicModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id === "string" && id.trim().length > 0) {
      const modelEntry: ProviderListedModelEntry = { id: id.trim() };
      const supportsImageInput = anthropicModelSupportsImageInput(record.capabilities);
      if (supportsImageInput !== undefined) {
        modelEntry.supportsImageInput = supportsImageInput;
      }
      const supportedReasoningEfforts = anthropicSupportedReasoningEfforts(record.capabilities);
      if (supportedReasoningEfforts !== undefined) {
        modelEntry.supportedReasoningEfforts = supportedReasoningEfforts;
      }
      entries.push(modelEntry);
    }
  }
  return entries;
}

export interface ListOpenAiCompatibleModelIdsOptions {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ListAnthropicModelIdsOptions {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ListProviderModelIdsOptions {
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  baseUrl: string;
  apiKey: string;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  cloudflareAccountId?: string;
  signal?: AbortSignal;
}

function requireApiKeyForModelListing(apiKey: string, provider?: ModelProviderId): void {
  if (!apiKey.trim() && provider !== "custom") {
    throw new Error("API Key must not be empty.");
  }
}

function bearerAuthHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * `GET {baseUrl}/models` with Bearer auth; returns sorted unique ids.
 * @throws Error with a short message on network/HTTP/parse failure.
 */
export async function listOpenAiCompatibleModelIds(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<string[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };

  const init: RequestInit = { method: "GET", headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const json = await fetchModelsListJson(url, init);
  const ids = parseOpenAiModelsPayload(json);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function fetchModelsListJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Model list request failed: ${message}`, { cause: cause });
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(
      response.ok
        ? "Model list response is not valid JSON."
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }

  if (!response.ok) {
    const errObj = typeof json === "object" && json !== null ? json : undefined;
    const errMsg =
      errObj &&
      "error" in errObj &&
      typeof (errObj as { error?: { message?: unknown } }).error?.message === "string"
        ? (errObj as { error: { message: string } }).error.message
        : undefined;
    throw new Error(
      errMsg && errMsg.trim().length > 0
        ? `Model listing failed (HTTP ${String(response.status)}): ${errMsg.trim()}`
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }

  return json;
}

export async function listOpenAiCompatibleModels(
  options: ListOpenAiCompatibleModelIdsOptions & { provider?: ModelProviderId },
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, options.provider);
}

async function listOpenAiCompatibleModelsForProvider(
  options: ListOpenAiCompatibleModelIdsOptions,
  provider?: ModelProviderId,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  requireApiKeyForModelListing(options.apiKey, provider);

  const headers: Record<string, string> = bearerAuthHeaders(options.apiKey);

  const init: RequestInit = { method: "GET", headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const json = await fetchModelsListJson(url, init);
  const entries = parseOpenAiCompatibleModelEntriesPayload(json, provider);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listAnthropicModelIds(
  options: ListAnthropicModelIdsOptions,
): Promise<string[]> {
  const entries = await listAnthropicModels(options);
  return entries.map((entry) => entry.id);
}

export async function listAnthropicModels(
  options: ListAnthropicModelIdsOptions & { provider?: ModelProviderId },
): Promise<ProviderListedModelEntry[]> {
  const url = anthropicModelsListUrl(options.baseUrl);
  requireApiKeyForModelListing(options.apiKey, options.provider);

  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
    ...(options.apiKey.trim() ? { "x-api-key": options.apiKey.trim() } : {}),
  };

  const init: RequestInit = { method: "GET", headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Model list request failed: ${message}`, { cause: cause });
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(
      response.ok
        ? "Model list response is not valid JSON."
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }

  if (!response.ok) {
    const errObj =
      typeof json === "object" && json !== null ? (json as Record<string, unknown>) : undefined;
    const error = errObj?.error;
    const errMsg =
      typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : undefined;
    throw new Error(
      errMsg && errMsg.trim().length > 0
        ? `Model listing failed (HTTP ${String(response.status)}): ${errMsg.trim()}`
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }

  const entries = parseAnthropicModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  if (options.provider === "xiaomi" && options.transportKind === "anthropic") {
    return listXiaomiModels({
      baseUrl: resolveProviderConnectApiBase("xiaomi", "openai-compatible"),
      apiKey: options.apiKey,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }

  if (options.provider === "meituan" && options.transportKind === "anthropic") {
    return listMeituanModels({
      baseUrl: resolveProviderConnectApiBase("meituan", "openai-compatible"),
      apiKey: options.apiKey,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }

  if (options.provider === "minimax" && options.transportKind === "anthropic") {
    return listMinimaxModels({
      baseUrl: minimaxOpenAiCompatibleListingBaseFromConnectBase(options.baseUrl),
      apiKey: options.apiKey,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }

  if (options.provider === "siliconflow") {
    return listSiliconFlowModels(options);
  }

  if (options.provider === "fireworks-ai") {
    return listFireworksAiModels(options);
  }

  if (options.provider === "together-ai") {
    return listTogetherAiModels(options);
  }

  if (options.provider === "groq") {
    return listGroqModels(options);
  }

  if (options.provider === "deepinfra") {
    return listDeepInfraModels(options);
  }

  if (options.provider === "baseten") {
    return listBasetenModels(options);
  }

  if (options.provider === "hugging-face") {
    return listHuggingFaceModels(options);
  }

  if (options.provider === "cohere") {
    return listCohereModels(options);
  }

  if (options.transportKind === "anthropic" || options.provider === "anthropic") {
    return listAnthropicModels(options);
  }

  if (options.provider === "moonshot-ai") {
    return listMoonshotModels(options);
  }

  if (options.provider === "stepfun") {
    return listOpenAiCompatibleModelsForProvider(options, "stepfun");
  }

  if (options.provider === "kimi-code") {
    return listKimiCodeModels(options);
  }

  if (options.provider === "minimax") {
    return listMinimaxModels(options);
  }

  if (options.provider === "xiaomi") {
    return listXiaomiModels(options);
  }

  if (options.provider === "xai") {
    return listXaiModels(options);
  }

  if (options.provider === "vercel-ai-gateway") {
    return listVercelAiGatewayModels(options);
  }

  if (options.provider === "openrouter") {
    return listOpenRouterModels(options);
  }

  if (options.provider === "cloudflare-ai-gateway") {
    throw new Error(
      "Cloudflare AI Gateway has no model catalog API; enter the model ID manually (e.g. openai/gpt-4.1-mini or @cf/meta/llama-3.1-8b-instruct).",
    );
  }

  if (options.provider === "volcengine") {
    return listArkModels(options, "volcengine");
  }

  if (options.provider === "byteplus") {
    return listArkModels(options, "byteplus");
  }

  if (options.provider === "meituan") {
    return listMeituanModels(options);
  }

  if (options.provider === "tencent-tokenhub") {
    return listOpenAiCompatibleModelsForProvider(options, "tencent-tokenhub");
  }

  if (options.provider === "mistral") {
    return listOpenAiCompatibleModelsForProvider(options, "mistral");
  }

  if (options.provider === "google") {
    return listGoogleModels(options);
  }

  if (options.provider === "google-vertex-ai") {
    return listGoogleVertexProviderModels(options);
  }

  if (options.provider === "amazon-bedrock") {
    return listBedrockProviderModels(options);
  }

  if (options.provider === "azure") {
    throw new Error("Azure has no /models endpoint; enter the deployment name manually.");
  }

  return listOpenAiCompatibleModels(options);
}

export async function listGoogleVertexProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const extracted = extractVertexProjectAndLocationFromApiBase(options.baseUrl);
  const project = options.vertexProject?.trim() || extracted.project;
  const location = options.vertexLocation?.trim() || extracted.location;
  if (!project || !location) {
    throw new Error("Listing Google Vertex models requires a GCP project ID and location.");
  }

  try {
    const { listVertexModels } = await import("./google-vertex-models.js");
    return await listVertexModels({
      project,
      location,
      ...(options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
      ...(options.vertexClientEmail?.trim()
        ? { vertexClientEmail: options.vertexClientEmail.trim() }
        : {}),
      ...(options.vertexPrivateKey?.trim()
        ? { vertexPrivateKey: options.vertexPrivateKey.trim() }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Model listing failed (Google Vertex AI): ${message}`, { cause: error });
  }
}

export async function listBedrockProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const region = options.awsRegion?.trim() || extractAwsRegionFromBedrockApiBase(options.baseUrl);
  if (!region) {
    throw new Error("Listing Amazon Bedrock models requires an AWS region.");
  }

  try {
    const { listBedrockModels } = await import("./bedrock-models.js");
    return await listBedrockModels({
      region,
      ...(options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
      ...(options.accessKeyId?.trim() ? { accessKeyId: options.accessKeyId.trim() } : {}),
      ...(options.secretAccessKey?.trim()
        ? { secretAccessKey: options.secretAccessKey.trim() }
        : {}),
      ...(options.sessionToken?.trim() ? { sessionToken: options.sessionToken.trim() } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Model listing failed (Amazon Bedrock): ${message}`, { cause: error });
  }
}

export { bedrockApiBaseFromRegion, extractAwsRegionFromBedrockApiBase } from "./bedrock-region.js";
export {
  vertexApiBaseFromProjectAndLocation,
  extractVertexProjectAndLocationFromApiBase,
} from "./google-vertex-endpoints.js";

export async function listMoonshotModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "moonshot-ai");
}

export async function listKimiCodeModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "kimi-code");
}

export async function listMinimaxModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "minimax");
}

export async function listXiaomiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "xiaomi");
}

export async function listXaiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "xai");
}

export async function listVercelAiGatewayModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "vercel-ai-gateway");
}

export async function listOpenRouterModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, "openrouter");
}

export async function listArkModels(
  options: ListOpenAiCompatibleModelIdsOptions,
  provider: "volcengine" | "byteplus",
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, provider);
}

/** @deprecated Use parseArkModelEntriesPayload */
export const parseVolcengineModelEntriesPayload = parseArkModelEntriesPayload;

/** @deprecated Use listArkModels */
export async function listVolcengineModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listArkModels(options, "volcengine");
}

/**
 * Meituan LongCat: the `GET /models` list contains only ids; metadata requires a per-model `GET /models/{id}`.
 * The current model count is small enough to fetch in parallel; if the count grows, batching or upstream improvements may be needed.
 */
export async function listMeituanModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  const init: RequestInit = { method: "GET", headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const listJson = await fetchModelsListJson(url, init);
  const listedIds = parseOpenAiModelsPayload(listJson);
  if (listedIds.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    listedIds.map(async (modelId): Promise<ProviderListedModelEntry> => {
      try {
        const detailUrl = openAiCompatibleModelDetailUrl(options.baseUrl, modelId);
        const detailJson = await fetchModelsListJson(detailUrl, init);
        const parsed = parseMeituanModelDetailPayload(detailJson);
        return parsed ?? { id: modelId };
      } catch {
        return { id: modelId };
      }
    }),
  );

  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Google Gemini: the model catalog uses the native `/v1beta/models` (not the OpenAI-compatible `/openai/models`).
 * Local machines / CI usually cannot reach generativelanguage.googleapis.com directly; integration must be verified manually in an environment with network access.
 */
export async function listGoogleModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  assertGoogleGeminiApiBase(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error("API Key must not be empty.");
  }

  const allEntries: ProviderListedModelEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = googleNativeModelsListUrl(options.baseUrl, pageToken);
    const headers: Record<string, string> = {
      "x-goog-api-key": key,
    };
    const init: RequestInit = { method: "GET", headers };
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    const json = await fetchModelsListJson(url, init);
    allEntries.push(...parseGoogleModelEntriesPayload(json));

    pageToken =
      typeof json === "object" && json !== null && "nextPageToken" in json
        ? readOptionalTrimmedString((json as { nextPageToken?: unknown }).nextPageToken)
        : undefined;
  } while (pageToken);

  return dedupeProviderListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listProviderModelIds(
  options: ListProviderModelIdsOptions,
): Promise<string[]> {
  return (await listProviderModels(options)).map((entry) => entry.id);
}

function anthropicModelSupportsImageInput(value: unknown): boolean | undefined {
  const capabilities = asRecord(value);
  if (!capabilities) {
    return undefined;
  }
  return capabilitySupported(capabilities.image_input);
}

function anthropicSupportedReasoningEfforts(value: unknown): string[] | undefined {
  const capabilities = asRecord(value);
  if (!capabilities) {
    return undefined;
  }
  const effort = asRecord(capabilities.effort);
  if (!effort) {
    return undefined;
  }

  if (capabilitySupported(effort) !== true) {
    return [];
  }

  return ANTHROPIC_REASONING_LEVELS.filter((level) => capabilitySupported(effort[level]) === true);
}

function capabilitySupported(value: unknown): boolean | undefined {
  const record = asRecord(value);
  if (!record || typeof record.supported !== "boolean") {
    return undefined;
  }
  return record.supported;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function dedupeProviderListedModelEntries(
  entries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const seen = new Set<string>();
  const deduped: ProviderListedModelEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    deduped.push({
      id: entry.id,
      ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
      ...(entry.supportsImageInput !== undefined
        ? { supportsImageInput: entry.supportsImageInput }
        : {}),
      ...(entry.supportsVideoInput !== undefined
        ? { supportsVideoInput: entry.supportsVideoInput }
        : {}),
      ...(entry.supportsVideoGeneration !== undefined
        ? { supportsVideoGeneration: entry.supportsVideoGeneration }
        : {}),
      ...(entry.supportsImageGeneration !== undefined
        ? { supportsImageGeneration: entry.supportsImageGeneration }
        : {}),
      ...(entry.supportsReasoning !== undefined
        ? { supportsReasoning: entry.supportsReasoning }
        : {}),
      ...(entry.supportsThinkingType !== undefined
        ? { supportsThinkingType: entry.supportsThinkingType }
        : {}),
      ...(entry.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
      ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
      ...(entry.supportedReasoningEfforts !== undefined
        ? { supportedReasoningEfforts: [...entry.supportedReasoningEfforts] }
        : {}),
      ...(entry.isPartner !== undefined ? { isPartner: entry.isPartner } : {}),
    });
  }
  return deduped;
}

function readBooleanModelTrait(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveIntegerModelTrait(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPricingField(pricing: Record<string, unknown>, key: string): string | undefined {
  return readOptionalTrimmedString(pricing[key]);
}

function buildProviderListedModelPricing(
  fields: ProviderListedModelPricing,
): ProviderListedModelPricing | undefined {
  const hasTokenPricing =
    fields.inputPerTokenUsd ||
    fields.outputPerTokenUsd ||
    fields.cachedInputPerTokenUsd ||
    fields.imagePerUnitUsd ||
    fields.requestPerCallUsd ||
    fields.imagePerMegapixelUsd;
  const hasVideoDurationPricing =
    fields.videoDurationPricing !== undefined && fields.videoDurationPricing.length > 0;
  const hasExamplePricing = fields.imageExamplePricing || fields.videoExamplePricing;
  if (!hasTokenPricing && !hasVideoDurationPricing && !hasExamplePricing) {
    return undefined;
  }
  return {
    ...(fields.inputPerTokenUsd ? { inputPerTokenUsd: fields.inputPerTokenUsd } : {}),
    ...(fields.outputPerTokenUsd ? { outputPerTokenUsd: fields.outputPerTokenUsd } : {}),
    ...(fields.cachedInputPerTokenUsd
      ? { cachedInputPerTokenUsd: fields.cachedInputPerTokenUsd }
      : {}),
    ...(fields.imagePerUnitUsd ? { imagePerUnitUsd: fields.imagePerUnitUsd } : {}),
    ...(fields.requestPerCallUsd ? { requestPerCallUsd: fields.requestPerCallUsd } : {}),
    ...(hasVideoDurationPricing ? { videoDurationPricing: fields.videoDurationPricing } : {}),
    ...(fields.imagePerMegapixelUsd ? { imagePerMegapixelUsd: fields.imagePerMegapixelUsd } : {}),
    ...(fields.imageExamplePricing ? { imageExamplePricing: fields.imageExamplePricing } : {}),
    ...(fields.videoExamplePricing ? { videoExamplePricing: fields.videoExamplePricing } : {}),
  };
}

function readVercelGatewayVideoDurationPricing(
  pricing: Record<string, unknown>,
): ProviderListedModelVideoDurationPricing[] | undefined {
  const raw = pricing.video_duration_pricing;
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const entries: ProviderListedModelVideoDurationPricing[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const resolution = readOptionalTrimmedString(record.resolution);
    const costPerSecondUsd = readOptionalTrimmedString(record.cost_per_second);
    const audio = readBooleanModelTrait(record, "audio");
    if (!resolution || !costPerSecondUsd) {
      continue;
    }
    entries.push({
      resolution,
      costPerSecondUsd,
      ...(audio === true ? { audio: true } : {}),
    });
  }
  return entries.length > 0 ? entries : undefined;
}

function readVercelGatewayPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = readPricingField(pricing, "input");
  const outputPerTokenUsd = readPricingField(pricing, "output");
  const imagePerUnitUsd = readPricingField(pricing, "image");
  const requestPerCallUsd = readPricingField(pricing, "request");
  const videoDurationPricing = readVercelGatewayVideoDurationPricing(pricing);
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
    ...(videoDurationPricing ? { videoDurationPricing } : {}),
  });
}

function readOpenRouterPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = readPricingField(pricing, "prompt");
  const outputPerTokenUsd = readPricingField(pricing, "completion");
  const imagePerUnitUsd = readPricingField(pricing, "image");
  const requestPerCallUsd = readPricingField(pricing, "request");
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
  });
}

function attachListedModelMetadata(
  modelEntry: ProviderListedModelEntry,
  record: Record<string, unknown>,
  pricing?: ProviderListedModelPricing,
): ProviderListedModelEntry {
  const displayName = readOptionalTrimmedString(record.name);
  const description = readOptionalTrimmedString(record.description);
  const contextLength =
    modelEntry.contextLength ?? readPositiveIntegerModelTrait(record, "context_length");
  return {
    ...modelEntry,
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(pricing ? { pricing } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
  };
}

function readMeituanModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function readMeituanSupportedParameters(record: Record<string, unknown>): string[] {
  const raw = record.supported_parameters;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** LongCat pricing fields are USD/M tokens; converted to internal per-token USD strings for uniform UI display. */
function convertMeituanPerMillionUsdToPerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const perMillion = Number(value);
  if (!Number.isFinite(perMillion)) {
    return undefined;
  }
  return String(perMillion / 1_000_000);
}

function readMeituanPricing(
  record: Record<string, unknown>,
): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = convertMeituanPerMillionUsdToPerToken(
    readPricingField(pricing, "prompt"),
  );
  const outputPerTokenUsd = convertMeituanPerMillionUsdToPerToken(
    readPricingField(pricing, "completion"),
  );
  // pricing.cached_tokens has no internal field yet; not persisted
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
  });
}

export function parseMeituanModelDetailPayload(
  body: unknown,
): ProviderListedModelEntry | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const id = readOptionalTrimmedString(record.id);
  if (!id) {
    return undefined;
  }

  const modelEntry: ProviderListedModelEntry = { id };
  const displayName = readOptionalTrimmedString(record.name);
  if (displayName) {
    modelEntry.displayName = displayName;
  }

  const contextLength = readPositiveIntegerModelTrait(record, "context_length");
  if (contextLength !== undefined) {
    modelEntry.contextLength = contextLength;
  }

  const architecture = asRecord(record.architecture);
  const inputModalities = readMeituanModalities(architecture?.input_modalities);
  if (inputModalities.includes("image")) {
    modelEntry.supportsImageInput = true;
  }
  if (inputModalities.includes("video")) {
    modelEntry.supportsVideoInput = true;
  }

  const outputModalities = readMeituanModalities(architecture?.output_modalities);
  if (outputModalities.includes("image") && !outputModalities.includes("text")) {
    modelEntry.supportsImageGeneration = true;
  }

  const supportedParameters = readMeituanSupportedParameters(record);
  if (supportedParameters.includes("thinking")) {
    modelEntry.supportsThinkingSwitch = true;
  }

  const pricing = readMeituanPricing(record);
  if (pricing) {
    modelEntry.pricing = pricing;
  }

  return modelEntry;
}

export function moonshotSupportedReasoningEfforts(
  supportsReasoning: boolean,
  modelId?: string,
): string[] {
  if (!supportsReasoning) {
    return [];
  }
  const normalizedId = modelId?.trim().toLowerCase() ?? "";
  const bareId = normalizedId.includes("/")
    ? normalizedId.slice(normalizedId.lastIndexOf("/") + 1)
    : normalizedId;
  if (/^kimi-k3(?:-|$)/.test(bareId)) {
    return moonshotK3SupportedReasoningEfforts();
  }
  return ["minimal", "low", "medium", "high"];
}

export function moonshotK3SupportedReasoningEfforts(): string[] {
  return ["low", "high", "max"];
}

const ANTHROPIC_REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
