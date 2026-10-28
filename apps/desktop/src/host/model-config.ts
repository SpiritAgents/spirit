import { type LlmModelCapabilities } from "@spiritagent/agent-core";
import {
  dedupeProviderListedModelEntries,
  listAnthropicModels,
  listCohereModels,
  listFireworksAiModels,
  listGoogleModels,
  listHuggingFaceModels,
  listMeituanModels,
  listMinimaxModels,
  listSiliconFlowModels,
  resolveModelCatalogParser,
  type ModelCatalogParserDescriptor,
  type ProviderListedModelEntry,
} from "@spiritagent/agent-core/model-catalog";
import { extractAwsRegionFromBedrockApiBase } from "@spiritagent/agent-core/model-catalog/bedrock-region";
import { listBedrockModels } from "@spiritagent/agent-core/model-catalog/bedrock-models";
import { extractVertexProjectAndLocationFromApiBase } from "@spiritagent/agent-core/model-catalog/google-vertex-endpoints";
import { listVertexModels } from "@spiritagent/agent-core/model-catalog/google-vertex-models";
import {
  findProviderPreset,
  type ProviderPresetCatalog,
} from "@spiritagent/agent-core/provider-presets";
import {
  providerInternalSlotAccount,
  type ProviderOptions,
  type SpiritTransportKind,
} from "@spiritagent/host-internal";

import type {
  AddProviderModelsRequest,
  DesktopModelCapability,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
} from "../types.js";
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
  writeModelCatalogCache,
} from "./model-catalog-cache.js";
import { invalidateModelCatalogHintsMemo } from "./snapshot.js";
import {
  catalogParserNameForProvider,
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesProviderListedModelCatalogMetadata,
} from "./model-catalog-metadata.js";
import {
  resolveComposerDirectMediaTool,
  type DirectMediaTool,
} from "../lib/composer-direct-media.js";
import { getKeyringPassword } from "./keyring-secret.js";
import { defaultCustomModelCapabilities } from "./storage.js";

export { resolveComposerDirectMediaTool, type DirectMediaTool };

/** Keyring service for internal provider credential accounts (`Spirit`, shared with CLI). */
const KEYRING_SERVICE = "Spirit";

export function modelCapabilitiesFromConfig(
  capabilities: readonly DesktopModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes("languageModel") ? { languageModel: true } : {}),
    ...(capabilities.includes("image") ? { imageInput: true } : {}),
    ...(capabilities.includes("audio") ? { audioInput: true } : {}),
    ...(capabilities.includes("video") ? { videoInput: true } : {}),
    ...(capabilities.includes("imageGeneration") ? { imageGeneration: true } : {}),
  };
}

/**
 * The catalog descriptor driving a scope's listing: the preset manifest's `catalog` block for
 * built-in providers; custom entries fall back to the generic descriptor of their transport.
 */
export function catalogDescriptorForProvider(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
}): ProviderPresetCatalog | undefined {
  const preset = input.providerId ? findProviderPreset(input.providerId) : undefined;
  if (preset) {
    return preset.catalog;
  }
  const parser = catalogParserNameForProvider(input);
  return parser !== undefined ? { parser, endpoint: "/models" } : undefined;
}

export interface CatalogFetchInput {
  /** Provider entry id (preset id or custom slug); drives cache keying and the descriptor lookup. */
  providerId?: string;
  transportKind: SpiritTransportKind;
  /** The materialized connect base (config `apiBase` — the runtime truth). */
  apiBase: string;
  /** Bearer key; the anthropic transport shape sends it as `x-api-key` instead. */
  apiKey: string;
  /** Transport options (`awsRegion` / vertex `project` / `location`) for SDK-sourced listings. */
  options?: ProviderOptions;
  /** IAM slots for bedrock listings. */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Service-account slots for vertex listings. */
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  signal?: AbortSignal;
}

type CatalogLister = (
  input: Pick<CatalogFetchInput, "apiBase" | "apiKey" | "signal">,
) => Promise<ProviderListedModelEntry[]>;

/**
 * Listing shapes whose fetch is more than one bare GET (pagination, typed sub-listings,
 * per-model detail fetches, listing-base rewrites, non-Bearer auth) keep their exported
 * agent-core listers; every other parser is fetched as `GET {apiBase}{endpoint}` + `parseList`.
 */
const SPECIALIZED_CATALOG_LISTERS: Readonly<Record<string, CatalogLister>> = {
  "anthropic-models": (input) =>
    listAnthropicModels({
      baseUrl: input.apiBase,
      apiKey: input.apiKey,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    }),
  "google-gemini-models": (input) =>
    listGoogleModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "siliconflow-models": (input) =>
    listSiliconFlowModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "fireworks-gateway-models": (input) =>
    listFireworksAiModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "cohere-models": (input) => listCohereModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "huggingface-models": (input) =>
    listHuggingFaceModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "meituan-models": (input) => listMeituanModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
  "minimax-models": (input) => listMinimaxModels({ baseUrl: input.apiBase, apiKey: input.apiKey }),
};

