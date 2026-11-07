import type {
  ProviderListedModelEntry,
  ProviderListedModelPricing,
  ProviderListedModelRateLimits,
  ProviderListedModelRegion,
} from "./openai-models.js";

const COMMON_PRICING_FIELDS = new Set([
  "prompt",
  "completion",
  "input_cache_read",
  "image",
  "request",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = [
    ...new Set(
      value.map((item) => readString(item)).filter((item): item is string => item !== undefined),
    ),
  ];
  return values.length > 0 ? values : undefined;
}

function readModalities(value: unknown): { inputs: Set<string>; outputs: Set<string> } | undefined {
  const modality = readString(value)?.toLowerCase();
  if (!modality) {
    return undefined;
  }
  const parts = modality.split("->");
  if (parts.length !== 2) {
    return undefined;
  }
  const readSide = (side: string | undefined): Set<string> =>
    new Set(
      (side ?? "")
        .split("+")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  const inputs = readSide(parts[0]);
  const outputs = readSide(parts[1]);
  return inputs.size > 0 && outputs.size > 0 ? { inputs, outputs } : undefined;
}

function readPricing(record: Record<string, unknown>): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const additionalPricing: Record<string, string> = {};
  for (const [key, value] of Object.entries(pricing)) {
    const price = readString(value);
    if (!COMMON_PRICING_FIELDS.has(key) && price) {
      additionalPricing[key] = price;
    }
  }
  const inputPerTokenUsd = readString(pricing.prompt);
  const outputPerTokenUsd = readString(pricing.completion);
  const cachedInputPerTokenUsd = readString(pricing.input_cache_read);
  const imagePerUnitUsd = readString(pricing.image);
  const requestPerCallUsd = readString(pricing.request);
  const result: ProviderListedModelPricing = {
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(cachedInputPerTokenUsd ? { cachedInputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd ? { requestPerCallUsd } : {}),
    ...(Object.keys(additionalPricing).length > 0 ? { additionalPricing } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function readRateLimits(
  record: Record<string, unknown>,
): ProviderListedModelRateLimits | undefined {
  const limits = asRecord(record.per_request_limits);
  if (!limits) {
    return undefined;
  }
  const tokensPerMinute = readNonNegativeNumber(limits.tokens_per_minute);
  const requestsPerMinute = readNonNegativeNumber(limits.requests_per_minute);
  const burstRatio = readNonNegativeNumber(limits.burst_ratio);
  const result: ProviderListedModelRateLimits = {
    ...(tokensPerMinute !== undefined ? { tokensPerMinute } : {}),
    ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
    ...(burstRatio !== undefined ? { burstRatio } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function readRegions(value: unknown): ProviderListedModelRegion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const regions: ProviderListedModelRegion[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const countryCode = readString(record.country_code);
    const name = readString(record.name);
    if (countryCode || name) {
      regions.push({
        ...(countryCode ? { countryCode } : {}),
        ...(name ? { name } : {}),
      });
    }
  }
  return regions.length > 0 ? regions : undefined;
}

/**
 * Authenticated `GET /v1/models?verbose=true`. Only text-generating language models are Spirit
 * roles; pricing and feature strings are retained as facts and never interpreted as generation,
 * reasoning-effort, hosted-search, or service-tier declarations.
 */
export function parseNebiusTokenFactoryModelEntriesPayload(
  body: unknown,
): ProviderListedModelEntry[] {
  const data = asRecord(body)?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const id = readString(record?.id);
    if (!record || !id) {
      continue;
    }
    const status = readString(record.status)?.toLowerCase();
    if (status !== undefined && status !== "active") {
      continue;
    }

    const architectureRecord = asRecord(record.architecture);
    const modality = readString(architectureRecord?.modality);
    const modalities = readModalities(modality);
    // Requiring text input and exactly text output excludes embeddings, rerankers, ASR/TTS,
    // segmentation, and image/video generation without guessing from model ids or prices.
    if (
      !modalities ||
      !modalities.inputs.has("text") ||
      modalities.outputs.size !== 1 ||
      !modalities.outputs.has("text")
    ) {
      continue;
    }

    const displayName = readString(record.name);
    const description = readString(record.description);
    const contextLength = readPositiveInteger(record.context_length);
    const tokenizer = readString(architectureRecord?.tokenizer);
    const instructType = readString(architectureRecord?.instruct_type);
    const quantization = readString(record.quantization);
    const pricing = readPricing(record);
    const perRequestLimits = readRateLimits(record);
    const regions = readRegions(record.regions);
    const supportedFeatures = readStringArray(record.supported_features);
    const supportedSamplingParameters = readStringArray(record.supported_sampling_parameters);
    entries.push({
      id,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      supportsImageInput: modalities.inputs.has("image"),
      supportsVideoInput: modalities.inputs.has("video"),
      ...(contextLength !== undefined ? { contextLength } : {}),
      architecture: {
        ...(modality ? { modality } : {}),
        ...(tokenizer ? { tokenizer } : {}),
        ...(instructType ? { instructType } : {}),
      },
      ...(quantization ? { quantization } : {}),
      ...(pricing ? { pricing } : {}),
      ...(perRequestLimits ? { perRequestLimits } : {}),
      ...(regions ? { regions } : {}),
      ...(supportedFeatures ? { supportedFeatures } : {}),
      ...(supportedSamplingParameters ? { supportedSamplingParameters } : {}),
    });
  }
  return entries;
}
