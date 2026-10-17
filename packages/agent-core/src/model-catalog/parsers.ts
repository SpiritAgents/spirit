/**
 * Registry mapping the preset manifest's `catalog.parser` names (API-shape keyed, see
 * `provider-presets.json`) to their payload parsers.
 *
 * The common case is a single `GET {apiBase}{endpoint}` parsed by `parseList`. Shapes
 * that need more than one raw payload carry the extra pieces on the descriptor:
 * SiliconFlow's typed sub-listings (`queries` + `merge`), Meituan LongCat's per-model
 * detail fetch (`parseDetail`), MiniMax's listing-base rewrite (`resolveListingBase`),
 * and Bedrock's SDK-sourced listing (no HTTP endpoint; `parseList` consumes the
 * `ListFoundationModels` summaries array).
 *
 * Pagination (Fireworks / Cohere page tokens, Hugging Face Link headers, Vertex /
 * Gemini `nextPageToken`) and the actual fetching stay in the exported `list*`
 * functions of this directory; this module deliberately does not grow into a fetch
 * DSL. The refresh pipeline keys on the parser name, not the provider id.
 */

import type { FoundationModelSummary } from "@aws-sdk/client-bedrock";

import { listProviderPresets } from "../provider-presets/index.js";
import { parseBedrockFoundationModelSummaries } from "./bedrock-models.js";
import { parseVertexModelEntriesPayload } from "./google-vertex-models.js";
import {
  mergeSiliconFlowListedModelEntries,
  minimaxOpenAiCompatibleListingBaseFromConnectBase,
  parseAnthropicModelEntriesPayload,
  parseArkModelEntriesPayload,
  parseBasetenModelEntriesPayload,
  parseCohereModelEntriesPayload,
  parseDeepInfraModelEntriesPayload,
  parseFireworksAiGatewayModelsPayload,
  parseGoogleModelEntriesPayload,
  parseGroqModelEntriesPayload,
  parseHuggingFaceRouterModelsPayload,
  parseKimiCodeModelEntriesPayload,
  parseMeituanModelDetailPayload,
  parseMinimaxModelEntriesPayload,
  parseMistralModelEntriesPayload,
  parseMoonshotModelEntriesPayload,
  parseOpenAiCompatibleModelEntriesPayload,
  parseOpenAiModelsPayload,
  parseOpenRouterModelEntriesPayload,
  parseSiliconFlowModelEntriesPayload,
  parseStepfunModelEntriesPayload,
  parseTencentTokenHubModelEntriesPayload,
  parseTogetherAiModelEntriesPayload,
  parseVercelAiGatewayModelEntriesPayload,
  parseXiaomiModelEntriesPayload,
  type ProviderListedModelEntry,
} from "./openai-models.js";

/** One extra typed listing fetch on the catalog endpoint, with its own payload projection. */
export interface ModelCatalogListingQuery {
  /** Query string appended to the listing URL (e.g. `type=image`). */
  query: string;
  /** Parses this query's response payload. */
  parse(payload: unknown): ProviderListedModelEntry[];
}

/** A preset `catalog.parser` name mapped to its entry points. */
export interface ModelCatalogParserDescriptor {
  /** Parses one listing response payload into catalog entries (empty on unrecognized shapes). */
  parseList(payload: unknown): ProviderListedModelEntry[];
  /**
   * Extra typed fetches on the same endpoint (SiliconFlow's chat/image/video split).
   * When present, the pipeline fetches the endpoint once per query instead of a bare GET.
   */
  queries?: readonly ModelCatalogListingQuery[];
  /**
   * Merges the entries of all fetched payloads (primary list plus `queries`) into the
   * final list; defaults to first-wins dedupe by id (`dedupeProviderListedModelEntries`).
   */
  merge?(entries: readonly ProviderListedModelEntry[]): ProviderListedModelEntry[];
  /** Per-model detail parser when the list endpoint returns bare ids (Meituan LongCat). */
  parseDetail?(payload: unknown): ProviderListedModelEntry | undefined;
  /** Rewrites the materialized apiBase before the endpoint is joined (MiniMax `/anthropic/v1` → `/v1`). */
  resolveListingBase?(apiBase: string): string;
}

