import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "@spiritagent/host-internal";
import { ModelServiceTierConfigError } from "@spiritagent/agent-core/model-service-tier";

import { buildPrimaryTransportConfig } from "../../dist-electron/src/host/model-config.js";
import { updateConfigCommand } from "../../dist-electron/src/host/host-model-commands.js";
import { loadConfig, setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";
import {
  readModelCatalogCache,
  writeModelCatalogCache,
} from "../../dist-electron/src/host/model-catalog-cache.js";
import { createEmptySessionBundle } from "../../dist-electron/src/host/session-bundle.js";
import { attachRemoteDesktopRuntime } from "../../dist-electron/src/host/remote-runtime.js";

// ---------------------------------------------------------------------------
// buildPrimaryTransportConfig: stamp + validate
// ---------------------------------------------------------------------------

test("buildPrimaryTransportConfig stamps tier and upstream provider for aggregator routes", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "openrouter",
      transportKind: "openai-compatible",
      reasoningEffort: "medium",
      capabilities: ["languageModel"],
      serviceTier: "flex",
      upstreamProvider: "OpenAI",
    },
  });
  assert.equal(config.serviceTier, "flex");
  assert.equal(config.upstreamProvider, "OpenAI");
});

test("buildPrimaryTransportConfig stamps tier on the OpenAI responses transport", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "gpt-5.4",
    baseUrl: "https://api.openai.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "openai",
      transportKind: "open-responses",
      reasoningEffort: "medium",
      capabilities: ["languageModel"],
      serviceTier: "flex",
    },
  });
  assert.equal(config.transportKind, "open-responses");
  assert.equal(config.serviceTier, "flex");
  assert.equal("upstreamProvider" in config, false);
});

test("buildPrimaryTransportConfig stamps Anthropic native Fast on the anthropic transport", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "claude-opus-4-8",
    baseUrl: "https://api.anthropic.com",
    workspaceRoot: "/tmp",
    profile: {
      provider: "anthropic",
      transportKind: "anthropic",
      reasoningEffort: "medium",
      capabilities: ["languageModel"],
      serviceTier: "fast",
    },
  });
  assert.equal(config.transportKind, "anthropic");
  assert.equal(config.serviceTier, "fast");
  assert.equal("upstreamProvider" in config, false);
});

test("buildPrimaryTransportConfig rejects Anthropic Flex (native Fast only)", () => {
  assert.throws(
    () =>
      buildPrimaryTransportConfig({
        apiKey: "test-key",
        model: "claude-opus-4-8",
        baseUrl: "https://api.anthropic.com",
        workspaceRoot: "/tmp",
        profile: {
          provider: "anthropic",
          transportKind: "anthropic",
          capabilities: ["languageModel"],
          serviceTier: "flex",
        },
      }),
    ModelServiceTierConfigError,
  );
});

test("buildPrimaryTransportConfig rejects OpenAI priority (not offered upstream)", () => {
  assert.throws(
    () =>
      buildPrimaryTransportConfig({
        apiKey: "test-key",
        model: "gpt-5.4",
        baseUrl: "https://api.openai.com/v1",
        workspaceRoot: "/tmp",
        profile: {
          provider: "openai",
          transportKind: "open-responses",
          capabilities: ["languageModel"],
          serviceTier: "priority",
        },
      }),
    ModelServiceTierConfigError,
  );
});

test("buildPrimaryTransportConfig rejects an unknown tier value", () => {
  assert.throws(
    () =>
      buildPrimaryTransportConfig({
        apiKey: "test-key",
        model: "gpt-5.4",
        baseUrl: "https://api.openai.com/v1",
        workspaceRoot: "/tmp",
        profile: {
          provider: "openai",
          transportKind: "open-responses",
          capabilities: ["languageModel"],
          serviceTier: "turbo",
        },
      }),
    ModelServiceTierConfigError,
  );
});

