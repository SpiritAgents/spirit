import { lookupModelKnowledge } from "../model-knowledge/index.js";
import {
  parseOpenAiCompatibleModelEntriesPayload,
  type ProviderListedModelEntry,
} from "./openai-models.js";

const VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readReasoningEfforts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const efforts: string[] = [];
  for (const item of value) {
    const raw =
      typeof item === "string"
        ? item.trim()
        : item &&
            typeof item === "object" &&
            typeof (item as { effort?: unknown }).effort === "string"
          ? (item as { effort: string }).effort.trim()
          : "";
    if (VALID_REASONING_EFFORTS.has(raw) && !efforts.includes(raw)) {
      efforts.push(raw);
    }
  }
  return efforts.length > 0 ? efforts : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());
  return items.length > 0 ? items : undefined;
}

/**
 * Parses the Sign in with ChatGPT `GET /v1/models` catalog payload (`{ models: [{ slug, display_name, visibility, ... }] }`).
 * Preserves server ordering, filters out items whose `visibility` is explicitly set to anything other than `"list"`,
 * and enriches known models with bundled model knowledge. Falls back to standard OpenAI `data[]` payloads.
 */
export function parseChatGptModelEntriesPayload(payload: unknown): ProviderListedModelEntry[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.models)) {
    return parseOpenAiCompatibleModelEntriesPayload(payload, "openai");
  }

  const seen = new Set<string>();
  const entries: ProviderListedModelEntry[] = [];

  for (const raw of record.models) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const visibility = typeof item.visibility === "string" ? item.visibility.trim() : undefined;
    if (visibility !== undefined && visibility !== "list") {
      continue;
    }
    const slug =
      typeof item.slug === "string" && item.slug.trim()
        ? item.slug.trim()
        : typeof item.id === "string" && item.id.trim()
          ? item.id.trim()
          : undefined;
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    const displayName =
      typeof item.display_name === "string" && item.display_name.trim()
        ? item.display_name.trim()
        : undefined;
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : undefined;
    const contextLength =
      readPositiveInt(item.context_window) ?? readPositiveInt(item.context_length);
    const outputLimit =
      readPositiveInt(item.max_output_tokens) ?? readPositiveInt(item.output_limit);
    const inputModalities = readStringArray(item.input_modalities);
    const supportedReasoningEfforts = readReasoningEfforts(item.supported_reasoning_levels);
    const defaultReasoningLevel =
      typeof item.default_reasoning_level === "string" &&
      VALID_REASONING_EFFORTS.has(item.default_reasoning_level.trim())
        ? item.default_reasoning_level.trim()
        : undefined;

    const knowledge = lookupModelKnowledge(slug);
    const knowledgeCapabilities = readStringArray(knowledge?.capabilities);
    const knowledgeContextLength = readPositiveInt(knowledge?.contextLength);
    const knowledgeOutputLimit = readPositiveInt(knowledge?.outputLimit);
    const knowledgeEfforts = readReasoningEfforts(knowledge?.supportedReasoningEfforts);
    const knowledgeDefaultEffort =
      typeof knowledge?.reasoningEffort === "string" &&
      VALID_REASONING_EFFORTS.has(knowledge.reasoningEffort.trim())
        ? knowledge.reasoningEffort.trim()
        : undefined;

    const supportsImageInput =
      inputModalities !== undefined
        ? inputModalities.includes("image") || undefined
        : knowledgeCapabilities?.includes("image") || undefined;
    const supportsDocumentInput =
      inputModalities !== undefined
        ? inputModalities.includes("file") || inputModalities.includes("document") || undefined
        : knowledgeCapabilities?.includes("document") || undefined;

    const mergedContextLength = contextLength ?? knowledgeContextLength;
    const mergedOutputLimit = outputLimit ?? knowledgeOutputLimit;
    const mergedEfforts = supportedReasoningEfforts ?? knowledgeEfforts;
    const mergedDefaultEffort = defaultReasoningLevel ?? knowledgeDefaultEffort;

    entries.push({
      id: slug,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      ...(mergedContextLength !== undefined ? { contextLength: mergedContextLength } : {}),
      ...(mergedOutputLimit !== undefined ? { outputLimit: mergedOutputLimit } : {}),
      ...(supportsImageInput ? { supportsImageInput: true } : {}),
      ...(supportsDocumentInput ? { supportsDocumentInput: true } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(mergedEfforts !== undefined
        ? { supportedReasoningEfforts: [...mergedEfforts], supportsReasoning: true }
        : {}),
      ...(mergedDefaultEffort !== undefined ? { defaultReasoningEffort: mergedDefaultEffort } : {}),
    });
  }

  return entries;
}
