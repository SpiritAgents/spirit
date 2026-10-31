/** One model-knowledge record: a model-ID regex pattern and the declaration payload it produces. */
export interface ModelKnowledgeRecord {
  /** Regex source, anchored at the start of the normalized model ID; authored lowercase. */
  match: string;
  /** Declaration payload folded into the model entry when the record matches. */
  declare: Record<string, unknown>;
}

/** Shape of a model-knowledge JSON data file. */
export interface ModelKnowledgeFile {
  models: ModelKnowledgeRecord[];
}

/** A loaded record with its compiled, start-anchored regex; record order is match priority. */
export interface CompiledModelKnowledgeRecord {
  match: string;
  regex: RegExp;
  declare: Record<string, unknown>;
}
