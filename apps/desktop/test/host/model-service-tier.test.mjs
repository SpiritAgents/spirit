import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION } from "@spiritagent/host-internal";

import { updateConfigCommand } from "../../dist-electron/src/host/host-model-commands.js";
import { loadConfig, setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";
import {
  readModelCatalogCache,
  writeModelCatalogCache,
} from "../../dist-electron/src/host/model-catalog-cache.js";
import { createEmptySessionBundle } from "../../dist-electron/src/host/session-bundle.js";
import { attachRemoteDesktopRuntime } from "../../dist-electron/src/host/remote-runtime.js";

// ---------------------------------------------------------------------------
// Model catalog cache: entry round-trip and sparse entries
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

const OPENROUTER_CACHE_ARGS = ["https://openrouter.ai/api/v1", "test-key", "openrouter"];

test("model catalog cache round-trips upstreamProvider display metadata", async () => {
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
    );

    const entry = await readModelCatalogCache(...OPENROUTER_CACHE_ARGS);
    assert.ok(entry);
    const [first, second] = entry.modelCatalog;
    assert.equal(first.upstreamProvider, "OpenAI");
    assert.equal("upstreamProvider" in second, false);
    assert.equal(entry.providerId, "openrouter");
  });
});

test("model catalog cache parses sparse entries", async () => {
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
    );

    // Rewrite the single cache file with the field stripped, mimicking a sparse entry.
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

test("model catalog cache round-trips literal serviceTiers and input limits", async () => {
  await withCatalogCacheDir(async () => {
    await writeModelCatalogCache(
      "https://ai-gateway.vercel.sh/v1",
      ["openai/gpt-5.4", "anthropic/claude-opus-4.8"],
      "test-key",
      [
        {
          id: "openai/gpt-5.4",
          capabilities: ["languageModel"],
          upstreamProvider: "OpenAI",
          serviceTiers: {
            default: {},
            flex: { providerOptions: { gateway: { serviceTier: "flex" } } },
            fast: {
              providerOptions: { gateway: { serviceTier: "fast" } },
              maxInputTokens: 278528,
            },
          },
        },
        {
          id: "anthropic/claude-opus-4.8",
          capabilities: ["languageModel"],
          upstreamProvider: "Anthropic",
          serviceTiers: [],
        },
      ],
      "vercel-ai-gateway",
    );

    const entry = await readModelCatalogCache(
      "https://ai-gateway.vercel.sh/v1",
      "test-key",
      "vercel-ai-gateway",
    );
    assert.ok(entry);
    const [first, second] = entry.modelCatalog;
    assert.deepEqual(first.serviceTiers, {
      default: {},
      flex: { providerOptions: { gateway: { serviceTier: "flex" } } },
      fast: {
        providerOptions: { gateway: { serviceTier: "fast" } },
        maxInputTokens: 278528,
      },
    });
    // The explicit empty list survives the round-trip (it suppresses the knowledge fold).
    assert.deepEqual(second.serviceTiers, []);
  });
});

// ---------------------------------------------------------------------------
// updateConfigCommand: set / clear / reject + inference-preference refresh
// ---------------------------------------------------------------------------

const openAiProvider = (models) => ({
  id: "openai",
  apiBase: "https://api.openai.com/v1",
  transportKind: "open-responses",
  sdk: "@ai-sdk/openai",
  models,
});

const anthropicProvider = (models) => ({
  id: "anthropic",
  apiBase: "https://api.anthropic.com",
  transportKind: "anthropic",
  sdk: "@ai-sdk/anthropic",
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

const readDiskModel = async (dir, providerIndex = 0, modelIndex = 0) => {
  const written = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
  return written.providers[providerIndex].models[modelIndex];
};

test("updateConfigCommand persists serviceTier via the inference-preference refresh path", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        openAiProvider([
          {
            name: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTiers: ["auto", "default", "flex", "fast"],
          },
        ]),
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      const snapshot = await updateConfigCommand(ctx, {
        activeModel: { providerId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: "flex",
      });

      assert.deepEqual(snapshot, { ok: true });
      assert.equal(config.providers[0].models[0].serviceTier, "flex");
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
      providers: [
        openAiProvider([
          {
            name: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTiers: ["default", "flex"],
            serviceTier: "flex",
          },
        ]),
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: null,
      });

      assert.equal("serviceTier" in config.providers[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects an undeclared tier without touching the disk", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        openAiProvider([
          { name: "gpt-5.4", reasoningEffort: "medium", serviceTiers: ["default", "flex"] },
        ]),
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { providerId: "openai", name: "gpt-5.4" },
          apiBase: "https://api.openai.com/v1",
          serviceTier: "priority",
        }),
        /not in the declared serviceTiers/,
      );

      assert.equal("serviceTier" in config.providers[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 0);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects a tier when the model declares no serviceTiers", async () => {
  await withUpdateConfigFixture(
    {
      providers: [openAiProvider([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { providerId: "openai", name: "gpt-5.4" },
          apiBase: "https://api.openai.com/v1",
          serviceTier: "flex",
        }),
        /declares no serviceTiers/,
      );
      assert.equal("serviceTier" in config.providers[0].models[0], false);
    },
  );
});