test("buildPrimaryTransportConfig allows Vertex Flex on the global endpoint", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "gemini-3.1-pro-preview",
    baseUrl: "https://aiplatform.googleapis.com",
    workspaceRoot: "/tmp",
    profile: {
      provider: "google-vertex-ai",
      transportKind: "openai-compatible",
      vertexProject: "spirit-test-project",
      vertexLocation: "global",
      capabilities: ["languageModel"],
      serviceTier: "flex",
    },
  });
  assert.equal(config.serviceTier, "flex");
  assert.equal(config.vertexLocation, "global");
});

test("buildPrimaryTransportConfig rejects Vertex Flex on a regional endpoint", () => {
  assert.throws(
    () =>
      buildPrimaryTransportConfig({
        apiKey: "test-key",
        model: "gemini-3.1-pro-preview",
        baseUrl: "https://aiplatform.googleapis.com",
        workspaceRoot: "/tmp",
        profile: {
          provider: "google-vertex-ai",
          transportKind: "openai-compatible",
          vertexProject: "spirit-test-project",
          vertexLocation: "us-central1",
          capabilities: ["languageModel"],
          serviceTier: "flex",
        },
      }),
    ModelServiceTierConfigError,
  );
});

test("buildPrimaryTransportConfig omits the tier keys when none is configured", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "gpt-5.4",
    baseUrl: "https://api.openai.com/v1",
    workspaceRoot: "/tmp",
    profile: {
      provider: "openai",
      transportKind: "open-responses",
      reasoningEffort: "medium",
      capabilities: ["languageModel"],
    },
  });
  assert.equal("serviceTier" in config, false);
  assert.equal("upstreamProvider" in config, false);
});

test("buildPrimaryTransportConfig never stamps a tier on the bedrock transport", () => {
  const config = buildPrimaryTransportConfig({
    apiKey: "test-key",
    model: "anthropic.claude-sonnet-4-5",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    workspaceRoot: "/tmp",
    profile: {
      provider: "amazon-bedrock",
      transportKind: "bedrock",
      awsRegion: "us-east-1",
      capabilities: ["languageModel"],
    },
  });
  assert.equal(config.transportKind, "bedrock");
  assert.equal("serviceTier" in config, false);
  assert.equal("upstreamProvider" in config, false);
});

// ---------------------------------------------------------------------------
// Model catalog cache: upstreamProvider round-trip and legacy entries
// ---------------------------------------------------------------------------

