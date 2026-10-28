import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeOpenAiApiBase } from "@spiritagent/agent-core/model-catalog/openai-api-base";
import type { ProviderListedCatalogCapabilities } from "@spiritagent/agent-core/model-catalog";
import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";
import type { ThinkingCapabilities } from "@spiritagent/agent-core";
import type {
  SpiritServiceTiersDeclaration,
  ThinkingSwitchDeclaration,
} from "@spiritagent/host-internal/config";

import type {
  DesktopModelCapability,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  PreviewModelCatalogEntry,
  PreviewModelCatalogPricing,
} from "../types.js";

import { spiritDataDir } from "./storage.js";

/** Model catalog cache TTL (24h). */
export const MODEL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The Hugging Face catalog fluctuates a lot, so it uses a shorter TTL. Keyed by provider entry id
 * (catalog-pipeline knowledge; runtime request paths never branch on it).
 */
export const HUGGING_FACE_MODEL_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

const PROVIDER_MODEL_CATALOG_CACHE_TTL_MS: Record<string, number> = {
  "hugging-face": HUGGING_FACE_MODEL_CATALOG_CACHE_TTL_MS,
};

function modelCatalogCacheTtlMs(providerId?: string): number {
  return (
    (providerId && PROVIDER_MODEL_CATALOG_CACHE_TTL_MS[providerId]) || MODEL_CATALOG_CACHE_TTL_MS
  );
}

/** Matches the `apiKeyFingerprint` written by `writeModelCatalogCache`, for callers to compare against. */
export function modelCatalogApiKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim(), "utf8").digest("hex").slice(0, 24);
}

const CACHE_DIR_NAME = "model-catalog-cache";

function modelCatalogCacheDir(): string {
  return path.join(spiritDataDir(), CACHE_DIR_NAME);
}

/** Cache scope: one provider entry's listing at its materialized apiBase. */
function modelCatalogCacheKey(apiBase: string, providerId: string): string {
  const normalized = normalizeOpenAiApiBase(apiBase);
  return `${providerId}::${normalized}`;
}

function modelCatalogCacheFilePath(apiBase: string, providerId: string): string {
  const hash = createHash("sha256")
    .update(modelCatalogCacheKey(apiBase, providerId), "utf8")
    .digest("hex")
    .slice(0, 32);
  return path.join(modelCatalogCacheDir(), `${hash}.json`);
}

export interface ModelCatalogCacheEntry {
  providerId?: string;
  apiBase: string;
  fetchedAtUnixMs: number;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  /** Fingerprint of the API Key at write time; absent for legacy cache entries. */
  apiKeyFingerprint?: string;
}

function parseCacheEntry(raw: string): ModelCatalogCacheEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const fetchedAt = obj.fetchedAtUnixMs;
  const modelIds = obj.modelIds;
  const modelCatalog = normalizePreviewModelCatalog(obj.modelCatalog);
  const base = obj.apiBase;
  if (typeof fetchedAt !== "number" || !Array.isArray(modelIds)) {
    return undefined;
  }
  const ids = modelIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (typeof base !== "string" || base.trim().length === 0) {
    return undefined;
  }
  const fpRaw = obj.apiKeyFingerprint;
  const apiKeyFingerprint = typeof fpRaw === "string" && fpRaw.length > 0 ? fpRaw : undefined;
  const providerId =
    typeof obj.providerId === "string" && obj.providerId.trim().length > 0
      ? obj.providerId.trim()
      : undefined;
  return {
    apiBase: base.trim(),
    fetchedAtUnixMs: fetchedAt,
    modelIds: ids,
    ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(apiKeyFingerprint !== undefined ? { apiKeyFingerprint } : {}),
  };
}

/**
 * @param apiKey If provided, a cache entry only hits when its `apiKeyFingerprint` matches (legacy entries without a fingerprint count as misses).
 */
