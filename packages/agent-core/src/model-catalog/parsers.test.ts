import assert from "node:assert/strict";
import { test } from "vitest";

import { listProviderPresets } from "../provider-presets/index.js";
import {
  assertPresetCatalogParsersRegistered,
  MODEL_CATALOG_PARSERS,
  resolveModelCatalogParser,
} from "./parsers.js";

const CANONICAL_PARSER_NAMES = [
  "openai-models",
  "anthropic-models",
  "google-gemini-models",
  "google-vertex-models",
  "bedrock-models",
  "vercel-gateway-models",
  "openrouter-models",
  "fireworks-gateway-models",
  "together-models",
  "groq-models",
  "deepinfra-models",
  "baseten-models",
  "huggingface-models",
  "moonshot-models",
  "kimi-code-models",
  "minimax-models",
  "xiaomi-models",
  "siliconflow-models",
  "stepfun-models",
  "ark-models",
  "meituan-models",
  "tencent-tokenhub-models",
  "mistral-models",
  "cohere-models",
];

test("registry covers exactly the canonical parser names", () => {
  assert.deepEqual(Object.keys(MODEL_CATALOG_PARSERS).sort(), [...CANONICAL_PARSER_NAMES].sort());
});

test("every preset catalog.parser name resolves to a registered descriptor", () => {
  assertPresetCatalogParsersRegistered();
  const registered = new Set(Object.keys(MODEL_CATALOG_PARSERS));
  for (const preset of listProviderPresets()) {
    if (preset.catalog) {
      assert.ok(registered.has(preset.catalog.parser), `${preset.id}: ${preset.catalog.parser}`);
    }
  }
});

test("resolveModelCatalogParser throws for unknown parser names", () => {
  assert.throws(() => resolveModelCatalogParser("no-such-parser"), /Unknown model catalog parser/);
});

test("openai-models parseList extracts ids from the generic OpenAI shape", () => {
  const entries = resolveModelCatalogParser("openai-models").parseList({
    data: [{ id: "gpt-5.4" }, { id: " " }, { noId: true }],
  });
  assert.deepEqual(entries, [
    { id: "gpt-5.4", supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh"] },
  ]);
});

test("siliconflow-models descriptor carries the typed queries and capability-merging merge", () => {
  const descriptor = resolveModelCatalogParser("siliconflow-models");
  assert.deepEqual(
    descriptor.queries?.map((query) => query.query),
    ["type=text&sub_type=chat", "type=image", "sub_type=text-to-video"],
  );
  const imageEntries = descriptor.queries?.[1]?.parse({ data: [{ id: "acme/image-gen" }] });
  assert.deepEqual(imageEntries, [{ id: "acme/image-gen", supportsImageGeneration: true }]);
  const merged =
    descriptor.merge?.([
      { id: "acme/vl-chat", supportsImageInput: true },
      { id: "acme/vl-chat" },
    ]) ?? [];
  assert.deepEqual(merged, [{ id: "acme/vl-chat", supportsImageInput: true }]);
});

test("meituan-models descriptor parses bare-id lists and detail payloads", () => {
  const descriptor = resolveModelCatalogParser("meituan-models");
  assert.deepEqual(descriptor.parseList({ data: [{ id: "LongCat-2.0" }] }), [
    { id: "LongCat-2.0" },
  ]);
  assert.equal(
    descriptor.parseDetail?.({ id: "LongCat-2.0", name: "LongCat 2.0" })?.displayName,
    "LongCat 2.0",
  );
});

test("minimax-models descriptor rewrites the anthropic connect base to the openai-compatible listing base", () => {
  const descriptor = resolveModelCatalogParser("minimax-models");
  assert.equal(
    descriptor.resolveListingBase?.("https://api.minimax.io/anthropic/v1"),
    "https://api.minimax.io/v1",
  );
});

test("bedrock-models parseList consumes ListFoundationModels summaries", () => {
  const entries = resolveModelCatalogParser("bedrock-models").parseList([
    {
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      modelName: "Claude 3 Haiku",
      providerName: "Anthropic",
      inputModalities: ["TEXT"],
      outputModalities: ["TEXT"],
    },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "anthropic.claude-3-haiku-20240307-v1:0");
  assert.deepEqual(resolveModelCatalogParser("bedrock-models").parseList({}), []);
});
