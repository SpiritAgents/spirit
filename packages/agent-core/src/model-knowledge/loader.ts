import type { CompiledModelKnowledgeRecord } from "./types.js";

export class ModelKnowledgeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelKnowledgeLoadError";
  }
}

/**
 * Strips the aggregator routing prefix from a model ID: a single-slash ID is treated as
 * `<route>/<canonical-id>` (`openai/gpt-5.5` → `gpt-5.5`). IDs without a slash, and path-like IDs
 * with several slashes (Vertex `publishers/google/models/…`), are not simple aggregator routes and
 * are returned unchanged.
 */
export function stripModelIdAggregatorPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex !== trimmed.lastIndexOf("/")) {
    return trimmed;
  }
  const stripped = trimmed.slice(slashIndex + 1).trim();
  return stripped.length > 0 ? stripped : trimmed;
}

/** Normalization applied before matching: aggregator prefix stripped, then lowercase folding. */
export function normalizeModelKnowledgeModelId(modelId: string): string {
  return stripModelIdAggregatorPrefix(modelId).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Loads and validates model-knowledge data (`{ models: [{ match, declare }] }`). Regexes are
 * compiled start-anchored; an invalid regex or malformed record fails the whole load.
 */
export function loadModelKnowledgeRecords(
  data: unknown,
  source = "model-knowledge",
): CompiledModelKnowledgeRecord[] {
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new ModelKnowledgeLoadError(`${source}: expected an object with a "models" array.`);
  }

  return data.models.map((record: unknown, index: number) => {
    const context = `${source} models[${index}]`;
    if (!isRecord(record)) {
      throw new ModelKnowledgeLoadError(`${context} must be an object.`);
    }
    const match = record.match;
    if (typeof match !== "string" || match.trim().length === 0) {
      throw new ModelKnowledgeLoadError(`${context} requires a non-empty "match" regex string.`);
    }
    if (!isRecord(record.declare)) {
      throw new ModelKnowledgeLoadError(`${context} requires a "declare" object.`);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${match})`);
    } catch (error) {
      throw new ModelKnowledgeLoadError(
        `${context} has an invalid "match" regex ${JSON.stringify(match)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { match, regex, declare: record.declare };
  });
}

/** First record whose regex matches at the start of the normalized model ID wins. */
export function lookupModelKnowledgeRecord(
  records: readonly CompiledModelKnowledgeRecord[],
  modelId: string,
): Record<string, unknown> | undefined {
  const normalized = normalizeModelKnowledgeModelId(modelId);
  for (const record of records) {
    if (record.regex.test(normalized)) {
      return record.declare;
    }
  }
  return undefined;
}