export async function readModelCatalogCache(
  apiBase: string,
  apiKey: string | undefined,
  providerId: string,
): Promise<ModelCatalogCacheEntry | undefined> {
  try {
    const raw = await readFile(modelCatalogCacheFilePath(apiBase, providerId), "utf8");
    const entry = parseCacheEntry(raw);
    if (!entry) {
      return undefined;
    }
    const trimmedKey = apiKey?.trim() ?? "";
    if (trimmedKey.length > 0) {
      const expected = modelCatalogApiKeyFingerprint(trimmedKey);
      if (entry.apiKeyFingerprint !== expected) {
        return undefined;
      }
    }
    return entry;
  } catch {
    return undefined;
  }
}

/** Synchronous read (only used by the host thread for snapshot assembly). */
export function readModelCatalogCacheSync(
  apiBase: string,
  providerId: string,
): ModelCatalogCacheEntry | undefined {
  try {
    const raw = readFileSync(modelCatalogCacheFilePath(apiBase, providerId), "utf8");
    return parseCacheEntry(raw);
  } catch {
    return undefined;
  }
}

export async function writeModelCatalogCache(
  apiBase: string,
  modelIds: string[],
  apiKey: string,
  modelCatalog: PreviewModelCatalogEntry[] | undefined,
  providerId: string,
): Promise<void> {
  const dir = modelCatalogCacheDir();
  await mkdir(dir, { recursive: true });
  const normalized = normalizeOpenAiApiBase(apiBase);
  const entry: ModelCatalogCacheEntry = {
    apiBase: normalized,
    fetchedAtUnixMs: Date.now(),
    modelIds: [...modelIds],
    ...(modelCatalog !== undefined ? { modelCatalog: clonePreviewModelCatalog(modelCatalog) } : {}),
    apiKeyFingerprint: modelCatalogApiKeyFingerprint(apiKey),
    providerId,
  };
  const filePath = modelCatalogCacheFilePath(apiBase, providerId);
  const tempPath = `${filePath}.${String(process.pid)}.${String(Math.random()).slice(2)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(entry)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function isModelCatalogCacheFresh(
  entry: ModelCatalogCacheEntry,
  nowMs: number,
  forceRefresh: boolean,
): boolean {
  if (forceRefresh) {
    return false;
  }
  const ttlMs = modelCatalogCacheTtlMs(entry.providerId);
  return nowMs - entry.fetchedAtUnixMs < ttlMs;
}

const OUTPUT_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

function normalizeCachedSupportedEfforts(
  value: unknown,
): NonNullable<PreviewModelCatalogEntry["supportedEfforts"]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: NonNullable<PreviewModelCatalogEntry["supportedEfforts"]> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const effort = item.trim().toLowerCase();
    if (!OUTPUT_EFFORT_VALUES.has(effort) || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    result.push(effort as (typeof result)[number]);
  }
  return result;
}

function normalizeCachedDefaultEffort(value: unknown): PreviewModelCatalogEntry["defaultEffort"] {
  return typeof value === "string" && OUTPUT_EFFORT_VALUES.has(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as NonNullable<PreviewModelCatalogEntry["defaultEffort"]>)
    : undefined;
}

function normalizeCachedThinkingCapabilities(value: unknown): ThinkingCapabilities | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: ThinkingCapabilities = {};
  if (typeof record.supported === "boolean") {
    result.supported = record.supported;
  }
  if (typeof record.types === "object" && record.types !== null && !Array.isArray(record.types)) {
    const rawTypes = record.types as Record<string, unknown>;
    const types: NonNullable<ThinkingCapabilities["types"]> = {};
    for (const key of ["adaptive", "betweenTools", "disabled", "enabled"] as const) {
      if (typeof rawTypes[key] === "boolean") {
        types[key] = rawTypes[key];
      }
    }
    result.types = types;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCachedCatalogCapabilities(
  value: unknown,
): ProviderListedCatalogCapabilities | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: ProviderListedCatalogCapabilities = {};
  for (const key of [
    "serverTools",
    "codeExecution",
    "contextManagement",
    "batch",
    "citations",
  ] as const) {
    const subtree = record[key];
    if (typeof subtree === "object" && subtree !== null && !Array.isArray(subtree)) {
      result[key] = structuredClone(subtree) as NonNullable<(typeof result)[typeof key]>;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCachedThinkingSwitch(value: unknown): ThinkingSwitchDeclaration | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: ThinkingSwitchDeclaration = {};
  if (record.defaultState === "on" || record.defaultState === "off") {
    result.defaultState = record.defaultState;
  }
  const offBlockedEfforts = normalizeCachedSupportedEfforts(record.offBlockedEfforts);
  if (offBlockedEfforts !== undefined) {
    result.offBlockedEfforts = offBlockedEfforts;
  }
  if (typeof record.on === "object" && record.on !== null && !Array.isArray(record.on)) {
    result.on = structuredClone(record.on);
  }
  if (record.off === "omit") {
    result.off = "omit";
  } else if (typeof record.off === "object" && record.off !== null && !Array.isArray(record.off)) {
    result.off = structuredClone(record.off);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizePreviewModelCatalog(value: unknown): PreviewModelCatalogEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: PreviewModelCatalogEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : undefined;
    if (!id) {
      continue;
    }
    const displayName =
      typeof record.displayName === "string" && record.displayName.trim().length > 0
        ? record.displayName.trim()
        : undefined;
    const description =
      typeof record.description === "string" && record.description.trim().length > 0
        ? record.description.trim()
        : undefined;
    const pricing = normalizeCachedPricing(record.pricing);
    const capabilities = normalizeCachedCapabilities(record.capabilities);
    const supportedReasoningEfforts = normalizeCachedSupportedReasoningEfforts(
      record.supportedReasoningEfforts,
    );
    const effortSemantics = record.effortSemantics === "output" ? ("output" as const) : undefined;
    const supportedEfforts = normalizeCachedSupportedEfforts(record.supportedEfforts);
    const defaultEffort = normalizeCachedDefaultEffort(record.defaultEffort);
    const thinkingCapabilities = normalizeCachedThinkingCapabilities(record.thinkingCapabilities);
    const catalogCapabilities = normalizeCachedCatalogCapabilities(record.catalogCapabilities);
    const thinkingSwitch = normalizeCachedThinkingSwitch(record.thinkingSwitch);
    const defaultReasoningEffort = normalizeCachedDefaultReasoningEffort(
      record.defaultReasoningEffort,
    );
    const contextLength =
      typeof record.contextLength === "number" &&
      Number.isFinite(record.contextLength) &&
      record.contextLength > 0
        ? Math.trunc(record.contextLength)
        : undefined;
    const outputLimit = normalizeCachedPositiveInt(record.outputLimit);
    const maxCompletionTokens = normalizeCachedPositiveInt(record.maxCompletionTokens);
    const supportedReasoningModes = normalizeCachedSupportedReasoningModes(
      record.supportedReasoningModes,
    );
    const serviceTiers = normalizeCachedServiceTiers(record.serviceTiers);
    const supportsThinkingType =
      record.supportsThinkingType === "only" ? ("only" as const) : undefined;
    const supportsThinkingSwitch =
      typeof record.supportsThinkingSwitch === "boolean"
        ? record.supportsThinkingSwitch
        : undefined;
    const inferenceProvider =
      typeof record.inferenceProvider === "string" && record.inferenceProvider.trim().length > 0
        ? record.inferenceProvider.trim()
        : undefined;
    const upstreamProvider =
      typeof record.upstreamProvider === "string" && record.upstreamProvider.trim().length > 0
        ? record.upstreamProvider.trim()
        : undefined;
    normalized.push({
      id,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts } : {}),
      ...(effortSemantics !== undefined ? { effortSemantics } : {}),
      ...(supportedEfforts !== undefined ? { supportedEfforts } : {}),
      ...(defaultEffort !== undefined ? { defaultEffort } : {}),
      ...(thinkingCapabilities !== undefined ? { thinkingCapabilities } : {}),
      ...(catalogCapabilities !== undefined ? { catalogCapabilities } : {}),
      ...(defaultReasoningEffort !== undefined ? { defaultReasoningEffort } : {}),
      ...(contextLength !== undefined ? { contextLength } : {}),
      ...(outputLimit !== undefined ? { outputLimit } : {}),
      ...(maxCompletionTokens !== undefined ? { maxCompletionTokens } : {}),
      ...(supportedReasoningModes !== undefined ? { supportedReasoningModes } : {}),
      ...(serviceTiers !== undefined ? { serviceTiers } : {}),
      ...(supportsThinkingType !== undefined ? { supportsThinkingType } : {}),
      ...(supportsThinkingSwitch !== undefined ? { supportsThinkingSwitch } : {}),
      ...(thinkingSwitch !== undefined ? { thinkingSwitch } : {}),
      ...(inferenceProvider !== undefined ? { inferenceProvider } : {}),
      ...(upstreamProvider !== undefined ? { upstreamProvider } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCachedPricing(value: unknown): PreviewModelCatalogPricing | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const inputPerTokenUsd = readCachedPricingField(record, "inputPerTokenUsd");
  const outputPerTokenUsd = readCachedPricingField(record, "outputPerTokenUsd");
  const imagePerUnitUsd = readCachedPricingField(record, "imagePerUnitUsd");
  const requestPerCallUsd = readCachedPricingField(record, "requestPerCallUsd");
  const imagePerMegapixelUsd = readCachedPricingField(record, "imagePerMegapixelUsd");
  const imageExamplePricing = normalizeCachedExamplePricing(record.imageExamplePricing);
  const videoExamplePricing = normalizeCachedExamplePricing(record.videoExamplePricing);
  const videoDurationPricing = normalizeCachedVideoDurationPricing(record.videoDurationPricing);
  if (
    !inputPerTokenUsd &&
    !outputPerTokenUsd &&
    !imagePerUnitUsd &&
    requestPerCallUsd === undefined &&
    !imagePerMegapixelUsd &&
    imageExamplePricing === undefined &&
    videoExamplePricing === undefined &&
    videoDurationPricing === undefined
  ) {
    return undefined;
  }
  return {
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
    ...(imagePerMegapixelUsd ? { imagePerMegapixelUsd } : {}),
    ...(imageExamplePricing ? { imageExamplePricing } : {}),
    ...(videoExamplePricing ? { videoExamplePricing } : {}),
    ...(videoDurationPricing ? { videoDurationPricing } : {}),
  };
}

function normalizeCachedExamplePricing(
  value: unknown,
): NonNullable<PreviewModelCatalogPricing["imageExamplePricing"]> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const priceUsd =
    typeof record.priceUsd === "string" && record.priceUsd.trim().length > 0
      ? record.priceUsd.trim()
      : undefined;
  const description =
    typeof record.description === "string" && record.description.trim().length > 0
      ? record.description.trim()
      : undefined;
  if (!priceUsd || !description) {
    return undefined;
  }
  return { priceUsd, description };
}

function normalizeCachedVideoDurationPricing(
  value: unknown,
): PreviewModelCatalogPricing["videoDurationPricing"] {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const normalized: NonNullable<PreviewModelCatalogPricing["videoDurationPricing"]> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const resolution =
      typeof record.resolution === "string" && record.resolution.trim().length > 0
        ? record.resolution.trim()
        : undefined;
    const costPerSecondUsd =
      typeof record.costPerSecondUsd === "string" && record.costPerSecondUsd.trim().length > 0
        ? record.costPerSecondUsd.trim()
        : undefined;
    if (!resolution || !costPerSecondUsd) {
      continue;
    }
    const audio = record.audio === true ? true : undefined;
    normalized.push({
      resolution,
      costPerSecondUsd,
      ...(audio ? { audio } : {}),
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function readCachedPricingField(
  record: Record<string, unknown>,
  key: keyof PreviewModelCatalogPricing,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCachedCapabilities(value: unknown): DesktopModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<DesktopModelCapability>([
    "languageModel",
    "image",
    "video",
    "imageGeneration",
    "videoGeneration",
  ]);
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalizedItem = item === "vision" ? "image" : item;
    if (!allowed.has(normalizedItem as DesktopModelCapability)) {
      continue;
    }
    const capability = normalizedItem as DesktopModelCapability;
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCachedPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function normalizeCachedSupportedReasoningModes(
  value: unknown,
): DesktopModelReasoningMode[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const modes = value.filter(
    (item): item is DesktopModelReasoningMode => item === "standard" || item === "pro",
  );
  const unique = [...new Set(modes)];
  return unique.length > 0 ? unique : undefined;
}

function normalizeCachedServiceTiers(value: unknown): PreviewModelCatalogEntry["serviceTiers"] {
  if (Array.isArray(value)) {
    const tiers = value.filter((item): item is ModelServiceTier => typeof item === "string");
    // An explicit empty list is a declaration ("no tiers on this route"), not a missing key.
    return [...new Set(tiers)];
  }
  if (typeof value === "object" && value !== null) {
    // Literal map form (validated before it reached the cache); clone defensively.
    return structuredClone(value) as SpiritServiceTiersDeclaration;
  }
  return undefined;
}

function normalizeCachedSupportedReasoningEfforts(
  value: unknown,
): DesktopModelReasoningEffort[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const effort = item.trim().toLowerCase();
    if (!effort || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
}

function normalizeCachedDefaultReasoningEffort(
  value: unknown,
): DesktopModelReasoningEffort | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const effort = value.trim().toLowerCase();
  if (!effort || effort === "default") {
    return undefined;
  }
  return effort;
}

function cloneServiceTiersDeclaration(
  tiers: SpiritServiceTiersDeclaration,
): SpiritServiceTiersDeclaration {
  return Array.isArray(tiers) ? [...tiers] : structuredClone(tiers);
}

function clonePreviewModelCatalog(
  entries: readonly PreviewModelCatalogEntry[],
): PreviewModelCatalogEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
    ...(entry.capabilities ? { capabilities: [...entry.capabilities] } : {}),
    ...(entry.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: [...entry.supportedReasoningEfforts] }
      : {}),
    ...(entry.effortSemantics !== undefined ? { effortSemantics: entry.effortSemantics } : {}),
    ...(entry.supportedEfforts !== undefined
      ? { supportedEfforts: [...entry.supportedEfforts] }
      : {}),
    ...(entry.defaultEffort !== undefined ? { defaultEffort: entry.defaultEffort } : {}),
    ...(entry.thinkingCapabilities !== undefined
      ? { thinkingCapabilities: structuredClone(entry.thinkingCapabilities) }
      : {}),
    ...(entry.catalogCapabilities !== undefined
      ? { catalogCapabilities: structuredClone(entry.catalogCapabilities) }
      : {}),
    ...(entry.defaultReasoningEffort !== undefined
      ? { defaultReasoningEffort: entry.defaultReasoningEffort }
      : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.outputLimit !== undefined ? { outputLimit: entry.outputLimit } : {}),
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(entry.supportedReasoningModes !== undefined
      ? { supportedReasoningModes: [...entry.supportedReasoningModes] }
      : {}),
    ...(entry.serviceTiers !== undefined
      ? { serviceTiers: cloneServiceTiersDeclaration(entry.serviceTiers) }
      : {}),
    ...(entry.supportsThinkingType !== undefined
      ? { supportsThinkingType: entry.supportsThinkingType }
      : {}),
    ...(entry.supportsThinkingSwitch !== undefined
      ? { supportsThinkingSwitch: entry.supportsThinkingSwitch }
      : {}),
    ...(entry.thinkingSwitch !== undefined
      ? { thinkingSwitch: structuredClone(entry.thinkingSwitch) }
      : {}),
    ...(entry.inferenceProvider !== undefined
      ? { inferenceProvider: entry.inferenceProvider }
      : {}),
    ...(entry.upstreamProvider !== undefined ? { upstreamProvider: entry.upstreamProvider } : {}),
  }));
}
