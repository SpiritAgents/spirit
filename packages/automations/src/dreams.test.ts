import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { createHostDreamStore } from "./dreams.js";

test("dream store preserves records and source session progress", async () => {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-dream-store-"));
  try {
    const store = createHostDreamStore({
      spiritDataDir,
      scope: { workspaceRoot: "/fixture", gitBranch: "main" },
    });
    const record = await store.record({
      title: "Fixture",
      summary: "Preserve the existing persistence contract",
      sourceSession: { path: "/fixture/chat.json", displayName: "Chat" },
    });
    assert.equal((await store.read(record.id))?.title, "Fixture");

    await store.upsertSessionProgress({
      path: "/fixture/chat.json",
      lastProcessedSavedAtUnixMs: 10,
      lastProcessedMessageCount: 2,
      lastProcessedPrefixHash: "prefix",
      lastRunAtUnixMs: 20,
    });
    const reloaded = createHostDreamStore({
      spiritDataDir,
      scope: { workspaceRoot: "/fixture", gitBranch: "main" },
    });
    assert.deepEqual((await reloaded.read(record.id))?.sourceSessions, record.sourceSessions);
    assert.equal((await reloaded.readSessionProgress("/fixture/chat.json"))?.lastRunAtUnixMs, 20);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
