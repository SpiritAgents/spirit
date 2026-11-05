import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { createEmptySessionBundle } from "../../dist-electron/src/host/session-bundle.js";
import { loadConfig, saveConfig, spiritDataDir } from "../../dist-electron/src/host/storage.js";
import { closeSharedDesktopServerClient } from "../../dist-electron/src/host/remote-runtime.js";
import { DesktopHostService } from "../../dist-electron/src/host/service.js";

const daemon = vi.hoisted(() => ({
  calls: [],
  listeners: new Set(),
  failure: undefined,
  archive: undefined,
}));

vi.mock("@spiritagent/server/client", () => ({
  connectOrSpawnServer: async () => ({
    client: {
      async call(method, params) {
        daemon.calls.push({ method, params });
        switch (method) {
          case "server.initialize":
          case "session.attach":
          case "session.setLoopEnabled":
          case "session.pushDesktopTimeline":
          case "session.submitUserTurn":
          case "session.detach":
            return { ok: true };
          case "session.create":
            if (daemon.failure) throw daemon.failure;
            return { sessionId: "test-session" };
          case "session.poll":
            return {
              snapshot: {
                pendingImagePaths: [],
                pendingMcpResources: [],
                hasPendingApproval: false,
                hasPendingManualApproval: false,
                hasPendingQuestions: false,
                childSessions: [],
                isBusy: false,
                loopEnabled: false,
                approvalLevel: "default",
              },
            };
          case "session.exportArchive":
            return structuredClone(daemon.archive);
          default:
            throw new Error(`Unexpected RPC: ${method}`);
        }
      },
      onNotification(listener) {
        daemon.listeners.add(listener);
        return () => daemon.listeners.delete(listener);
      },
      onDisconnect: () => () => {},
      close() {},
    },
  }),
}));

afterEach(async () => {
  await closeSharedDesktopServerClient();
  vi.restoreAllMocks();
  daemon.calls = [];
  daemon.listeners.clear();
  daemon.failure = undefined;
});

async function withHostService(run) {
  const config = await loadConfig();
  config.providers = [
    {
      id: "test-provider",
      apiBase: "https://models.example.invalid/v1",
      apiKey: "test-only-key",
      models: [
        {
          name: "test-model",
          supportedReasoningEfforts: ["low", "high"],
          reasoningEffort: "high",
        },
      ],
    },
  ];
  config.activeModel = { providerId: "test-provider", name: "test-model" };
  await saveConfig(config);
  const service = new DesktopHostService();
  const bundle = createEmptySessionBundle(spiritDataDir(), "test-bundle");
  service["state"] = {
    workspaceRoot: bundle.workspaceRoot,
    workspaceBinding: "project",
    config,
  };
  vi.spyOn(service["sessionRegistry"], "activeSessionId").mockReturnValue(bundle.id);
  service["syncPlanStateForBundle"] = async () => {};
  service["refreshTodoSnapshotForBundle"] = async () => {};
  daemon.archive = {
    messages: [],
    assistantAux: [],
    llmHistory: [],
    desktopMessageTimeline: [],
    presentation: { sequence: 0, entries: [] },
  };
  try {
    await run({ service, bundle, config });
  } finally {
    await bundle.runtime?.close();
    await service.shutdown();
  }
}

test("runtime refresh failures log the original error and context while preserving the UI error", async () => {
  await withHostService(async ({ service, bundle, config }) => {
    const error = new Error("Runtime initialization failed.");
    daemon.failure = error;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await service["refreshRuntimeForBundle"](bundle);

    assert.equal(log.mock.calls.length, 1);
    const [label, details] = log.mock.calls[0];
    assert.equal(label, "[desktop-host] runtime refresh failed");
    assert.equal(details.bundleId, bundle.id);
    assert.equal(details.workspaceRoot, bundle.workspaceRoot);
    assert.equal(details.inferencePreferenceOnly, false);
    assert.equal(details.error, error);
    assert.ok(details.error.stack.includes(error.message));
    assert.equal(JSON.stringify(details).includes(config.providers[0].apiKey), false);
    assert.equal(service["lastRuntimeError"], error.message);
    assert.equal(service["activeApiKeyConfigured"], false);
    assert.equal(service["runtime"], undefined);
    assert.equal(bundle.runtime, undefined);
  });
});
