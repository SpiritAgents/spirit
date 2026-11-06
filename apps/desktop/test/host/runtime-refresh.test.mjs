import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

import { createEmptySessionBundle } from "../../dist-electron/src/host/session-bundle.js";
import {
  loadConfig,
  provisionalNewSessionPath,
  saveConfig,
  spiritDataDir,
} from "../../dist-electron/src/host/storage.js";
import { closeSharedDesktopServerClient } from "../../dist-electron/src/host/remote-runtime.js";
import { DesktopHostService } from "../../dist-electron/src/host/service.js";
import {
  ChatSessionSchemaError,
  hydrateTimelineSnapshotFromPersistence,
  timelinePersistedSnapshotToMessages,
  validateTimelineSnapshotV2,
} from "../../dist-electron/src/host/chat-schema.js";

const daemon = vi.hoisted(() => ({
  calls: [],
  listeners: new Set(),
  failure: undefined,
  archive: undefined,
  freshCreate: false,
}));

vi.mock("@spiritagent/server/client", () => ({
  connectOrSpawnServer: async () => ({
    client: {
      async call(method, params) {
        daemon.calls.push({ method, params });
        switch (method) {
          case "server.initialize":
          case "session.attach":
            if (params.conversationKey) {
              throw new Error("no live session for conversationKey");
            }
            return { ok: true };
          case "session.setLoopEnabled":
          case "session.pushDesktopTimeline":
          case "session.submitUserTurn":
          case "session.detach":
          case "session.replaceFromArchive":
          case "session.migrateConversationKey":
          case "session.runSessionEnd":
          case "session.runSessionStart":
            return { ok: true };
          case "session.create":
            if (daemon.failure) throw daemon.failure;
            if (daemon.freshCreate && !params.conversationKey) {
              daemon.archive = { ...daemon.archive, desktopMessageTimeline: [] };
            }
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
  daemon.freshCreate = false;
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
  vi.spyOn(service["sessionRegistry"], "getActive").mockReturnValue(bundle);
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

function timelineWithUser(text) {
  return [
    {
      turnId: 1,
      createdOrder: 0,
      userRow: {
        rowId: "user-1",
        messageId: 1,
        turnId: 1,
        kind: "user",
        createdOrder: 0,
        content: text,
        pending: false,
      },
      segments: [],
    },
  ];
}

function setLocalTimeline(service, bundle, timeline) {
  bundle.messages = timelinePersistedSnapshotToMessages(timeline);
  bundle.messageTimeline = service["createMessageTimelineFromMessages"](
    bundle.messages,
    hydrateTimelineSnapshotFromPersistence(timeline),
  );
  bundle.messageIdCounter = 2;
}

test("a fresh empty daemon timeline initializes the runtime and permits the first user turn", async () => {
  await withHostService(async ({ service, bundle, config }) => {
    await service["refreshRuntimeForBundle"](bundle);

    assert.equal(service["lastRuntimeError"], "");
    assert.ok(bundle.runtime);
    assert.equal(service["requireRuntime"](), bundle.runtime);
    assert.equal(service["activeApiKeyConfigured"], true);
    assert.equal(config.providers[0].models[0].reasoningEffort, "high");
    assert.deepEqual(bundle.messageTimeline.toMessages(), []);
    await bundle.runtime.startUserTurnStreaming("First request.");
    const submitted = daemon.calls.find((call) => call.method === "session.submitUserTurn");
    assert.equal(submitted.params.text, "First request.");
    assert.equal(submitted.params.sessionId, "test-session");
  });
});

test("an empty foreground draft creates a fresh runtime instead of restoring its provisional key", async () => {
  await withHostService(async ({ service, bundle }) => {
    const provisionalPath = provisionalNewSessionPath(bundle.workspaceRoot);
    bundle.id = provisionalPath;
    bundle.activeSession = {
      filePath: provisionalPath,
      displayName: "New conversation",
      kind: "stored",
    };
    daemon.archive.desktopMessageTimeline = timelineWithUser("Old transcript");
    daemon.freshCreate = true;

    await service["refreshRuntimeForBundle"](bundle);

    const created = daemon.calls.find((call) => call.method === "session.create");
    assert.equal(created.params.conversationKey, undefined);
    assert.deepEqual(bundle.messageTimeline.toMessages(), []);

    service["promoteProvisionalSessionIfNeeded"]("First request", bundle);
    const promotedPath = bundle.activeSession.filePath;
    assert.notEqual(promotedPath, provisionalPath);
    assert.equal(service["sessionRegistry"].findBySessionPath(promotedPath), bundle);
    assert.equal(
      daemon.calls.find((call) => call.method === "session.migrateConversationKey").params
        .conversationKey,
      path.resolve(promotedPath),
    );

    await service.submitUserTurn({ text: "First request", sessionPath: promotedPath });
    assert.equal(
      daemon.calls.find((call) => call.method === "session.submitUserTurn").params.sessionId,
      "test-session",
    );
  });
});

test("an empty authoritative baseline clears stale local rows before replaying offline entries", async () => {
  await withHostService(async ({ service, bundle }) => {
    setLocalTimeline(service, bundle, timelineWithUser("Stale local message."));
    daemon.archive.presentation = {
      sequence: 4,
      entries: [
        { sequence: 1, kind: "user", text: "Offline request." },
        { sequence: 2, kind: "runtime", event: { kind: "begin-assistant-response" } },
        {
          sequence: 3,
          kind: "runtime",
          event: { kind: "assistant-chunk", text: "Offline response." },
        },
        { sequence: 4, kind: "runtime", event: { kind: "assistant-response-completed" } },
      ],
    };

    await service["refreshRuntimeForBundle"](bundle);

    assert.equal(service["lastRuntimeError"], "");
    assert.ok(bundle.runtime);
    assert.deepEqual(
      bundle.messageTimeline.toMessages().map((message) => message.content),
      ["Offline request.", "Offline response."],
    );
    assert.equal(
      daemon.calls.findLast((call) => call.method === "session.pushDesktopTimeline").params
        .presentationSequence,
      4,
    );
  });
});

test("an empty reset baseline clears the prior conversation and resets message numbering", async () => {
  await withHostService(async ({ service, bundle }) => {
    setLocalTimeline(service, bundle, timelineWithUser("Prior conversation."));

    await service["refreshRuntimeForBundle"](bundle);

    assert.equal(service["lastRuntimeError"], "");
    assert.ok(bundle.runtime);
    assert.deepEqual(bundle.messages, []);
    assert.deepEqual(bundle.messageTimeline.snapshot(), []);
    assert.equal(bundle.messageIdCounter, 1);
  });
});

test("a valid non-empty daemon baseline retains its persisted conversation", async () => {
  await withHostService(async ({ service, bundle }) => {
    daemon.archive.desktopMessageTimeline = timelineWithUser("Saved conversation.");

    await service["refreshRuntimeForBundle"](bundle);

    assert.equal(service["lastRuntimeError"], "");
    assert.ok(bundle.runtime);
    assert.deepEqual(
      bundle.messageTimeline.toMessages().map((message) => message.content),
      ["Saved conversation."],
    );
  });
});

test("invalid non-empty daemon timelines remain errors and detach the failed runtime", async () => {
  await withHostService(async ({ service, bundle }) => {
    daemon.archive.desktopMessageTimeline = timelineWithUser("");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await service["refreshRuntimeForBundle"](bundle);

    assert.match(service["lastRuntimeError"], /user rows require content/);
    assert.equal(log.mock.calls.length, 1);
    assert.ok(log.mock.calls[0][1].error instanceof ChatSessionSchemaError);
    assert.equal(bundle.runtime, undefined);
    assert.equal(daemon.listeners.size, 0);
    assert.equal(daemon.calls.filter((call) => call.method === "session.detach").length, 1);
  });
});

test("saved chat timelines still reject an empty conversation", () => {
  assert.throws(() => validateTimelineSnapshotV2([]), /non-empty array/);
});
