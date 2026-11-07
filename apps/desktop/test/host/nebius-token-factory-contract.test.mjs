import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { loadPreviewModelsForTransport } from "../../dist-electron/src/host/model-config.js";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

async function startCatalogServer(data) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ object: "list", data }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    requests,
    apiBase: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-nebius-contract-"));
  setSpiritDataDirOverride(dir);
  try {
    await run();
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

const verboseModels = [
  {
    id: "example/multimodal-chat",
    name: "Example Multimodal Chat",
    status: "active",
    context_length: 131072,
    architecture: { modality: "text+image+video->text", tokenizer: "ExampleTokenizer" },
    pricing: {
      prompt: "0.00000003",
      completion: "0.00000009",
      image: "1",
      price_per_video_second: "2",
    },
    supported_features: ["tools"],
    supported_sampling_parameters: ["temperature"],
  },
  {
    id: "example/inactive",
    status: "deleted",
    architecture: { modality: "text->text" },
  },
  {
    id: "example/embedding",
    status: "active",
    architecture: { modality: "text->embedding" },
  },
];

test("Nebius listing uses one authenticated verbose request and caches transport projections", async () => {
  await withDataDir(async () => {
    const server = await startCatalogServer(verboseModels);
    try {
      const chat = await loadPreviewModelsForTransport({
        providerId: "nebius-token-factory",
        transportKind: "openai-compatible",
        apiBase: server.apiBase,
        apiKey: "test-key",
        forceRefresh: true,
      });
      assert.equal(chat.fromCache, false);
      assert.deepEqual(chat.modelIds, ["example/multimodal-chat"]);
      assert.deepEqual(chat.modelCatalog?.[0]?.capabilities, ["languageModel", "image", "video"]);
      assert.equal(chat.modelCatalog?.[0]?.capabilities.includes("imageGeneration"), false);
      assert.equal(chat.modelCatalog?.[0]?.capabilities.includes("videoGeneration"), false);
      assert.equal(chat.modelCatalog?.[0]?.supportedReasoningEfforts, undefined);
      assert.equal(chat.modelCatalog?.[0]?.serviceTiers, undefined);
      assert.equal(chat.modelCatalog?.[0]?.pricing?.imagePerUnitUsd, undefined);
      assert.deepEqual(chat.modelCatalog?.[0]?.pricing?.additionalPricing, {
        image: "1",
        price_per_video_second: "2",
      });

      const responses = await loadPreviewModelsForTransport({
        providerId: "nebius-token-factory",
        transportKind: "open-responses",
        apiBase: server.apiBase,
        apiKey: "test-key",
        forceRefresh: false,
      });
      assert.equal(responses.fromCache, true);
      assert.deepEqual(responses.modelCatalog?.[0]?.capabilities, ["languageModel", "image"]);
      assert.deepEqual(
        server.requests.map((request) => request.url),
        ["/v1/models?verbose=true"],
      );
      assert.equal(server.requests[0]?.authorization, "Bearer test-key");
      assert.equal(
        server.requests.some((request) => request.url?.includes("models_info")),
        false,
      );
    } finally {
      await server.close();
    }
  });
});

test("Nebius valid empty catalog loads successfully without an overlay request", async () => {
  await withDataDir(async () => {
    const server = await startCatalogServer([]);
    try {
      const result = await loadPreviewModelsForTransport({
        providerId: "nebius-token-factory",
        transportKind: "openai-compatible",
        apiBase: server.apiBase,
        apiKey: "test-key",
        forceRefresh: true,
      });
      assert.deepEqual(result.modelIds, []);
      assert.deepEqual(result.modelCatalog, []);
      assert.deepEqual(
        server.requests.map((request) => request.url),
        ["/v1/models?verbose=true"],
      );
    } finally {
      await server.close();
    }
  });
});