test("updateConfigCommand sets and clears a declared tier on an anthropic entry", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        anthropicProvider([
          {
            name: "claude-opus-4-8",
            reasoningEffort: "medium",
            serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
          },
        ]),
      ],
      activeModel: { providerId: "anthropic", name: "claude-opus-4-8" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "anthropic", name: "claude-opus-4-8" },
        apiBase: "https://api.anthropic.com",
        serviceTier: "fast",
      });
      assert.equal(config.providers[0].models[0].serviceTier, "fast");
      assert.equal((await readDiskModel(dir)).serviceTier, "fast");

      await updateConfigCommand(ctx, {
        activeModel: { providerId: "anthropic", name: "claude-opus-4-8" },
        apiBase: "https://api.anthropic.com",
        serviceTier: null,
      });
      assert.equal("serviceTier" in config.providers[0].models[0], false);
      assert.equal("serviceTier" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 2);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects a tier missing from the literal declaration map", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        anthropicProvider([
          {
            name: "claude-opus-4-8",
            reasoningEffort: "medium",
            serviceTiers: { fast: { headers: { "anthropic-beta": "fast-mode-2026-02-01" } } },
          },
        ]),
      ],
      activeModel: { providerId: "anthropic", name: "claude-opus-4-8" },
    },
    async ({ config }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { providerId: "anthropic", name: "claude-opus-4-8" },
          apiBase: "https://api.anthropic.com",
          serviceTier: "flex",
        }),
        /not in the declared serviceTiers/,
      );
    },
  );
});

test("updateConfigCommand routes a same-model tier change to the light refresh even when busy", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        openAiProvider([
          {
            name: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTiers: ["auto", "default", "flex", "fast"],
          },
        ]),
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config }) => {
      const { ctx, calls, bundle } = createUpdateConfigContext({ config, busy: true });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        serviceTier: "flex",
      });

      assert.equal(config.providers[0].models[0].serviceTier, "flex");
      // Busy deferral happens inside the host's light refresh, not in the command.
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
      assert.equal(bundle.deferredRuntimeRefreshWhileBusy, false);
    },
  );
});

// ---------------------------------------------------------------------------
// updateConfigCommand: thinkingEnabled (user state gated on supportsThinkingSwitch)
// ---------------------------------------------------------------------------

test("updateConfigCommand persists thinkingEnabled=false via the inference-preference refresh path", async () => {
  await withUpdateConfigFixture(
    {
      providers: [openAiProvider([{ name: "gpt-5.4", supportsThinkingSwitch: true }])],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        thinkingEnabled: false,
      });

      assert.equal(config.providers[0].models[0].thinkingEnabled, false);
      assert.equal((await readDiskModel(dir)).thinkingEnabled, false);
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
      assert.equal(calls.refreshLspSnapshot, 0);
    },
  );
});