const SILICONFLOW_LISTING_QUERIES: readonly ModelCatalogListingQuery[] = [
  {
    query: "type=text&sub_type=chat",
    parse: (payload) => parseSiliconFlowModelEntriesPayload(payload, "chat"),
  },
  {
    query: "type=image",
    parse: (payload) => parseSiliconFlowModelEntriesPayload(payload, "image"),
  },
  {
    query: "sub_type=text-to-video",
    parse: (payload) => parseSiliconFlowModelEntriesPayload(payload, "video"),
  },
];

/** Parser descriptors keyed by the preset manifest's `catalog.parser` names. */
export const MODEL_CATALOG_PARSERS: Readonly<Record<string, ModelCatalogParserDescriptor>> = {
  "openai-models": { parseList: (payload) => parseOpenAiCompatibleModelEntriesPayload(payload) },
  "anthropic-models": { parseList: parseAnthropicModelEntriesPayload },
  "google-gemini-models": { parseList: parseGoogleModelEntriesPayload },
  "google-vertex-models": { parseList: parseVertexModelEntriesPayload },
  "bedrock-models": {
    // Not HTTP-off-the-base: the listing is the AWS SDK ListFoundationModels call
    // (the preset catalog descriptor has no endpoint); parseList consumes its summaries.
    parseList: (payload) =>
      Array.isArray(payload)
        ? parseBedrockFoundationModelSummaries(payload as FoundationModelSummary[])
        : [],
  },
  "vercel-gateway-models": { parseList: parseVercelAiGatewayModelEntriesPayload },
  "openrouter-models": { parseList: parseOpenRouterModelEntriesPayload },
  "fireworks-gateway-models": { parseList: parseFireworksAiGatewayModelsPayload },
  "together-models": { parseList: parseTogetherAiModelEntriesPayload },
  "groq-models": { parseList: parseGroqModelEntriesPayload },
  "deepinfra-models": { parseList: parseDeepInfraModelEntriesPayload },
  "baseten-models": { parseList: parseBasetenModelEntriesPayload },
  "huggingface-models": { parseList: parseHuggingFaceRouterModelsPayload },
  "moonshot-models": { parseList: parseMoonshotModelEntriesPayload },
  "kimi-code-models": { parseList: parseKimiCodeModelEntriesPayload },
  "minimax-models": {
    parseList: parseMinimaxModelEntriesPayload,
    resolveListingBase: minimaxOpenAiCompatibleListingBaseFromConnectBase,
  },
  "xiaomi-models": { parseList: parseXiaomiModelEntriesPayload },
  "siliconflow-models": {
    parseList: (payload) => parseSiliconFlowModelEntriesPayload(payload, "chat"),
    queries: SILICONFLOW_LISTING_QUERIES,
    merge: mergeSiliconFlowListedModelEntries,
  },
  "stepfun-models": { parseList: parseStepfunModelEntriesPayload },
  "ark-models": { parseList: parseArkModelEntriesPayload },
  "meituan-models": {
    // The list endpoint returns bare ids; capabilities/pricing need a per-model detail fetch.
    parseList: (payload) => parseOpenAiModelsPayload(payload).map((id) => ({ id })),
    parseDetail: parseMeituanModelDetailPayload,
  },
  "tencent-tokenhub-models": { parseList: parseTencentTokenHubModelEntriesPayload },
  "mistral-models": { parseList: parseMistralModelEntriesPayload },
  "cohere-models": { parseList: parseCohereModelEntriesPayload },
};

/** Looks up the parser descriptor for a preset `catalog.parser` name. */
export function resolveModelCatalogParser(parserName: string): ModelCatalogParserDescriptor {
  const descriptor = MODEL_CATALOG_PARSERS[parserName];
  if (!descriptor) {
    throw new Error(`Unknown model catalog parser "${parserName}".`);
  }
  return descriptor;
}

/** Fail-fast cross-check: every preset catalog descriptor must name a registered parser. */
export function assertPresetCatalogParsersRegistered(): void {
  for (const preset of listProviderPresets()) {
    if (preset.catalog) {
      resolveModelCatalogParser(preset.catalog.parser);
    }
  }
}
