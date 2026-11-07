import assert from "node:assert/strict";

import { test } from "vitest";

import { parseNebiusTokenFactoryModelEntriesPayload } from "./nebius-token-factory-models.js";
import { dedupeProviderListedModelEntries } from "./openai-models.js";

test("parses rich active language models without inferring controls or generation roles", () => {
  const entries = parseNebiusTokenFactoryModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "example/multimodal-chat",
        name: "Example Multimodal Chat",
        description: "A synthetic multimodal language model fixture.",
        created: 1_750_954_196,
        object: "model",
        owned_by: "system",
        status: "active",
        context_length: 131_072,
        architecture: {
          modality: "text+image+video->text",
          tokenizer: "ExampleTokenizer",
          instruct_type: "chat",
        },
        quantization: "fp8",
        pricing: {
          prompt: "0.00000003",
          completion: "0.00000009",
          input_cache_read: "0.00000001",
          image: "0",
          request: "0",
          price_per_video_second: "0.125",
          price_per_minute: "0.5",
          future_meter: "1.25",
        },
        per_request_limits: {
          tokens_per_minute: 800_000,
          requests_per_minute: 1_200,
          burst_ratio: 1.5,
        },
        regions: [{ country_code: "TL", name: "Testland" }, { name: "Global" }],
        supported_features: ["tools", "reasoning", "tools"],
        supported_sampling_parameters: ["temperature", "top_p"],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "example/multimodal-chat",
      displayName: "Example Multimodal Chat",
      description: "A synthetic multimodal language model fixture.",
      supportsImageInput: true,
      supportsVideoInput: true,
      contextLength: 131_072,
      architecture: {
        modality: "text+image+video->text",
        tokenizer: "ExampleTokenizer",
        instructType: "chat",
      },
      quantization: "fp8",
      pricing: {
        inputPerTokenUsd: "0.00000003",
        outputPerTokenUsd: "0.00000009",
        cachedInputPerTokenUsd: "0.00000001",
        requestPerCallUsd: "0",
        additionalPricing: {
          image: "0",
          price_per_video_second: "0.125",
          price_per_minute: "0.5",
          future_meter: "1.25",
        },
      },
      perRequestLimits: {
        tokensPerMinute: 800_000,
        requestsPerMinute: 1_200,
        burstRatio: 1.5,
      },
      regions: [{ countryCode: "TL", name: "Testland" }, { name: "Global" }],
      supportedFeatures: ["tools", "reasoning"],
      supportedSamplingParameters: ["temperature", "top_p"],
    },
  ]);
  assert.equal(entries[0]?.supportedReasoningEfforts, undefined);
  assert.equal(entries[0]?.supportsThinkingSwitch, undefined);
  assert.equal(entries[0]?.serviceTiers, undefined);
  assert.equal(entries[0]?.supportsImageGeneration, undefined);
  assert.equal(entries[0]?.supportsVideoGeneration, undefined);
});

test("accepts missing status and reports text-only input without using pricing as a capability signal", () => {
  const entries = parseNebiusTokenFactoryModelEntriesPayload({
    data: [
      {
        id: "example/text-chat",
        architecture: { modality: "text->text" },
        pricing: { image: "1", price_per_video_second: "2" },
      },
    ],
  });
  assert.deepEqual(entries, [
    {
      id: "example/text-chat",
      supportsImageInput: false,
      supportsVideoInput: false,
      architecture: { modality: "text->text" },
      pricing: {
        additionalPricing: { image: "1", price_per_video_second: "2" },
      },
    },
  ]);
});

test("filters inactive, malformed, and unsupported model roles", () => {
  const entries = parseNebiusTokenFactoryModelEntriesPayload({
    data: [
      { id: "example/validating", status: "validating", architecture: { modality: "text->text" } },
      { id: "example/error", status: "error", architecture: { modality: "text->text" } },
      { id: "example/deleted", status: "deleted", architecture: { modality: "text->text" } },
      { id: "example/embedding", status: "active", architecture: { modality: "text->embedding" } },
      { id: "example/rerank", status: "active", architecture: { modality: "text->score" } },
      { id: "example/asr", status: "active", architecture: { modality: "audio->text" } },
      { id: "example/tts", status: "active", architecture: { modality: "text->audio" } },
      { id: "example/image", status: "active", architecture: { modality: "text->image" } },
      { id: "example/video", status: "active", architecture: { modality: "text->video" } },
      { id: "example/mixed", status: "active", architecture: { modality: "text->text+image" } },
      { id: "example/missing-modality", status: "active", architecture: {} },
      { id: "example/bad-modality", status: "active", architecture: { modality: "text" } },
      { id: " " },
      { name: "missing id" },
      null,
    ],
  });
  assert.deepEqual(entries, []);
});

test("returns a valid empty catalog for empty or unrecognized payloads", () => {
  assert.deepEqual(parseNebiusTokenFactoryModelEntriesPayload({ object: "list", data: [] }), []);
  assert.deepEqual(parseNebiusTokenFactoryModelEntriesPayload({ object: "list" }), []);
  assert.deepEqual(parseNebiusTokenFactoryModelEntriesPayload(null), []);
});

test("dedupe preserves Nebius display metadata with defensive copies", () => {
  const [entry] = parseNebiusTokenFactoryModelEntriesPayload({
    data: [
      {
        id: "example/chat",
        architecture: { modality: "text+image->text" },
        pricing: { prompt: "1", price_per_minute: "2" },
        per_request_limits: { burst_ratio: 2 },
        regions: [{ country_code: "TL" }],
        supported_features: ["tools"],
        supported_sampling_parameters: ["temperature"],
      },
    ],
  });
  assert.ok(entry);
  const [deduped] = dedupeProviderListedModelEntries([entry, entry]);
  assert.deepEqual(deduped, entry);
  assert.notEqual(deduped?.architecture, entry.architecture);
  assert.notEqual(deduped?.pricing?.additionalPricing, entry.pricing?.additionalPricing);
  assert.notEqual(deduped?.perRequestLimits, entry.perRequestLimits);
  assert.notEqual(deduped?.regions?.[0], entry.regions?.[0]);
});