async function withCatalogCacheDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-catalog-cache-"));
  setSpiritDataDirOverride(dir);
  try {
    await run(dir);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

const OPENROUTER_CACHE_ARGS = [
  "https://openrouter.ai/api/v1",
  undefined,
  "openrouter",
  "openai-compatible",
];

test("model catalog cache round-trips upstreamProvider", async () => {
  await withCatalogCacheDir(async () => {
    await writeModelCatalogCache(
      "https://openrouter.ai/api/v1",
      ["openai/gpt-5.4", "x-ai/grok-4.3"],
      "test-key",
      [
        {
          id: "openai/gpt-5.4",
          capabilities: ["languageModel"],
          contextLength: 400000,
          upstreamProvider: "OpenAI",
        },
        { id: "x-ai/grok-4.3", capabilities: ["languageModel"], contextLength: 256000 },
      ],
      "openrouter",
      "openai-compatible",
    );

    const entry = await readModelCatalogCache(...OPENROUTER_CACHE_ARGS);
    assert.ok(entry);
    const [first, second] = entry.modelCatalog;
    assert.equal(first.upstreamProvider, "OpenAI");
    assert.equal("upstreamProvider" in second, false);
  });
});

test("model catalog cache parses legacy entries without upstreamProvider", async () => {
  await withCatalogCacheDir(async (dir) => {
    await writeModelCatalogCache(
      "https://openrouter.ai/api/v1",
      ["openai/gpt-5.4"],
      "test-key",
      [
        {
          id: "openai/gpt-5.4",
          capabilities: ["languageModel"],
          contextLength: 400000,
          upstreamProvider: "OpenAI",
        },
      ],
      "openrouter",
      "openai-compatible",
    );

    // Rewrite the single cache file with the field stripped, mimicking a pre-upgrade cache.
    const cacheDir = path.join(dir, "model-catalog-cache");
    const [fileName] = await readdir(cacheDir);
    const filePath = path.join(cacheDir, fileName);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    delete raw.modelCatalog[0].upstreamProvider;
    await writeFile(filePath, `${JSON.stringify(raw)}\n`, "utf8");

    const entry = await readModelCatalogCache(...OPENROUTER_CACHE_ARGS);
    assert.ok(entry);
    assert.equal(entry.modelCatalog[0].id, "openai/gpt-5.4");
    assert.equal("upstreamProvider" in entry.modelCatalog[0], false);
  });
});

// ---------------------------------------------------------------------------
// updateConfigCommand: set / clear / reject + inference-preference refresh
// ---------------------------------------------------------------------------

const openAiGroup = (models) => ({
  id: "openai",
  provider: "openai",
  apiBase: "https://api.openai.com/v1",
  transportKind: "open-responses",
  models,
});

const anthropicGroup = (models) => ({
  id: "anthropic",
  provider: "anthropic",
  apiBase: "https://api.anthropic.com",
  transportKind: "anthropic",
  models,
});

const vertexGroup = (vertexLocation, models) => ({
  id: "vertex",
  provider: "google-vertex-ai",
  apiBase: "https://aiplatform.googleapis.com",
  transportKind: "openai-compatible",
  vertexProject: "spirit-test-project",
  vertexLocation,
  models,
});

async function withUpdateConfigFixture(rawConfig, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-service-tier-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify({ schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION, ...rawConfig }, null, 2)}\n`,
      "utf8",
    );
    const config = await loadConfig();
    await run({ config, dir });
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

function createUpdateConfigContext({ config, busy = false }) {
  const calls = {
    refreshRuntime: 0,
    refreshActiveModelTransportConfig: 0,
    refreshLspSnapshot: 0,
    flushDeferredRuntimeRefreshIfIdle: 0,
  };
  const bundle = {
    activePlanPath: undefined,
    activeModel: undefined,
    deferredRuntimeRefreshWhileBusy: false,
  };
  const ctx = {
    runSerialized: async (work) => work(),
    ensureInitialized: async () => {},
    requireState: () => ({
      workspaceRoot: "/tmp/spirit-service-tier-ws",
      workspaceBinding: "project",
      config,
      metadata: {},
    }),
    activeBundle: () => bundle,
    isRuntimeBusy: () => busy,
    refreshRuntime: async () => {
      calls.refreshRuntime += 1;
    },
    refreshActiveModelTransportConfig: async () => {
      calls.refreshActiveModelTransportConfig += 1;
    },
    refreshModelKeyPresence: async () => {},
    flushDeferredRuntimeRefreshIfIdle: async () => {
      calls.flushDeferredRuntimeRefreshIfIdle += 1;
    },
    persistCurrentSessionIfNeeded: async () => {},
    clearActiveContextUsage: () => {},
    setLastRuntimeError: () => {},
    buildSnapshot: () => ({ ok: true }),
    disposeAllLspServices: async () => {},
    invalidateToolExecutors: () => {},
    applyWebToolExposureToRuntimes: async () => {},
    refreshLspSnapshot: async () => {
      calls.refreshLspSnapshot += 1;
    },
  };
  return { ctx, calls, bundle };
}

const readDiskModel = async (dir, groupIndex = 0, modelIndex = 0) => {
  const written = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
  return written.providerGroups[groupIndex].models[modelIndex];
};

test("updateConfigCommand persists serviceTier via the inference-preference refresh path", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      const snapshot = await updateConfigCommand(ctx, {
        activeModel: { groupId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: "flex",
      });

      assert.deepEqual(snapshot, { ok: true });
      assert.equal(config.providerGroups[0].models[0].serviceTier, "flex");
      assert.equal((await readDiskModel(dir)).serviceTier, "flex");
      // Same-model tier change: light transport-config refresh, not a full runtime restart.
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
      assert.equal(calls.refreshLspSnapshot, 0);
      assert.equal(calls.flushDeferredRuntimeRefreshIfIdle, 1);
    },
  );
});

test("updateConfigCommand clears a stored serviceTier with null", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [
        openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium", serviceTier: "flex" }]),
      ],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { groupId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: null,
      });

      assert.equal("serviceTier" in config.providerGroups[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects an unsupported tier without touching the disk", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { groupId: "openai", name: "gpt-5.4" },
          apiBase: "https://api.openai.com/v1",
          serviceTier: "priority",
        }),
        ModelServiceTierConfigError,
      );

      assert.equal("serviceTier" in config.providerGroups[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 0);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects an unknown tier value", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    async ({ config }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { groupId: "openai", name: "gpt-5.4" },
          apiBase: "https://api.openai.com/v1",
          serviceTier: "turbo",
        }),
        ModelServiceTierConfigError,
      );
      assert.equal("serviceTier" in config.providerGroups[0].models[0], false);
    },
  );
});

test("updateConfigCommand sets and clears Anthropic native Fast", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [anthropicGroup([{ name: "claude-opus-4-8", reasoningEffort: "medium" }])],
      activeModel: { groupId: "anthropic", name: "claude-opus-4-8" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { groupId: "anthropic", name: "claude-opus-4-8" },
        apiBase: "https://api.anthropic.com",
        serviceTier: "fast",
      });
      assert.equal(config.providerGroups[0].models[0].serviceTier, "fast");
      assert.equal((await readDiskModel(dir)).serviceTier, "fast");

      await updateConfigCommand(ctx, {
        activeModel: { groupId: "anthropic", name: "claude-opus-4-8" },
        apiBase: "https://api.anthropic.com",
        serviceTier: null,
      });
      assert.equal("serviceTier" in config.providerGroups[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 2);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects Anthropic Flex (native Fast only)", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [anthropicGroup([{ name: "claude-opus-4-8", reasoningEffort: "medium" }])],
      activeModel: { groupId: "anthropic", name: "claude-opus-4-8" },
    },
    async ({ config }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { groupId: "anthropic", name: "claude-opus-4-8" },
          apiBase: "https://api.anthropic.com",
          serviceTier: "flex",
        }),
        ModelServiceTierConfigError,
      );
    },
  );
});

test("updateConfigCommand allows Vertex Flex on the global endpoint", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [
        vertexGroup("global", [{ name: "gemini-3.1-pro-preview", reasoningEffort: "medium" }]),
      ],
      activeModel: { groupId: "vertex", name: "gemini-3.1-pro-preview" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { groupId: "vertex", name: "gemini-3.1-pro-preview" },
        apiBase: "https://aiplatform.googleapis.com",
        serviceTier: "flex",
      });
      assert.equal(config.providerGroups[0].models[0].serviceTier, "flex");
      assert.equal((await readDiskModel(dir)).serviceTier, "flex");
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
    },
  );
});

test("updateConfigCommand rejects Vertex Flex on a regional endpoint", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [
        vertexGroup("us-central1", [{ name: "gemini-3.1-pro-preview", reasoningEffort: "medium" }]),
      ],
      activeModel: { groupId: "vertex", name: "gemini-3.1-pro-preview" },
    },
    async ({ config }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { groupId: "vertex", name: "gemini-3.1-pro-preview" },
          apiBase: "https://aiplatform.googleapis.com",
          serviceTier: "flex",
        }),
        ModelServiceTierConfigError,
      );
      assert.equal("serviceTier" in config.providerGroups[0].models[0], false);
    },
  );
});

test("updateConfigCommand routes a same-model tier change to the light refresh even when busy", async () => {
  await withUpdateConfigFixture(
    {
      providerGroups: [openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    async ({ config }) => {
      const { ctx, calls, bundle } = createUpdateConfigContext({ config, busy: true });
      await updateConfigCommand(ctx, {
        activeModel: { groupId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: "flex",
      });

      assert.equal(config.providerGroups[0].models[0].serviceTier, "flex");
      // Busy deferral happens inside the host's light refresh, not in the command.
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
      assert.equal(bundle.deferredRuntimeRefreshWhileBusy, false);
    },
  );
});

// ---------------------------------------------------------------------------
// Remote daemon attach: refreshDaemonConfig forces session.replaceConfig
// ---------------------------------------------------------------------------

const daemon = vi.hoisted(() => ({
  calls: [],
  daemonModel: "gpt-5.4",
  workspaceRoot: "/tmp/spirit-service-tier-remote-ws",
}));

vi.mock("@spiritagent/server/client", () => {
  const emptySnapshot = () => ({
    pendingImagePaths: [],
    pendingMcpResources: [],
    hasPendingApproval: false,
    hasPendingManualApproval: false,
    hasPendingQuestions: false,
    childSessions: [],
    isBusy: false,
    loopEnabled: false,
    approvalLevel: "default",
  });
  const client = {
    call: async (method, params) => {
      daemon.calls.push({ method, params });
      switch (method) {
        case "server.initialize":
          return {};
        case "session.attach":
          return {
            session: {
              sessionId: "sess-1",
              workspaceRoot: daemon.workspaceRoot,
              hostKind: "desktop",
              createdAt: "2026-01-01T00:00:00.000Z",
              isBusy: false,
              approvalLevel: "default",
              model: daemon.daemonModel,
              attachmentCount: 1,
            },
            snapshot: emptySnapshot(),
          };
        case "session.replaceConfig":
          return {};
        case "session.poll":
          return { snapshot: emptySnapshot() };
        case "session.setApprovalLevel":
        case "session.setMode":
        case "session.setTodoSessionKey":
        case "session.setWebToolExposure":
          return {};
        case "session.exportArchive":
          return {
            messages: params?.messages ?? [],
            assistantAux: params?.assistantAux ?? [],
            llmHistory: [],
            subagentSessions: [],
          };
        case "session.detach":
          return { closed: false };
        default:
          throw new Error(`unexpected daemon method: ${method}`);
      }
    },
    onNotification: () => () => {},
    onDisconnect: () => () => {},
    close: async () => {},
  };
  return { connectOrSpawnServer: async () => ({ client }) };
});

async function withRemoteDataDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-service-tier-remote-"));
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providerGroups: [openAiGroup([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
          activeModel: { groupId: "openai", name: "gpt-5.4" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const remoteAttachInput = (dataDir, extra = {}) => ({
  dataDir,
  workspaceRoot: daemon.workspaceRoot,
  modelRef: { groupId: "openai", name: "gpt-5.4" },
  agentMode: "agent",
  archive: { messages: [], assistantAux: [], llmHistory: [], subagentSessions: [] },
  approvalLevel: "default",
  conversationKey: "/tmp/spirit-service-tier-remote/chat.json",
  ...extra,
});

const replaceConfigCalls = () =>
  daemon.calls.filter(({ method }) => method === "session.replaceConfig");

test("remote attach skips session.replaceConfig when the daemon already runs the model", async () => {
  await withRemoteDataDir(async (dataDir) => {
    daemon.calls.length = 0;
    daemon.daemonModel = "gpt-5.4";
    const runtime = await attachRemoteDesktopRuntime(remoteAttachInput(dataDir));
    assert.equal(replaceConfigCalls().length, 0);
    await runtime.close();
  });
});

test("remote attach forces session.replaceConfig for inference-preference updates", async () => {
  await withRemoteDataDir(async (dataDir) => {
    daemon.calls.length = 0;
    daemon.daemonModel = "gpt-5.4";
    const runtime = await attachRemoteDesktopRuntime(
      remoteAttachInput(dataDir, { refreshDaemonConfig: true }),
    );
    assert.equal(replaceConfigCalls().length, 1);
    assert.deepEqual(replaceConfigCalls()[0].params, {
      sessionId: "sess-1",
      modelRef: { groupId: "openai", name: "gpt-5.4" },
    });
    await runtime.close();
  });
});

test("remote attach still replaces config when the daemon runs a different model", async () => {
  await withRemoteDataDir(async (dataDir) => {
    daemon.calls.length = 0;
    daemon.daemonModel = "gpt-4.1";
    const runtime = await attachRemoteDesktopRuntime(remoteAttachInput(dataDir));
    assert.equal(replaceConfigCalls().length, 1);
    await runtime.close();
  });
});

// ---------------------------------------------------------------------------
// DesktopHostService: busy deferral and idle flush of light refreshes
// ---------------------------------------------------------------------------

async function withHostService(run) {
  // DesktopHostService captures the data dir at construction; the override must land
  // before the service module is imported, hence the dynamic import here.
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-service-tier-host-"));
  setSpiritDataDirOverride(spiritDataDir);
  const { DesktopHostService } = await import("../../dist-electron/src/host/service.js");
  const service = new DesktopHostService();
  service["state"] = {
    workspaceRoot: "/tmp/spirit-service-tier-ws",
    workspaceBinding: "project",
    config: {
      schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
      providerGroups: [],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    metadata: {},
  };
  try {
    await run(service);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

test("busy runtime defers an inference-preference refresh on the dedicated flag", async () => {
  await withHostService(async (service) => {
    const bundle = createEmptySessionBundle("/tmp/spirit-service-tier-ws", "session-1");
    bundle.runtime = { isBusy: () => true };

    await service["refreshRuntimeForBundle"](bundle, { inferencePreferenceOnly: true });

    assert.equal(bundle.deferredInferencePreferenceRefreshWhileBusy, true);
    assert.equal(bundle.deferredRuntimeRefreshWhileBusy, false);
  });
});

test("flushDeferredRuntimeRefreshIfIdle is a no-op while the runtime stays busy", async () => {
  await withHostService(async (service) => {
    const bundle = createEmptySessionBundle("/tmp/spirit-service-tier-ws", "session-1");
    bundle.runtime = { isBusy: () => true };
    bundle.deferredInferencePreferenceRefreshWhileBusy = true;

    let refreshCalls = 0;
    service["refreshRuntimeForBundle"] = async () => {
      refreshCalls += 1;
    };
    await service["flushDeferredRuntimeRefreshIfIdle"](bundle);

    assert.equal(refreshCalls, 0);
    assert.equal(bundle.deferredInferencePreferenceRefreshWhileBusy, true);
  });
});

test("idle flush replays a deferred inference-preference refresh as the light path", async () => {
  await withHostService(async (service) => {
    const bundle = createEmptySessionBundle("/tmp/spirit-service-tier-ws", "session-1");
    bundle.deferredInferencePreferenceRefreshWhileBusy = true;

    const refreshCalls = [];
    service["refreshRuntimeForBundle"] = async (target, options) => {
      refreshCalls.push({ target, options });
    };
    await service["flushDeferredRuntimeRefreshIfIdle"](bundle);

    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].target, bundle);
    assert.deepEqual(refreshCalls[0].options, { inferencePreferenceOnly: true });
    assert.equal(bundle.deferredInferencePreferenceRefreshWhileBusy, false);
    assert.equal(bundle.deferredRuntimeRefreshWhileBusy, false);
  });
});

test("idle flush prefers a full refresh when both deferral flags are set", async () => {
  await withHostService(async (service) => {
    const bundle = createEmptySessionBundle("/tmp/spirit-service-tier-ws", "session-1");
    bundle.deferredRuntimeRefreshWhileBusy = true;
    bundle.deferredInferencePreferenceRefreshWhileBusy = true;

    const refreshCalls = [];
    service["refreshRuntimeForBundle"] = async (target, options) => {
      refreshCalls.push({ target, options });
    };
    await service["flushDeferredRuntimeRefreshIfIdle"](bundle);

    assert.equal(refreshCalls.length, 1);
    assert.deepEqual(refreshCalls[0].options, {});
    assert.equal(bundle.deferredInferencePreferenceRefreshWhileBusy, false);
    assert.equal(bundle.deferredRuntimeRefreshWhileBusy, false);
  });
});
