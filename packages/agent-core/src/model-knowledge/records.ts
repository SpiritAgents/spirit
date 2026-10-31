import { loadModelKnowledgeRecords, lookupModelKnowledgeRecord } from "./loader.js";
import type { CompiledModelKnowledgeRecord } from "./types.js";

import rawAmazonNova from "./amazon-nova.json" with { type: "json" };
import rawAnthropicClaude from "./anthropic-claude.json" with { type: "json" };
import rawDeepseek from "./deepseek.json" with { type: "json" };
import rawGoogleGemini from "./google-gemini.json" with { type: "json" };
import rawMetaMuse from "./meta-muse.json" with { type: "json" };
import rawMinimax from "./minimax.json" with { type: "json" };
import rawMoonshotKimi from "./moonshot-kimi.json" with { type: "json" };
import rawOpenaiGpt from "./openai-gpt.json" with { type: "json" };
import rawXaiGrok from "./xai-grok.json" with { type: "json" };
import rawXiaomi from "./xiaomi.json" with { type: "json" };
import rawZaiGlm from "./zai-glm.json" with { type: "json" };

export const AMAZON_NOVA_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  loadModelKnowledgeRecords(rawAmazonNova, "amazon-nova.json");
export const ANTHROPIC_CLAUDE_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  loadModelKnowledgeRecords(rawAnthropicClaude, "anthropic-claude.json");
export const DEEPSEEK_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawDeepseek,
  "deepseek.json",
);
export const GOOGLE_GEMINI_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  loadModelKnowledgeRecords(rawGoogleGemini, "google-gemini.json");
export const META_MUSE_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawMetaMuse,
  "meta-muse.json",
);
export const MINIMAX_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawMinimax,
  "minimax.json",
);
export const MOONSHOT_KIMI_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  loadModelKnowledgeRecords(rawMoonshotKimi, "moonshot-kimi.json");
export const OPENAI_GPT_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  loadModelKnowledgeRecords(rawOpenaiGpt, "openai-gpt.json");
export const XAI_GROK_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawXaiGrok,
  "xai-grok.json",
);
export const XIAOMI_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawXiaomi,
  "xiaomi.json",
);
export const ZAI_GLM_RECORDS: readonly CompiledModelKnowledgeRecord[] = loadModelKnowledgeRecords(
  rawZaiGlm,
  "zai-glm.json",
);

/** A bundled model-knowledge data file with its compiled records. */
export interface ModelKnowledgeSource {
  /** Data file name, also used as the load-error context. */
  readonly source: string;
  /** Records in match-priority order (first match wins). */
  readonly records: readonly CompiledModelKnowledgeRecord[];
}

/**
 * Every bundled data file in lookup order. The order is deterministic (alphabetical by file
 * name) but never decides a match: model-family prefixes are disjoint across files. Within a
 * file, records are authored specific-first and the first match wins.
 */
export const MODEL_KNOWLEDGE_SOURCES: readonly ModelKnowledgeSource[] = [
  { source: "amazon-nova.json", records: AMAZON_NOVA_RECORDS },
  { source: "anthropic-claude.json", records: ANTHROPIC_CLAUDE_RECORDS },
  { source: "deepseek.json", records: DEEPSEEK_RECORDS },
  { source: "google-gemini.json", records: GOOGLE_GEMINI_RECORDS },
  { source: "meta-muse.json", records: META_MUSE_RECORDS },
  { source: "minimax.json", records: MINIMAX_RECORDS },
  { source: "moonshot-kimi.json", records: MOONSHOT_KIMI_RECORDS },
  { source: "openai-gpt.json", records: OPENAI_GPT_RECORDS },
  { source: "xai-grok.json", records: XAI_GROK_RECORDS },
  { source: "xiaomi.json", records: XIAOMI_RECORDS },
  { source: "zai-glm.json", records: ZAI_GLM_RECORDS },
];

const ALL_RECORDS: readonly CompiledModelKnowledgeRecord[] = MODEL_KNOWLEDGE_SOURCES.flatMap(
  (source) => source.records,
);

/** First matching declaration payload across all bundled data files; `undefined` when no record matches. */
export function lookupModelKnowledge(modelId: string): Record<string, unknown> | undefined {
  return lookupModelKnowledgeRecord(ALL_RECORDS, modelId);
}
