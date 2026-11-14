import { loadModelKnowledgeSource, lookupModelKnowledgeSource } from "./loader.js";
import type { CompiledModelKnowledgeRecord, CompiledModelKnowledgeSource } from "./types.js";

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

const amazonNova = loadModelKnowledgeSource(rawAmazonNova, "amazon-nova.json");
const anthropicClaude = loadModelKnowledgeSource(rawAnthropicClaude, "anthropic-claude.json");
const deepseek = loadModelKnowledgeSource(rawDeepseek, "deepseek.json");
const googleGemini = loadModelKnowledgeSource(rawGoogleGemini, "google-gemini.json");
const metaMuse = loadModelKnowledgeSource(rawMetaMuse, "meta-muse.json");
const minimax = loadModelKnowledgeSource(rawMinimax, "minimax.json");
const moonshotKimi = loadModelKnowledgeSource(rawMoonshotKimi, "moonshot-kimi.json");
const openAiGpt = loadModelKnowledgeSource(rawOpenaiGpt, "openai-gpt.json");
const xaiGrok = loadModelKnowledgeSource(rawXaiGrok, "xai-grok.json");
const xiaomi = loadModelKnowledgeSource(rawXiaomi, "xiaomi.json");
const zaiGlm = loadModelKnowledgeSource(rawZaiGlm, "zai-glm.json");

export const AMAZON_NOVA_RECORDS: readonly CompiledModelKnowledgeRecord[] = amazonNova.records;
export const ANTHROPIC_CLAUDE_RECORDS: readonly CompiledModelKnowledgeRecord[] =
  anthropicClaude.records;
export const DEEPSEEK_RECORDS: readonly CompiledModelKnowledgeRecord[] = deepseek.records;
export const GOOGLE_GEMINI_RECORDS: readonly CompiledModelKnowledgeRecord[] = googleGemini.records;
export const META_MUSE_RECORDS: readonly CompiledModelKnowledgeRecord[] = metaMuse.records;
export const MINIMAX_RECORDS: readonly CompiledModelKnowledgeRecord[] = minimax.records;
export const MOONSHOT_KIMI_RECORDS: readonly CompiledModelKnowledgeRecord[] = moonshotKimi.records;
export const OPENAI_GPT_RECORDS: readonly CompiledModelKnowledgeRecord[] = openAiGpt.records;
export const XAI_GROK_RECORDS: readonly CompiledModelKnowledgeRecord[] = xaiGrok.records;
export const XIAOMI_RECORDS: readonly CompiledModelKnowledgeRecord[] = xiaomi.records;
export const ZAI_GLM_RECORDS: readonly CompiledModelKnowledgeRecord[] = zaiGlm.records;

/** A bundled model-knowledge data file with its compiled records. */
export interface ModelKnowledgeSource extends CompiledModelKnowledgeSource {
  /** Data file name, also used as the load-error context. */
  readonly source: string;
}

/**
 * Every bundled data file in lookup order. The order is deterministic (alphabetical by file
 * name) but never decides a match: model-family prefixes are disjoint across files. Within a
 * file, records are authored specific-first and the first match wins.
 */
export const MODEL_KNOWLEDGE_SOURCES: readonly ModelKnowledgeSource[] = [
  { source: "amazon-nova.json", ...amazonNova },
  { source: "anthropic-claude.json", ...anthropicClaude },
  { source: "deepseek.json", ...deepseek },
  { source: "google-gemini.json", ...googleGemini },
  { source: "meta-muse.json", ...metaMuse },
  { source: "minimax.json", ...minimax },
  { source: "moonshot-kimi.json", ...moonshotKimi },
  { source: "openai-gpt.json", ...openAiGpt },
  { source: "xai-grok.json", ...xaiGrok },
  { source: "xiaomi.json", ...xiaomi },
  { source: "zai-glm.json", ...zaiGlm },
];

/** First matching declaration payload across all bundled data files; `undefined` when no record matches. */
export function lookupModelKnowledge(modelId: string): Record<string, unknown> | undefined {
  for (const source of MODEL_KNOWLEDGE_SOURCES) {
    const declaration = lookupModelKnowledgeSource(source, modelId);
    if (declaration !== undefined) {
      return declaration;
    }
  }
  return undefined;
}
