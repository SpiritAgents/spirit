/** One model-knowledge record: a model-ID regex pattern and the declaration payload it produces. */
export interface ModelKnowledgeRecord {
  /** Regex source, anchored at the start of the normalized model ID; authored lowercase. */
  match: string;
  /** Declaration payload folded into the model entry when the record matches. */
  declare: Record<string, unknown>;
}

/** Shape of a model-knowledge JSON data file. */
export interface ModelKnowledgeFile {
  /** Optional family matcher whose defaults apply even when no specific record matches. */
  match?: string;
  /** Declarations merged before the matching record's own declarations. */
  defaults?: Record<string, unknown>;
  models: ModelKnowledgeRecord[];
}

/** A loaded record with its compiled, start-anchored regex; record order is match priority. */
export interface CompiledModelKnowledgeRecord {
  match: string;
  regex: RegExp;
  declare: Record<string, unknown>;
}

export interface CompiledModelKnowledgeSource {
  readonly records: readonly CompiledModelKnowledgeRecord[];
  readonly defaults?: CompiledModelKnowledgeRecord;
}
