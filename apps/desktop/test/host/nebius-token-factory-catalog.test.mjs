import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  readModelCatalogCache,
  writeModelCatalogCache,
} from "../../dist-electron/src/host/model-catalog-cache.js";
import { previewModelCatalogForTransport } from "../../dist-electron/src/host/model-catalog-metadata.js";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

const listedEntry = {
  id: "example/multimodal-chat",
  displayName: "Example Multimodal Chat",
  description: "Synthetic catalog metadata.",
  supportsImageInput: true,
  supportsVideoInput: true,
  contextLength: 131072,
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
    imagePerUnitUsd: "0",
    requestPerCallUsd: "0",
    additionalPricing: { price_per_video_second: "0.125", price_per_minute: "0.5" },
  },
  perRequestLimits: { tokensPerMinute: 800000, requestsPerMinute: 1200, burstRatio: 1.5 },
  regions: [{ countryCode: "TL", name: "Testland" }],
  supportedFeatures: ["tools", "reasoning"],
  supportedSamplingParameters: ["temperature", "top_p"],
};

const previewEntry = {
  id: listedEntry.id,
  displayName: listedEntry.displayName,
  description: listedEntry.description,
  capabilities: ["languageModel", "image", "video"],
  contextLength: listedEntry.contextLength,
  architecture: listedEntry.architecture,
  quantization: listedEntry.quantization,
  pricing: listedEntry.pricing,
  perRequestLimits: listedEntry.perRequestLimits,
  regions: listedEntry.regions,
  supportedFeatures: listedEntry.supportedFeatures,
  supportedSamplingParameters: listedEntry.supportedSamplingParameters,
};

test("Nebius preview materializes all rich display metadata without generation roles", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "nebius-token-factory",
    transportKind: "openai-compatible",
    listedModels: [listedEntry],
  });
  assert.deepEqual(preview, [previewEntry]);
  assert.equal(preview?.[0]?.capabilities.includes("imageGeneration"), false);
  assert.equal(preview?.[0]?.capabilities.includes("videoGeneration"), false);
});

test("Nebius catalog cache round-trips architecture, limits, regions, features, and pricing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-nebius-catalog-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeModelCatalogCache(
      "https://api.tokenfactory.nebius.com/v1",
      [previewEntry.id],
      "test-key",
      [previewEntry],
      "nebius-token-factory",
    );
    const cached = await readModelCatalogCache(
      "https://api.tokenfactory.nebius.com/v1",
      "test-key",
      "nebius-token-factory",
    );
    assert.ok(cached);
    assert.deepEqual(cached.modelCatalog, [previewEntry]);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