test("updateConfigCommand stores absent=on by deleting the key when re-enabled", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        openAiProvider([{ name: "gpt-5.4", supportsThinkingSwitch: true, thinkingEnabled: false }]),
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "openai", name: "gpt-5.4" },
        apiBase: "https://api.openai.com/v1",
        thinkingEnabled: true,
      });

      assert.equal("thinkingEnabled" in config.providers[0].models[0], false);
      assert.equal("thinkingEnabled" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand rejects thinkingEnabled without a declared supportsThinkingSwitch", async () => {
  await withUpdateConfigFixture(
    {
      providers: [openAiProvider([{ name: "gpt-5.4" }])],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { providerId: "openai", name: "gpt-5.4" },
          apiBase: "https://api.openai.com/v1",
          thinkingEnabled: false,
        }),
        /declares no supportsThinkingSwitch/,
      );

      assert.equal("thinkingEnabled" in config.providers[0].models[0], false);
      assert.equal("thinkingEnabled" in (await readDiskModel(dir)), false);
      assert.equal(calls.refreshActiveModelTransportConfig, 0);
      assert.equal(calls.refreshRuntime, 0);
    },
  );
});

test("updateConfigCommand accepts thinkingEnabled when the provider entry declares the switch", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        {
          id: "meituan",
          apiBase: "https://api.longcat.chat/openai/v1",
          sdk: "@ai-sdk/openai-compatible",
          supportsThinkingSwitch: true,
          thinkingSwitch: {
            on: { body: { thinking: { type: "enabled" } } },
            off: { body: { thinking: { type: "disabled" } } },
          },
          models: [{ name: "longcat-2.5-preview" }],
        },
      ],
      activeModel: { providerId: "meituan", name: "longcat-2.5-preview" },
    },
    async ({ config, dir }) => {
      const { ctx } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "meituan", name: "longcat-2.5-preview" },
        apiBase: "https://api.longcat.chat/openai/v1",
        thinkingEnabled: false,
      });

      assert.equal(config.providers[0].models[0].thinkingEnabled, false);
      assert.equal((await readDiskModel(dir)).thinkingEnabled, false);
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
          providers: [openAiProvider([{ name: "gpt-5.4", reasoningEffort: "medium" }])],
          activeModel: { providerId: "openai", name: "gpt-5.4" },
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
  modelRef: { providerId: "openai", name: "gpt-5.4" },
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
      modelRef: { providerId: "openai", name: "gpt-5.4" },
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
      providers: [],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
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

test("updateConfigCommand stores output effort and explicit thinking preferences without legacy keys", async () => {
  await withUpdateConfigFixture(
    {
      providers: [
        anthropicProvider([
          {
            name: "claude-opus-4.5",
            effortSemantics: "output",
            supportedEfforts: ["low", "medium", "high"],
            defaultEffort: "high",
            supportsThinkingSwitch: true,
            thinkingSwitch: { defaultState: "off", off: "omit" },
          },
        ]),
      ],
      activeModel: { providerId: "anthropic", name: "claude-opus-4.5" },
    },
    async ({ config, dir }) => {
      const { ctx, calls } = createUpdateConfigContext({ config });
      await updateConfigCommand(ctx, {
        activeModel: { providerId: "anthropic", name: "claude-opus-4.5" },
        apiBase: "https://api.anthropic.com",
        effort: "high",
        thinkingEnabled: true,
      });

      let model = config.providers[0].models[0];
      assert.equal(model.effort, "high");
      assert.equal(model.thinkingEnabled, true);
      assert.equal("reasoningEffort" in model, false);
      assert.equal(calls.refreshActiveModelTransportConfig, 1);
      assert.equal((await readDiskModel(dir)).effort, "high");
      assert.equal((await readDiskModel(dir)).thinkingEnabled, true);

      await updateConfigCommand(ctx, {
        activeModel: { providerId: "anthropic", name: "claude-opus-4.5" },
        apiBase: "https://api.anthropic.com",
        effort: "default",
        thinkingEnabled: false,
      });
      model = config.providers[0].models[0];
      assert.equal("effort" in model, false);
      assert.equal(model.thinkingEnabled, false);

      await assert.rejects(
        updateConfigCommand(ctx, {
          activeModel: { providerId: "anthropic", name: "claude-opus-4.5" },
          apiBase: "https://api.anthropic.com",
          reasoningEffort: "high",
        }),
        /uses effort, not reasoningEffort/,
      );
      assert.equal("reasoningEffort" in model, false);
    },
  );
});
