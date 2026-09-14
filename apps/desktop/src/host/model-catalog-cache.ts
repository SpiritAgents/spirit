import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeOpenAiApiBase } from "@spiritagent/host-internal";

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
  PreviewModelCatalogPricing,
} from "../types.js";

import { spiritDataDir } from "./storage.js";

/** Model catalog cache TTL (24h). */
export const MODEL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** The Hugging Face catalog fluctuates a lot, so it uses a shorter TTL. */
export const HUGGING_FACE_MODEL_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

const PROVIDER_MODEL_CATALOG_CACHE_TTL_MS: Partial<Record<DesktopModelProvider, number>> = {
  "hugging-face": HUGGING_FACE_MODEL_CATALOG_CACHE_TTL_MS,
};

function modelCatalogCacheTtlMs(provider?: DesktopModelProvider): number {
  if (provider && PROVIDER_MODEL_CATALOG_CACHE_TTL_MS[provider] !== undefined) {
    return PROVIDER_MODEL_CATALOG_CACHE_TTL_MS[provider] as number;
  }
  return MODEL_CATALOG_CACHE_TTL_MS;
}

/** Matches the `apiKeyFingerprint` written by `writeModelCatalogCache`, for callers to compare against. */
export function modelCatalogApiKeyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim(), "utf8").digest("hex").slice(0, 24);
}

const CACHE_DIR_NAME = "model-catalog-cache";

function modelCatalogCacheDir(): string {
  return path.join(spiritDataDir(), CACHE_DIR_NAME);
}

function modelCatalogCacheKey(
  apiBase: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  const normalized = normalizeOpenAiApiBase(apiBase);
  return `${provider ?? "custom"}::${transportKind ?? "openai-compatible"}::${normalized}`;
}

function modelCatalogCacheFilePath(
  apiBase: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  const hash = createHash("sha256")
    .update(modelCatalogCacheKey(apiBase, provider, transportKind), "utf8")
    .digest("hex")
    .slice(0, 32);
  return path.join(modelCatalogCacheDir(), `${hash}.json`);
}

export interface ModelCatalogCacheEntry {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
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
  const provider =
    typeof obj.provider === "string" && obj.provider.trim().length > 0
      ? (obj.provider.trim() as DesktopModelProvider)
      : undefined;
  const transportKind =
    obj.transportKind === "openai-compatible" ||
    obj.transportKind === "open-responses" ||
    obj.transportKind === "anthropic"
      ? obj.transportKind
      : undefined;
  const entry: ModelCatalogCacheEntry = {
    apiBase: base.trim(),
    fetchedAtUnixMs: fetchedAt,
    modelIds: ids,
    ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(transportKind !== undefined ? { transportKind } : {}),
    ...(apiKeyFingerprint !== undefined ? { apiKeyFingerprint } : {}),
  };
  if (isContextUsageCatalogCacheStale(entry)) {
    return undefined;
  }
  if (isMeituanThinkingCatalogCacheStale(entry)) {
    return undefined;
  }
  if (isTencentTokenHubCatalogCacheStale(entry)) {
    return undefined;
  }
  return entry;
}

/** Legacy TokenHub caches that only contain modelIds and lack the catalog displayName must be re-fetched. */
function isTencentTokenHubCatalogCacheStale(entry: ModelCatalogCacheEntry): boolean {
  if (entry.provider !== "tencent-tokenhub") {
    return false;
  }
  return !entry.modelCatalog?.some(
    (item) => typeof item.displayName === "string" && item.displayName.trim().length > 0,
  );
}

/** Legacy Meituan LongCat caches missing supportsThinkingSwitch must have their details re-fetched. */
function isMeituanThinkingCatalogCacheStale(entry: ModelCatalogCacheEntry): boolean {
  if (entry.provider !== "meituan" || !entry.modelCatalog?.length) {
    return false;
  }
  const longCat = entry.modelCatalog.find((item) => item.id === "LongCat-2.0");
  if (!longCat) {
    return false;
  }
  return longCat.supportsThinkingSwitch !== true;
}

/** The Gateway/OpenRouter ring chart depends on contextLength; treat legacy entries missing the field as a miss to trigger a re-fetch. */
function isContextUsageCatalogCacheStale(entry: ModelCatalogCacheEntry): boolean {
  if (entry.provider !== "vercel-ai-gateway" && entry.provider !== "openrouter") {
    return false;
  }
  if (!entry.modelCatalog || entry.modelCatalog.length === 0) {
    return false;
  }
  return !entry.modelCatalog.some(
    (item) => typeof item.contextLength === "number" && item.contextLength > 0,
  );
}

/**
 * @param apiKey If provided, a cache entry only hits when its `apiKeyFingerprint` matches (legacy entries without a fingerprint count as misses).
 */
export async function readModelCatalogCache(
  apiBase: string,
  apiKey?: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): Promise<ModelCatalogCacheEntry | undefined> {
  try {
    const raw = await readFile(modelCatalogCacheFilePath(apiBase, provider, transportKind), "utf8");
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
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): ModelCatalogCacheEntry | undefined {
  try {
    const raw = readFileSync(modelCatalogCacheFilePath(apiBase, provider, transportKind), "utf8");
    return parseCacheEntry(raw);
  } catch {
    return undefined;
  }
}

export async function writeModelCatalogCache(
  apiBase: string,
  modelIds: string[],
  apiKey: string,
  modelCatalog?: PreviewModelCatalogEntry[],
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
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
    ...(provider ? { provider } : {}),
    ...(transportKind ? { transportKind } : {}),
  };
  const filePath = modelCatalogCacheFilePath(apiBase, provider, transportKind);
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
  const ttlMs = modelCatalogCacheTtlMs(entry.provider);
  return nowMs - entry.fetchedAtUnixMs < ttlMs;
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
    const defaultReasoningEffort = normalizeCachedDefaultReasoningEffort(
      record.defaultReasoningEffort,
    );
    const contextLength =
      typeof record.contextLength === "number" &&
      Number.isFinite(record.contextLength) &&
      record.contextLength > 0
        ? Math.trunc(record.contextLength)
        : undefined;
    const supportsThinkingType =
      record.supportsThinkingType === "only" ? ("only" as const) : undefined;
    const supportsThinkingSwitch =
      record.supportsThinkingSwitch === true ? (true as const) : undefined;
    const inferenceProvider =
      typeof record.inferenceProvider === "string" && record.inferenceProvider.trim().length > 0
        ? record.inferenceProvider.trim()
        : undefined;
    normalized.push({
      id,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts } : {}),
      ...(defaultReasoningEffort !== undefined ? { defaultReasoningEffort } : {}),
      ...(contextLength !== undefined ? { contextLength } : {}),
      ...(supportsThinkingType !== undefined ? { supportsThinkingType } : {}),
      ...(supportsThinkingSwitch !== undefined ? { supportsThinkingSwitch } : {}),
      ...(inferenceProvider !== undefined ? { inferenceProvider } : {}),
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
    "chat",
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
    ...(entry.defaultReasoningEffort !== undefined
      ? { defaultReasoningEffort: entry.defaultReasoningEffort }
      : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.supportsThinkingType !== undefined
      ? { supportsThinkingType: entry.supportsThinkingType }
      : {}),
    ...(entry.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
    ...(entry.inferenceProvider !== undefined
      ? { inferenceProvider: entry.inferenceProvider }
      : {}),
  }));
}
