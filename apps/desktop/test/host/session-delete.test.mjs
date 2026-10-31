import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { SessionRegistry } from "../../dist-electron/src/host/session-registry.js";
import { removeEphemeralSessionRecord } from "../../dist-electron/src/host/sessions.js";
import { chatsDirPath, deleteStoredSession } from "../../dist-electron/src/host/storage.js";

test("SessionRegistry.removeBySessionPath evicts a loaded non-active bundle", () => {
  const registry = new SessionRegistry();
  const workspaceRoot = "D:/Spirit/repo";
  const first = registry.beginNewActive(workspaceRoot);
  first.messages.push({ id: 1, role: "user", content: "hello", pending: false });
  const sessionPath = path.resolve("D:/Spirit/chats/chat-delete-me.json");
  first.activeSession = {
    filePath: sessionPath,
    displayName: "chat-delete-me",
    kind: "stored",
  };
  registry.rekeyBundle(first, sessionPath);

  registry.beginNewActive(workspaceRoot);
  assert.equal(registry.findBySessionPath(sessionPath), first);

  registry.removeBySessionPath(sessionPath);
  assert.equal(registry.findBySessionPath(sessionPath), undefined);
  assert.notEqual(registry.activeSessionId(), sessionPath);
});

test("removeEphemeralSessionRecord drops matching ephemeral session", () => {
  const sessions = [
    {
      path: "ephemeral://commit-message/1",
      displayName: "Commit draft",
      workspaceRoot: "D:/Spirit/repo",
      modifiedAtUnixMs: 1,
      messages: [],
      llmHistory: [],
      readOnly: true,
    },
  ];
  const next = removeEphemeralSessionRecord(sessions, "ephemeral://commit-message/1");
  assert.equal(next.length, 0);
});

test("deleteStoredSession rejects paths outside chats directory", async () => {
  await assert.rejects(
    () => deleteStoredSession(path.join(os.tmpdir(), "outside-session.json")),
    /Invalid session path|无效的会话路径/,
  );
});

test("deleteStoredSession removes a stored session file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-session-delete-"));
  const originalDataDir = process.env.SPIRIT_DATA_DIR;
  process.env.SPIRIT_DATA_DIR = tempRoot;
  try {
    const chatsDir = chatsDirPath();
    await mkdir(chatsDir, { recursive: true });
    const sessionPath = path.join(chatsDir, "chat-delete-file.json");
    await writeFile(sessionPath, "{}\n", "utf8");

    await deleteStoredSession(sessionPath);

    await assert.rejects(() => access(sessionPath));
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.SPIRIT_DATA_DIR;
    } else {
      process.env.SPIRIT_DATA_DIR = originalDataDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
