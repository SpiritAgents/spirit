import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { DesktopMessageTimeline } from "../../dist-electron/src/host/message-timeline.js";
import { setSessionPinnedCommand } from "../../dist-electron/src/host/session-pin.js";
import { persistDesktopSessionBundle } from "../../dist-electron/src/host/session-persistence.js";
import { SessionRegistry } from "../../dist-electron/src/host/session-registry.js";
import {
  chatsDirPath,
  listStoredSessions,
  loadStoredSession,
  saveStoredSession,
} from "../../dist-electron/src/host/storage.js";
import { buildV2StoredSession } from "./chat-schema-fixture.mjs";

function createPinContext(registry, notifications) {
  return {
    runSerialized: async (work) => work(),
    ensureInitialized: async () => {},
    sessionRegistry: () => registry,
    persistSessionBundle: async (bundle, options) => {
      await persistDesktopSessionBundle({
        bundle,
        workspaceRoot: bundle.workspaceRoot,
        fromRuntime: options?.fromRuntime,
        bumpListSortAt: options?.bumpListSortAt,
      });
    },
    notifySessionListUpdated: () => {
      notifications.listUpdated += 1;
    },
    emitLiveSnapshotUpdate: () => {
      notifications.liveSnapshot += 1;
    },
    setLastRuntimeError: () => {},
    buildSnapshot: () => ({}),
  };
}

async function withTempChatsDir(run) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-session-pin-"));
  const originalAppData = process.env.APPDATA;
  process.env.APPDATA = tempRoot;
  try {
    const chatsDir = chatsDirPath();
    await mkdir(chatsDir, { recursive: true });
    await run(chatsDir);
  } finally {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("setSessionPinnedCommand pins and unpins a stored session file", async () => {
  await withTempChatsDir(async (chatsDir) => {
    const sessionPath = path.join(chatsDir, "chat-pin-stored.json");
    await saveStoredSession(
      sessionPath,
      buildV2StoredSession({ sessionDisplayName: "stored chat" }),
    );
    const registry = new SessionRegistry();
    const notifications = { listUpdated: 0, liveSnapshot: 0 };
    const ctx = createPinContext(registry, notifications);

    await setSessionPinnedCommand(ctx, sessionPath, true);

    const pinned = await loadStoredSession(sessionPath);
    assert.equal(typeof pinned.pinnedAtUnixMs, "number");
    assert.ok(pinned.pinnedAtUnixMs > 0);
    const rawPinned = JSON.parse(await readFile(sessionPath, "utf8"));
    assert.equal(rawPinned.pinnedAtUnixMs, pinned.pinnedAtUnixMs);
    assert.equal(notifications.listUpdated, 1);
    assert.equal(notifications.liveSnapshot, 0);

    const listed = await listStoredSessions();
    const item = listed.find((entry) => entry.path === sessionPath);
    assert.equal(item?.pinnedAtUnixMs, pinned.pinnedAtUnixMs);

    await setSessionPinnedCommand(ctx, sessionPath, false);

    const unpinned = await loadStoredSession(sessionPath);
    assert.equal("pinnedAtUnixMs" in unpinned, false);
    const rawUnpinned = JSON.parse(await readFile(sessionPath, "utf8"));
    assert.equal("pinnedAtUnixMs" in rawUnpinned, false);
    const listedAfter = await listStoredSessions();
    const itemAfter = listedAfter.find((entry) => entry.path === sessionPath);
    assert.ok(itemAfter);
    assert.equal("pinnedAtUnixMs" in itemAfter, false);
    assert.equal(notifications.listUpdated, 2);
    assert.equal(notifications.liveSnapshot, 0);
  });
});

test("setSessionPinnedCommand pins the live session bundle and persists the field", async () => {
  await withTempChatsDir(async (chatsDir) => {
    const workspaceRoot = path.join(chatsDir, "workspace");
    const registry = new SessionRegistry();
    const bundle = registry.beginNewActive(workspaceRoot);
    const sessionPath = path.join(chatsDir, "chat-pin-live.json");
    let nextMessageId = 1;
    const timeline = new DesktopMessageTimeline({
      allocateMessageId: () => nextMessageId++,
    });
    timeline.beginUserTurn("hello from live bundle");
    bundle.messageTimeline = timeline;
    bundle.messages = timeline.toMessages();
    bundle.activeSession = {
      filePath: sessionPath,
      displayName: "live chat",
      kind: "stored",
    };
    registry.rekeyBundle(bundle, sessionPath);

    const notifications = { listUpdated: 0, liveSnapshot: 0 };
    const ctx = createPinContext(registry, notifications);

    await setSessionPinnedCommand(ctx, sessionPath, true);

    assert.equal(typeof bundle.pinnedAtUnixMs, "number");
    assert.ok(bundle.pinnedAtUnixMs > 0);
    const persisted = await loadStoredSession(sessionPath);
    assert.equal(persisted.pinnedAtUnixMs, bundle.pinnedAtUnixMs);
    assert.equal(notifications.liveSnapshot, 1);
    assert.equal(notifications.listUpdated, 0);

    const listed = await listStoredSessions();
    const item = listed.find((entry) => entry.path === sessionPath);
    assert.equal(item?.pinnedAtUnixMs, bundle.pinnedAtUnixMs);

    await setSessionPinnedCommand(ctx, sessionPath, false);

    assert.equal(bundle.pinnedAtUnixMs, undefined);
    const persistedAfter = await loadStoredSession(sessionPath);
    assert.equal("pinnedAtUnixMs" in persistedAfter, false);
    assert.equal(notifications.liveSnapshot, 2);
    assert.equal(notifications.listUpdated, 0);
  });
});

test("setSessionPinnedCommand rejects an empty session path", async () => {
  const registry = new SessionRegistry();
  const notifications = { listUpdated: 0, liveSnapshot: 0 };
  const ctx = createPinContext(registry, notifications);

  await assert.rejects(
    () => setSessionPinnedCommand(ctx, "   ", true),
    /Invalid session path|无效的会话路径/,
  );
});
