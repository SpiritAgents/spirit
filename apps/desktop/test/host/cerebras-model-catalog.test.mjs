import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  readModelCatalogCache,
  writeModelCatalogCache,
} from "../../dist-electron/src/host/model-catalog-cache.js";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

test("Cerebras rich catalog metadata survives cache refresh round-trips", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-cerebras-catalog-"));
  setSpiritDataDirOverride(dir);
  try {
    const catalogMetadata = {
      created: 0,
      ownedBy: "Cerebras",
      huggingFaceId: "example/shared-model",
      capabilities: { tools: true, vision: true, ignored: "not-a-boolean" },
      supportedParameters: { temperature: true, stop: false },
      architecture: { modality: "text+image", tokenizer: "Qwen", instructType: "chatml" },
      datacenterLocations: ["US-Central"],
      deprecated: false,
      preview: true,
      quantization: "FP8",
      rateLimits: { requestsPerMinute: 60, tokensPerMinute: null },
    };
    await writeModelCatalogCache(
      "https://api.cerebras.ai/v1",
      ["qwen-3.8-27b"],
      "test-key",
      [
        {
          id: "qwen-3.8-27b",
          displayName: "Qwen 3.8 27B",
          description: "Shared multilingual reasoning model.",
          pricing: { inputPerTokenUsd: "0.000001", outputPerTokenUsd: "0.000002" },
          capabilities: ["languageModel", "image"],
          contextLength: 131072,
          maxCompletionTokens: 32768,
          catalogMetadata,
        },
      ],
      "cerebras",
    );

    const cached = await readModelCatalogCache(
      "https://api.cerebras.ai/v1",
      "test-key",
      "cerebras",
    );
    assert.ok(cached);
    assert.deepEqual(cached.modelCatalog[0].catalogMetadata, {
      ...catalogMetadata,
      capabilities: { tools: true, vision: true },
    });
    assert.equal(cached.modelCatalog[0].maxCompletionTokens, 32768);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
