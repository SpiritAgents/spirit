import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION, setKeyringStoreForTests } from "@spiritagent/host-internal";

import {
  addProviderModelsCommand,
  removeProviderGroupCommand,
} from "../../../../packages/sessions/dist/host/host-model-commands.js";
import { fetchCatalogModels } from "../../../../packages/sessions/dist/host/model-config.js";
import {
  loadConfig,
  setSpiritDataDirOverride,
} from "../../../../packages/sessions/dist/host/storage.js";

function existingOpenAiProvider() {
  return {
    id: "openai",
    apiBase: "https://api.openai.com/v1",
    transportKind: "open-responses",
    sdk: "@ai-sdk/openai",
    models: [
      { name: "gpt-5.4", capabilities: ["languageModel"] },
      { name: "gpt-image-2", capabilities: ["imageGeneration"] },
      { name: "gpt-video-2", capabilities: ["videoGeneration"] },
    ],
  };
}

function existingDefaults() {
  return {
    activeModel: { providerId: "openai", name: "gpt-5.4" },
    imageGenerationModel: { providerId: "openai", name: "gpt-image-2" },
    videoGenerationModel: { providerId: "openai", name: "gpt-video-2" },
    secondaryLanguageModel: { providerId: "openai", name: "gpt-5.4" },
  };
}

async function withConnectFixture(providers, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-empty-catalog-"));
  const store = new Map();
  setSpiritDataDirOverride(dir);
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providers,
          ...existingDefaults(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const config = await loadConfig();
    const bundle = {
      activePlanPath: undefined,
      activeModel: undefined,
      deferredRuntimeRefreshWhileBusy: false,
    };
    const state = {
      workspaceRoot: "/tmp/spirit-empty-catalog-ws",
      workspaceBinding: "project",
      config,
      metadata: {},
    };
    const ctx = {
      runSerialized: async (work) => work(),
      ensureInitialized: async () => {},
      requireState: () => state,
      activeBundle: () => bundle,
      isRuntimeBusy: () => false,
      refreshRuntime: async () => {},
      refreshActiveModelTransportConfig: async () => {},
      refreshModelKeyPresence: async () => {},
      flushDeferredRuntimeRefreshIfIdle: async () => {},
      persistCurrentSessionIfNeeded: async () => {},
      clearActiveContextUsage: () => {},
      setLastRuntimeError: () => {},
      buildSnapshot: () => ({ ok: true }),
      disposeAllLspServices: async () => {},
      invalidateToolExecutors: () => {},
      applyWebToolExposureToRuntimes: async () => {},
      refreshLspSnapshot: async () => {},
    };
    await run({ ctx, dir, state, store });
  } finally {
    setSpiritDataDirOverride(undefined);
    setKeyringStoreForTests(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

async function readDiskConfig(dir) {
  return JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
}

test("generic catalog discovery accepts valid empty lists and rejects malformed or failed responses", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/empty/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [], object: "list" }));
      return;
    }
    if (request.url === "/malformed/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list" }));
      return;
    }
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "invalid key" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const list = (pathPrefix) =>
      fetchCatalogModels({
        providerId: "custom-local",
        transportKind: "openai-compatible",
        apiBase: `${origin}/${pathPrefix}/v1`,
        apiKey: "test-key",
      });

    assert.deepEqual(await list("empty"), []);
    await assert.rejects(list("malformed"), /compatible model list/);
    await assert.rejects(list("unauthorized"), /HTTP 401.*invalid key/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("connecting an empty catalog preserves unrelated default model references", async () => {
  await withConnectFixture([existingOpenAiProvider()], async ({ ctx, dir }) => {
    await addProviderModelsCommand(ctx, {
      provider: "mistral",
      apiBase: "",
      apiKey: "test-key",
      modelIds: [],
      modelCatalog: [],
    });

    const config = await readDiskConfig(dir);
    const mistral = config.providers.find((provider) => provider.id === "mistral");
    assert.ok(mistral);
    assert.deepEqual(mistral.models, []);
    for (const [slot, expected] of Object.entries(existingDefaults())) {
      assert.deepEqual(config[slot], expected);
    }
  });
});

test("empty reconnect prunes stale models and an empty provider group can be deleted", async () => {
  const staleCustom = {
    id: "empty-catalog-fixture",
    label: "Empty Catalog Fixture",
    apiBase: "http://127.0.0.1:9/v1",
    models: [{ name: "old-shared-model", capabilities: ["languageModel"] }],
  };
  await withConnectFixture([existingOpenAiProvider(), staleCustom], async ({ ctx, dir }) => {
    await addProviderModelsCommand(ctx, {
      provider: "custom",
      providerId: "empty-catalog-fixture",
      customProviderLabel: "Empty Catalog Fixture",
      apiBase: "http://127.0.0.1:9/v1",
      apiKey: "replacement-key",
      modelIds: [],
      modelCatalog: [],
    });

    let config = await readDiskConfig(dir);
    const custom = config.providers.find((provider) => provider.id === "empty-catalog-fixture");
    assert.ok(custom);
    assert.deepEqual(custom.models, []);
    for (const [slot, expected] of Object.entries(existingDefaults())) {
      assert.deepEqual(config[slot], expected);
    }

    await removeProviderGroupCommand(ctx, { providerId: "empty-catalog-fixture" });
    config = await readDiskConfig(dir);
    assert.deepEqual(
      config.providers.map((provider) => provider.id),
      ["openai"],
    );
    for (const [slot, expected] of Object.entries(existingDefaults())) {
      assert.deepEqual(config[slot], expected);
    }
  });
});
