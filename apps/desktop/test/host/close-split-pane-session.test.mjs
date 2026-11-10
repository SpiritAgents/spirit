import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { closeSplitPaneSessionCommand } from "../../../../packages/sessions/dist/host/session-split.js";
import { SessionRegistry } from "../../../../packages/sessions/dist/host/session-registry.js";
import { restoreStoredSessionState } from "../../../../packages/sessions/dist/host/sessions.js";
import { splitPaneSessionPath } from "../../../../packages/sessions/dist/host/storage.js";
import { buildV2StoredSession } from "./chat-schema-fixture.mjs";

function createCloseSplitPaneContext(registry, visiblePaths) {
  let visible = [...visiblePaths];
  return {
    runSerialized: async (work) => work(),
    ensureInitialized: async () => {},
    requireState: () => ({ workspaceRoot: "D:/Spirit/repo" }),
    sessionRegistry: () => registry,
    buildSnapshot: () => {
      registry.requireActive();
      return { ok: true };
    },
    syncActiveRuntimePointer: () => {},
    visiblePaneSessionPaths: () => visible,
    setVisiblePaneSessionPaths: (paths) => {
      visible = [...paths];
    },
    resolveTodoSessionKeyForBundle: () => "todo-key",
  };
}

test("closeSplitPaneSessionCommand repoints active to remaining pane when closing empty split active session", async () => {
  const registry = new SessionRegistry();
  const workspaceRoot = "D:/Spirit/repo";
  const splitPath = path.resolve(splitPaneSessionPath("pane-a"));
  const chatPath = path.resolve("D:/Spirit/chats/chat-1.json");

  const splitBundle = registry.beginSplitPaneSession(workspaceRoot, "pane-a");
  registry.activateExisting(splitBundle);

  const restored = restoreStoredSessionState({
    filePath: chatPath,
    loaded: buildV2StoredSession({ userContent: "hello" }),
  });
  const chatBundle = registry.upsertFromRestored(workspaceRoot, restored, (messages) => ({
    toMessages: () => messages,
    snapshot: () => [],
  }));
  registry.activateExisting(splitBundle);

  const ctx = createCloseSplitPaneContext(registry, [splitPath, chatPath]);
  const snapshot = await closeSplitPaneSessionCommand(ctx, { sessionPath: splitPath });

  assert.deepEqual(snapshot, { ok: true });
  assert.equal(registry.getActive(), chatBundle);
  assert.equal(registry.findBySessionPath(splitPath), undefined);
  assert.deepEqual(ctx.visiblePaneSessionPaths(), [chatPath]);
});
