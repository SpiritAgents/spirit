import type { CompiledModelKnowledgeRecord, CompiledModelKnowledgeSource } from "./types.js";

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

/** Normalization applied before matching: route prefix and Vercel Batch/Fast suffix stripped, then lowercase folding. */
export function normalizeModelKnowledgeModelId(modelId: string): string {
  const withoutRoutingSuffix = modelId.trim().replace(/\s+\((?:batch|fast)\)$/i, "");
  return stripModelIdAggregatorPrefix(withoutRoutingSuffix).toLowerCase();
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

  return data.models.map((record: unknown, index: number) =>
    compileModelKnowledgeRecord(record, `${source} models[${index}]`),
  );
}

function compileModelKnowledgeRecord(
  value: unknown,
  context: string,
): CompiledModelKnowledgeRecord {
  if (!isRecord(value)) {
    throw new ModelKnowledgeLoadError(`${context} must be an object.`);
  }
  const match = value.match;
  if (typeof match !== "string" || match.trim().length === 0) {
    throw new ModelKnowledgeLoadError(`${context} requires a non-empty "match" regex string.`);
  }
  if (!isRecord(value.declare)) {
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
  return { match, regex, declare: value.declare };
}

export function loadModelKnowledgeSource(
  data: unknown,
  source = "model-knowledge",
): CompiledModelKnowledgeSource {
  const records = loadModelKnowledgeRecords(data, source);
  if (!isRecord(data) || (data.match === undefined && data.defaults === undefined)) {
    return { records };
  }
  if (data.match === undefined || data.defaults === undefined) {
    throw new ModelKnowledgeLoadError(`${source}: family "match" and "defaults" must be paired.`);
  }
  return {
    records,
    defaults: compileModelKnowledgeRecord(
      { match: data.match, declare: data.defaults },
      `${source} defaults`,
    ),
  };
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

/** Family defaults fold first; the more specific record still wins on conflicting keys. */
export function lookupModelKnowledgeSource(
  source: CompiledModelKnowledgeSource,
  modelId: string,
): Record<string, unknown> | undefined {
  const specific = lookupModelKnowledgeRecord(source.records, modelId);
  const normalized = normalizeModelKnowledgeModelId(modelId);
  const defaults = source.defaults?.regex.test(normalized) ? source.defaults.declare : undefined;
  if (specific === undefined && defaults === undefined) {
    return undefined;
  }
  return { ...defaults, ...specific };
}
