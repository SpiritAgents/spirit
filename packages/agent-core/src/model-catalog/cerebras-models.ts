import type {
  ListOpenAiCompatibleModelIdsOptions,
  ProviderListedModelCatalogMetadata,
  ProviderListedModelEntry,
  ProviderListedModelRateLimits,
} from "./openai-models.js";
import { openAiCompatibleModelsListUrl } from "./openai-models.js";

export const CEREBRAS_SHARED_MODEL_IDS = ["gpt-oss-120b", "qwen-3.8-27b"] as const;

const SHARED_MODEL_IDS: ReadonlySet<string> = new Set(CEREBRAS_SHARED_MODEL_IDS);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelRecords(payload: unknown): Record<string, unknown>[] {
  const data = asRecord(payload)?.data;
  return Array.isArray(data)
    ? data.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : [];
}

function sharedModelId(record: Record<string, unknown>): string | undefined {
  const id = typeof record.id === "string" ? record.id.trim() : "";
  return SHARED_MODEL_IDS.has(id) ? id : undefined;
}

function cerebrasReasoningDeclaration(id: string): Partial<ProviderListedModelEntry> {
  if (id === "gpt-oss-120b") {
    // Cerebras documents this Shared model as always-on; do not invent an off switch or efforts.
    return { supportsThinkingType: "only", supportsThinkingSwitch: false };
  }
  // Qwen accepts `none` to disable reasoning. No on-state effort/default is documented here.
  return {
    supportsThinkingSwitch: true,
    thinkingSwitch: { off: { body: { reasoning_effort: "none" } } },
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function optionalNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function optionalBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "boolean") {
      result[key] = item;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseRateLimits(
  limits: Record<string, unknown> | undefined,
): ProviderListedModelRateLimits | undefined {
  if (!limits) {
    return undefined;
  }
  const readLimit = (value: unknown): number | null | undefined =>
    value === null ? null : optionalNonnegativeInteger(value);
  const requestsPerMinute = readLimit(limits.requests_per_minute);
  const tokensPerMinute = readLimit(limits.tokens_per_minute);
  if (requestsPerMinute === undefined && tokensPerMinute === undefined) {
    return undefined;
  }
  return {
    ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
    ...(tokensPerMinute !== undefined ? { tokensPerMinute } : {}),
  };
}

function parseCatalogMetadata(
  record: Record<string, unknown>,
  capabilities: Record<string, unknown> | undefined,
  limits: Record<string, unknown> | undefined,
): ProviderListedModelCatalogMetadata | undefined {
  const architectureRecord = asRecord(record.architecture);
  const modality = optionalString(architectureRecord?.modality);
  const tokenizer = optionalString(architectureRecord?.tokenizer);
  const instructType = optionalString(architectureRecord?.instruct_type);
  const architecture =
    modality !== undefined || tokenizer !== undefined || instructType !== undefined
      ? {
          ...(modality !== undefined ? { modality } : {}),
          ...(tokenizer !== undefined ? { tokenizer } : {}),
          ...(instructType !== undefined ? { instructType } : {}),
        }
      : undefined;
  const datacenterLocations = Array.isArray(record.datacenter_locations)
    ? record.datacenter_locations.flatMap((location) =>
        typeof location === "string" && location.trim().length > 0 ? [location.trim()] : [],
      )
    : undefined;
  const created = optionalNonnegativeInteger(record.created);
  const ownedBy = optionalString(record.owned_by);
  const huggingFaceId = optionalString(record.hugging_face_id);
  const booleanCapabilities = optionalBooleanRecord(capabilities);
  const supportedParameters = optionalBooleanRecord(record.supported_parameters);
  const quantization = optionalString(record.quantization);
  const rateLimits = parseRateLimits(limits);
  const metadata: ProviderListedModelCatalogMetadata = {
    ...(created !== undefined ? { created } : {}),
    ...(ownedBy !== undefined ? { ownedBy } : {}),
    ...(huggingFaceId !== undefined ? { huggingFaceId } : {}),
    ...(booleanCapabilities !== undefined ? { capabilities: booleanCapabilities } : {}),
    ...(supportedParameters !== undefined ? { supportedParameters } : {}),
    ...(architecture !== undefined ? { architecture } : {}),
    ...(datacenterLocations !== undefined ? { datacenterLocations } : {}),
    ...(typeof record.deprecated === "boolean" ? { deprecated: record.deprecated } : {}),
    ...(typeof record.preview === "boolean" ? { preview: record.preview } : {}),
    ...(quantization !== undefined ? { quantization } : {}),
    ...(rateLimits !== undefined ? { rateLimits } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/** Authenticated Shared Inference ids. Dedicated and public-only entries are never imported. */
export function parseCerebrasModelEntriesPayload(payload: unknown): ProviderListedModelEntry[] {
  const entries = modelRecords(payload)
    .map((record) => sharedModelId(record))
    .filter((id): id is string => id !== undefined)
    .map((id) => ({ id, ...cerebrasReasoningDeclaration(id) }));
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

/** Rich public metadata, still restricted to the documented Shared Inference allowlist. */
export function parseCerebrasPublicModelEntriesPayload(
  payload: unknown,
): ProviderListedModelEntry[] {
  const entries: ProviderListedModelEntry[] = [];
  for (const record of modelRecords(payload)) {
    const id = sharedModelId(record);
    if (!id) {
      continue;
    }

    const capabilities = asRecord(record.capabilities);
    const limits = asRecord(record.limits);
    const pricing = asRecord(record.pricing);
    const inputPerTokenUsd = optionalString(pricing?.prompt);
    const outputPerTokenUsd = optionalString(pricing?.completion);
    const entry: ProviderListedModelEntry = { id, ...cerebrasReasoningDeclaration(id) };
    const displayName = optionalString(record.name);
    const description = optionalString(record.description);
    const contextLength = optionalPositiveInteger(limits?.max_context_length);
    const maxCompletionTokens = optionalPositiveInteger(limits?.max_completion_tokens);
    const catalogMetadata = parseCatalogMetadata(record, capabilities, limits);
    if (displayName !== undefined) {
      entry.displayName = displayName;
    }
    if (description !== undefined) {
      entry.description = description;
    }
    if (inputPerTokenUsd !== undefined || outputPerTokenUsd !== undefined) {
      entry.pricing = {
        ...(inputPerTokenUsd !== undefined ? { inputPerTokenUsd } : {}),
        ...(outputPerTokenUsd !== undefined ? { outputPerTokenUsd } : {}),
      };
    }
    if (typeof capabilities?.vision === "boolean") {
      entry.supportsImageInput = capabilities.vision;
    }
    if (typeof capabilities?.reasoning === "boolean") {
      entry.supportsReasoning = capabilities.reasoning;
    }
    if (contextLength !== undefined) {
      entry.contextLength = contextLength;
    }
    if (maxCompletionTokens !== undefined) {
      entry.maxCompletionTokens = maxCompletionTokens;
    }
    if (catalogMetadata !== undefined) {
      entry.catalogMetadata = catalogMetadata;
    }
    entries.push(entry);
  }
  return entries;
}

/** Join rich metadata onto the authenticated inventory; the public list cannot add models. */
export function mergeCerebrasModelEntries(
  authenticatedEntries: readonly ProviderListedModelEntry[],
  publicEntries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const publicById = new Map(publicEntries.map((entry) => [entry.id, entry]));
  return authenticatedEntries.map((entry) => ({
    ...entry,
    ...publicById.get(entry.id),
    id: entry.id,
  }));
}

export function cerebrasPublicModelsListUrl(baseUrl: string): string {
  const authenticatedUrl = new URL(openAiCompatibleModelsListUrl(baseUrl));
  authenticatedUrl.pathname = authenticatedUrl.pathname.replace(
    /(?:\/v1)?\/models$/u,
    "/public/v1/models",
  );
  return authenticatedUrl.toString();
}

async function fetchCerebrasCatalogJson(
  url: string,
  apiKey: string | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (apiKey !== undefined) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (cause) {
    throw new Error(
      `Model list request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      response.ok
        ? "Model list response is not valid JSON."
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }
  if (!response.ok) {
    const error = asRecord(asRecord(payload)?.error);
    const message = optionalString(error?.message) ?? optionalString(asRecord(payload)?.message);
    throw new Error(
      `Model listing failed (HTTP ${String(response.status)}).${message ? ` ${message}` : ""}`,
    );
  }
  return payload;
}

export async function listCerebrasModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("API Key must not be empty.");
  }

  // The authenticated inventory is authoritative. In particular, never fall back to importing
  // the public catalog when this request fails: it also contains Dedicated-only architectures.
  const authenticatedPayload = await fetchCerebrasCatalogJson(
    openAiCompatibleModelsListUrl(options.baseUrl),
    apiKey,
    options.signal,
  );
  const authenticatedEntries = parseCerebrasModelEntriesPayload(authenticatedPayload);
  if (authenticatedEntries.length === 0) {
    return [];
  }

  let publicEntries: ProviderListedModelEntry[] = [];
  try {
    const publicPayload = await fetchCerebrasCatalogJson(
      cerebrasPublicModelsListUrl(options.baseUrl),
      undefined,
      options.signal,
    );
    publicEntries = parseCerebrasPublicModelEntriesPayload(publicPayload);
  } catch {
    // Rich metadata is additive; a public-catalog outage must not disconnect valid Shared access.
  }
  return mergeCerebrasModelEntries(authenticatedEntries, publicEntries).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}
