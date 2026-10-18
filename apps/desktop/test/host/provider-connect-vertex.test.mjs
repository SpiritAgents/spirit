import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  SPIRIT_CONFIG_SCHEMA_VERSION,
  providerInternalSlotAccount,
  setKeyringStoreForTests,
} from "@spiritagent/host-internal";

import {
  addProviderModelsCommand,
  previewModelsCommand,
} from "../../dist-electron/src/host/host-model-commands.js";
import { writeModelCatalogCache } from "../../dist-electron/src/host/model-catalog-cache.js";
import { loadConfig, setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

const VERTEX_PROJECT = "my-gcp-project";
const VERTEX_LOCATION = "us-central1";
const VERTEX_ADC_API_BASE = `https://us-central1-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}`;

async function withVertexConnectFixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-vertex-connect-"));
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
      `${JSON.stringify({ schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION, providers: [] }, null, 2)}\n`,
      "utf8",
    );
    const config = await loadConfig();
    await run({ config, dir, store });
  } finally {
    setSpiritDataDirOverride(undefined);
    setKeyringStoreForTests(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

function createConnectContext({ config }) {
  const bundle = {
    activePlanPath: undefined,
    activeModel: undefined,
    deferredRuntimeRefreshWhileBusy: false,
  };
  return {
    runSerialized: async (work) => work(),
    ensureInitialized: async () => {},
    requireState: () => ({
      workspaceRoot: "/tmp/spirit-vertex-connect-ws",
      workspaceBinding: "project",
      config,
      metadata: {},
    }),
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
}

const readDiskProvider = async (dir, providerIndex = 0) => {
  const written = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
  return written.providers[providerIndex];
};

test("vertex ADC connect materializes the templated base and options with no credential slots", async () => {
  await withVertexConnectFixture(async ({ config, dir, store }) => {
    const ctx = createConnectContext({ config });
    await addProviderModelsCommand(ctx, {
      provider: "google-vertex-ai",
      credentialKind: "vertex",
      apiBase: "",
      apiKey: "",
      modelIds: ["gemini-2.5-pro"],
      vertexProject: VERTEX_PROJECT,
      vertexLocation: VERTEX_LOCATION,
    });

    const entry = await readDiskProvider(dir);
    assert.equal(entry.id, "google-vertex-ai");
    assert.equal(entry.apiBase, VERTEX_ADC_API_BASE);
    // transportKind is omitted when it equals the preset default (openai-compatible).
    assert.equal("transportKind" in entry, false);
    assert.equal(entry.sdk, "@ai-sdk/google-vertex");
    assert.deepEqual(entry.options, { project: VERTEX_PROJECT, location: VERTEX_LOCATION });
    assert.deepEqual(
      entry.models.map((model) => model.name),
      ["gemini-2.5-pro"],
    );
    // ADC: the wizard writes no credential slots, so the keyring stays untouched.
    assert.equal(store.size, 0);
  });
});

test("vertex service-account connect writes the clientEmail/privateKey slots", async () => {
  await withVertexConnectFixture(async ({ config, dir, store }) => {
    const ctx = createConnectContext({ config });
    await addProviderModelsCommand(ctx, {
      provider: "google-vertex-ai",
      credentialKind: "vertex",
      apiBase: "",
      apiKey: "",
      modelIds: ["gemini-2.5-pro"],
      vertexProject: VERTEX_PROJECT,
      vertexLocation: VERTEX_LOCATION,
      vertexClientEmail: "svc@example.iam.gserviceaccount.com",
      vertexPrivateKey: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
    });

    const entry = await readDiskProvider(dir);
    assert.equal(entry.apiBase, VERTEX_ADC_API_BASE);
    assert.deepEqual(entry.options, { project: VERTEX_PROJECT, location: VERTEX_LOCATION });
    assert.equal(
      store.get(`Spirit/${providerInternalSlotAccount("google-vertex-ai", "clientEmail")}`),
      "svc@example.iam.gserviceaccount.com",
    );
    // Keyring writes store the trimmed secret.
    assert.equal(
      store.get(`Spirit/${providerInternalSlotAccount("google-vertex-ai", "privateKey")}`),
      "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
    );
    assert.equal(store.size, 2);
  });
});

test("vertex ADC preview resolves the catalog with project/location and no secrets", async () => {
  await withVertexConnectFixture(async () => {
    // Seed the catalog cache so the preview resolves without hitting Google ADC in tests.
    await writeModelCatalogCache(
      VERTEX_ADC_API_BASE,
      ["gemini-2.5-pro"],
      "",
      [{ id: "gemini-2.5-pro", capabilities: ["languageModel"] }],
      "google-vertex-ai",
    );

    const res = await previewModelsCommand({
      provider: "google-vertex-ai",
      credentialKind: "vertex",
      apiBase: "",
      apiKey: "",
      vertexProject: VERTEX_PROJECT,
      vertexLocation: VERTEX_LOCATION,
      forceRefresh: false,
    });

    assert.deepEqual(res.modelIds, ["gemini-2.5-pro"]);
    assert.equal(res.fromCache, true);
  });
});

test("vertex ADC preview still requires project and location", async () => {
  await withVertexConnectFixture(async () => {
    // Missing template values fail at apiBase materialization, before any credential check.
    await assert.rejects(
      previewModelsCommand({
        provider: "google-vertex-ai",
        credentialKind: "vertex",
        apiBase: "",
        apiKey: "",
        vertexLocation: VERTEX_LOCATION,
        forceRefresh: false,
      }),
      /unresolved placeholders/,
    );
  });
});