function catalogListingUrl(apiBase: string, endpoint: string): string {
  if (/^https?:\/\//u.test(endpoint)) {
    return endpoint;
  }
  return `${apiBase.replace(/\/+$/u, "")}${endpoint}`;
}

async function fetchCatalogJson(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    headers["Authorization"] = `Bearer ${trimmedKey}`;
  }
  const init: RequestInit = { method: "GET", headers };
  if (signal !== undefined) {
    init.signal = signal;
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Model list request failed: ${message}`, { cause });
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
    const record =
      typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    const errorMessage =
      typeof (record["error"] as { message?: unknown } | undefined)?.message === "string"
        ? ((record["error"] as { message: string }).message as string)
        : undefined;
    throw new Error(
      errorMessage && errorMessage.trim().length > 0
        ? `Model listing failed (HTTP ${String(response.status)}): ${errorMessage.trim()}`
        : `Model listing failed (HTTP ${String(response.status)}).`,
    );
  }
  return json;
}

/** Generic descriptor-composed fetch: list (plus typed sub-listings / per-model detail). */
async function fetchCatalogEntriesWithDescriptor(
  input: CatalogFetchInput,
  descriptor: ModelCatalogParserDescriptor,
  endpoint: string,
): Promise<ProviderListedModelEntry[]> {
  const base = descriptor.resolveListingBase?.(input.apiBase) ?? input.apiBase;
  const url = catalogListingUrl(base, endpoint);
  const queries = descriptor.queries;
  let entries: ProviderListedModelEntry[];
  if (queries && queries.length > 0) {
    const all: ProviderListedModelEntry[] = [];
    for (const query of queries) {
      const json = await fetchCatalogJson(`${url}?${query.query}`, input.apiKey, input.signal);
      all.push(...query.parse(json));
    }
    entries = descriptor.merge ? descriptor.merge(all) : dedupeProviderListedModelEntries(all);
  } else {
    const json = await fetchCatalogJson(url, input.apiKey, input.signal);
    entries = descriptor.parseList(json);
  }

  if (descriptor.parseDetail) {
    const parseDetail = descriptor.parseDetail;
    entries = await Promise.all(
      entries.map(async (entry) => {
        try {
          const detailJson = await fetchCatalogJson(
            catalogListingUrl(base, `${endpoint}/${encodeURIComponent(entry.id)}`),
            input.apiKey,
            input.signal,
          );
          return parseDetail(detailJson) ?? entry;
        } catch {
          return entry;
        }
      }),
    );
  }

  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Fetches the upstream model listing for a catalog scope. Keys on the catalog parser name
 * (an API-shape mechanism), never on a provider identity: the preset manifest maps an entry to
 * its parser via `catalog`, and SDK-sourced listings (Bedrock / Vertex) read their transport
 * options + credential slots.
 */
export async function fetchCatalogModels(
  input: CatalogFetchInput,
): Promise<ProviderListedModelEntry[]> {
  const catalog = catalogDescriptorForProvider(input);
  if (!catalog) {
    throw new Error("This provider has no model listing endpoint; enter the model ID manually.");
  }
  const descriptor = resolveModelCatalogParser(catalog.parser);

  if (catalog.parser === "bedrock-models") {
    const region =
      input.options?.awsRegion?.trim() || extractAwsRegionFromBedrockApiBase(input.apiBase);
    if (!region) {
      throw new Error("Listing Amazon Bedrock models requires an AWS region.");
    }
    try {
      return await listBedrockModels({
        region,
        ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}),
        ...(input.accessKeyId?.trim() ? { accessKeyId: input.accessKeyId.trim() } : {}),
        ...(input.secretAccessKey?.trim() ? { secretAccessKey: input.secretAccessKey.trim() } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Model listing failed (Amazon Bedrock): ${message}`, { cause: error });
    }
  }

  if (catalog.parser === "google-vertex-models") {
    const extracted = extractVertexProjectAndLocationFromApiBase(input.apiBase);
    const project = input.options?.project?.trim() || extracted.project;
    const location = input.options?.location?.trim() || extracted.location;
    if (!project || !location) {
      throw new Error("Listing Google Vertex models requires a GCP project ID and location.");
    }
    try {
      return await listVertexModels({
        project,
        location,
        ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}),
        ...(input.vertexClientEmail?.trim()
          ? { vertexClientEmail: input.vertexClientEmail.trim() }
          : {}),
        ...(input.vertexPrivateKey?.trim()
          ? { vertexPrivateKey: input.vertexPrivateKey.trim() }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Model listing failed (Google Vertex AI): ${message}`, { cause: error });
    }
  }

  const specialized = SPECIALIZED_CATALOG_LISTERS[catalog.parser];
  if (specialized) {
    return specialized(input);
  }
  if (!catalog.endpoint) {
    throw new Error(`Catalog parser "${catalog.parser}" declares no listing endpoint.`);
  }
  return fetchCatalogEntriesWithDescriptor(input, descriptor, catalog.endpoint);
}

interface LoadedPreviewModelsResult {
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

export type { LoadedPreviewModelsResult };

export async function loadPreviewModelsForTransport(input: {
  providerId?: string;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  options?: ProviderOptions;
  accessKeyId?: string;
  secretAccessKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  forceRefresh: boolean;
}): Promise<LoadedPreviewModelsResult> {
  const cacheProviderId = input.providerId?.trim() || "custom";
  const cached = await readModelCatalogCache(input.apiBase, input.apiKey, cacheProviderId);
  const now = Date.now();
  if (cached && isModelCatalogCacheFresh(cached, now, input.forceRefresh)) {
    return {
      modelIds: cached.modelIds,
      ...(cached.modelCatalog ? { modelCatalog: cached.modelCatalog } : {}),
      fromCache: true,
    };
  }

  const listedModels = await fetchCatalogModels({
    ...(input.providerId ? { providerId: input.providerId } : {}),
    transportKind: input.transportKind,
    apiBase: input.apiBase,
    apiKey: input.apiKey,
    ...(input.options ? { options: input.options } : {}),
    ...(input.accessKeyId ? { accessKeyId: input.accessKeyId } : {}),
    ...(input.secretAccessKey ? { secretAccessKey: input.secretAccessKey } : {}),
    ...(input.vertexClientEmail ? { vertexClientEmail: input.vertexClientEmail } : {}),
    ...(input.vertexPrivateKey ? { vertexPrivateKey: input.vertexPrivateKey } : {}),
  });
  const modelCatalog = previewModelCatalogForTransport({
    ...(input.providerId ? { providerId: input.providerId } : {}),
    transportKind: input.transportKind,
    listedModels,
  });
  const modelIds = listedModels.map((entry) => entry.id);
  await writeModelCatalogCache(
    input.apiBase,
    modelIds,
    input.apiKey,
    modelCatalog,
    cacheProviderId,
  );
  // The catalog cache file was updated; invalidate the snapshot-side in-memory memo so the next buildSnapshot re-reads the new catalog
  invalidateModelCatalogHintsMemo();
  return {
    modelIds,
    ...(modelCatalog ? { modelCatalog } : {}),
    fromCache: false,
  };
}

export function previewCatalogMapForAddProviderRequest(
  request: AddProviderModelsRequest,
): Map<string, PreviewModelCatalogEntry> {
  return previewCatalogMapForTransport({
    ...(request.provider ? { providerId: request.provider } : {}),
    ...(request.transportKind ? { transportKind: request.transportKind } : {}),
    modelCatalog: request.modelCatalog,
  });
}

export async function findCatalogEntryForModel(input: {
  providerId?: string;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  model: string;
}): Promise<PreviewModelCatalogEntry | undefined> {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  try {
    const preview = await loadPreviewModelsForTransport({
      ...(input.providerId ? { providerId: input.providerId } : {}),
      transportKind: input.transportKind,
      apiBase: input.apiBase,
      apiKey: input.apiKey,
      forceRefresh: false,
    });
    return preview.modelCatalog?.find((entry) => entry.id === input.model);
  } catch {
    return undefined;
  }
}

export function resolveAddedModelCapabilities(input: {
  providerId?: string;
  requestedCapabilities?: DesktopModelCapability[];
  catalogEntry?: PreviewModelCatalogEntry;
}): DesktopModelCapability[] | undefined {
  if (input.catalogEntry?.capabilities) {
    const merged = [...input.catalogEntry.capabilities];
    if (
      input.requestedCapabilities?.includes("imageGeneration") === true &&
      !merged.includes("imageGeneration")
    ) {
      merged.push("imageGeneration");
    }
    return merged;
  }

  if (input.requestedCapabilities) {
    return input.requestedCapabilities;
  }

  return input.providerId === "custom" || findProviderPreset(input.providerId ?? "") === undefined
    ? defaultCustomModelCapabilities()
    : undefined;
}

/** Reads an internal keyring credential slot for the desktop host (`provider::{id}[::{slot}]`). */
export function readProviderCredentialSlotFromKeyring(
  providerId: string,
  slot: string,
): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerInternalSlotAccount(providerId, slot));
  const trimmed = value?.trim();
  return trimmed || undefined;
}
