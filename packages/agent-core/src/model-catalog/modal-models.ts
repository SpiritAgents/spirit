import type { ProviderListedModelEntry } from "./openai-models.js";

/**
 * Modal Shared Endpoint models use their deployment hostname as the inference id. The library
 * model id is retained separately for write-time knowledge lookup and must never replace `id`.
 */
export function parseModalModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.data)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const item of record.data) {
    const raw = asRecord(item);
    const id = readString(raw?.id);
    if (!raw || !id) {
      continue;
    }

    const entry: ProviderListedModelEntry = { id };
    const baseModelId = readString(raw.base_model_id);
    const displayName = readString(raw.name);
    const contextLength = readPositiveInteger(raw.context_length);
    const outputLimit = readPositiveInteger(raw.max_output_length);
    const inputModalities = readStringArray(raw.input_modalities);
    const outputModalities = readStringArray(raw.output_modalities);
    const supportedFeatures = readStringArray(raw.supported_features);
    const supportedSamplingParameters = readStringArray(raw.supported_sampling_parameters);
    const supportedReasoningEfforts = readModalReasoningEfforts(raw.reasoning_options);
    const reasoningField = readString(asRecord(raw.interleaved)?.field);

    if (baseModelId) entry.baseModelId = baseModelId;
    if (displayName) entry.displayName = displayName;
    if (contextLength !== undefined) entry.contextLength = contextLength;
    if (outputLimit !== undefined) entry.outputLimit = outputLimit;
    if (inputModalities) {
      entry.inputModalities = inputModalities;
      if (inputModalities.includes("image")) entry.supportsImageInput = true;
      if (inputModalities.includes("video")) entry.supportsVideoInput = true;
    }
    if (outputModalities) entry.outputModalities = outputModalities;
    if (supportedFeatures) entry.supportedFeatures = supportedFeatures;
    if (supportedSamplingParameters) {
      entry.supportedSamplingParameters = supportedSamplingParameters;
    }
    if (supportedReasoningEfforts) {
      entry.supportedReasoningEfforts = supportedReasoningEfforts;
    }
    if (supportedFeatures?.includes("reasoning") || supportedReasoningEfforts) {
      entry.supportsReasoning = true;
    }
    if (reasoningField) entry.reasoningField = reasoningField;

    entries.push(entry);
  }
  return entries;
}

function readModalReasoningEfforts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const efforts: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const option = asRecord(item);
    if (option?.type !== "effort" || !Array.isArray(option.values)) {
      continue;
    }
    for (const effort of readStringArray(option.values) ?? []) {
      if (seen.has(effort)) {
        continue;
      }
      seen.add(effort);
      efforts.push(effort);
    }
  }
  return efforts.length > 0 ? efforts : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readString(item);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result.length > 0 ? result : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
