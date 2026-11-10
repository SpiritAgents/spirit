import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { openSessionCommand } from "../../../../packages/sessions/dist/host/session-activation.js";
import { splitPaneSessionPath } from "../../../../packages/sessions/dist/host/storage.js";

function createOpenSessionContext(overrides = {}) {
  const splitPath = splitPaneSessionPath("pane-a");
  const bundle = {
    id: splitPath,
    workspaceRoot: "D:\\Spirit",
    activeSession: { filePath: splitPath, displayName: "New session", kind: "provisional" },
    messageTimeline: { toMessages: () => [] },
    messages: [],
  };
  const registry = {
    getActive: () => undefined,
    findBySessionPath: (filePath) =>
      path.resolve(filePath) === path.resolve(splitPath) ? bundle : undefined,
    activateExisting: (target) => {
      registry.activated = target;
    },
    beginSplitPaneSession: () => bundle,
    activated: undefined,
    createdBundle: undefined,
  };

  const activationCtx = {
    clearSubagentViewerTarget: () => {},
    sessionRegistry: () => registry,
    ensureInitialized: async () => {},
    setLastRuntimeError: () => {},
    scheduleSessionExtensionWarmup: () => {},
    buildSnapshot: () => ({ ok: true }),
    runSerialized: async (work) => work(),
    syncHostWorkspaceRootToActiveBundle: async () => false,
    syncPlanStateForBundle: async () => {},
    syncHostActiveModelToActiveBundle: async () => {},
    resetStreamingPlacementState: () => {},
    ensureToolExecutor: async () => {},
    refreshTodoSnapshotForBundle: async () => {},
    refreshRuntimeForBundle: async () => {},
    flushDeferredRuntimeRefreshIfIdle: async () => {},
    syncActiveRuntimePointer: () => {},
    requireState: () => ({
      config: { activeModel: "test-model", models: [{ name: "test-model" }] },
      workspaceRoot: "D:\\Spirit",
    }),
    ...overrides,
  };

  return {
    splitPath,
    bundle,
    ctx: activationCtx,
    registry,
  };
}

test("openSessionCommand creates split provisional bundle when path is not on disk", async () => {
  const { splitPath, ctx, registry } = createOpenSessionContext();
  registry.findBySessionPath = () => undefined;
  registry.beginSplitPaneSession = (workspaceRoot, _paneId) => {
    const bundle = {
      id: splitPath,
      workspaceRoot,
      activeSession: { filePath: splitPath, displayName: "New session", kind: "provisional" },
      messageTimeline: { toMessages: () => [] },
      messages: [],
    };
    registry.createdBundle = bundle;
    return bundle;
  };

  const snapshot = await openSessionCommand(ctx, splitPath);

  assert.ok(registry.createdBundle);
  assert.equal(registry.activated, registry.createdBundle);
  assert.deepEqual(snapshot, { ok: true });
});

test("openSessionCommand activates in-memory split provisional sessions without reading disk", async () => {
  const { splitPath, bundle, ctx, registry } = createOpenSessionContext();

  const snapshot = await openSessionCommand(ctx, splitPath);

  assert.equal(registry.activated, bundle);
  assert.deepEqual(snapshot, { ok: true });
});
