import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { WorkspacePtyManager } from "../../dist-electron/electron/workspace-pty.js";

function createFakeWebContents() {
  const sent = [];
  return {
    id: Math.floor(Math.random() * 1_000_000_000),
    sent,
    isDestroyed: () => false,
    send: (channel, payload) => {
      sent.push({ channel, payload });
    },
  };
}

function waitForExitPayload(webContents, id, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const hit = webContents.sent.find(
        (entry) => entry.channel === "desktop:pty-exit" && entry.payload.id === id,
      );
      if (hit) {
        resolve(hit.payload);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for pty exit of ${id}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

async function withTempCwd(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "spirit-pty-spawn-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("createSession passes file/args through to spawn and reports the exit code", async () => {
  await withTempCwd(async (cwd) => {
    const manager = new WorkspacePtyManager();
    const webContents = createFakeWebContents();
    const created = manager.createSession(webContents, {
      cwd,
      cols: 80,
      rows: 24,
      file: process.execPath,
      args: ["-e", "process.exit(7)"],
    });
    assert.equal(created.ok, true);
    const exit = await waitForExitPayload(webContents, created.id);
    assert.equal(exit.exitCode, 7);
  });
});

test("createSession merges env without mutating process.env", async () => {
  await withTempCwd(async (cwd) => {
    const manager = new WorkspacePtyManager();
    const webContents = createFakeWebContents();
    delete process.env.SPIRIT_PTY_SPAWN_OPTIONS_TEST;
    const created = manager.createSession(webContents, {
      cwd,
      cols: 80,
      rows: 24,
      file: process.execPath,
      args: ["-e", "process.stdout.write(process.env.SPIRIT_PTY_SPAWN_OPTIONS_TEST ?? 'missing')"],
      env: { SPIRIT_PTY_SPAWN_OPTIONS_TEST: "present" },
    });
    assert.equal(created.ok, true);
    await waitForExitPayload(webContents, created.id);
    const data = webContents.sent
      .filter((entry) => entry.channel === "desktop:pty-data" && entry.payload.id === created.id)
      .map((entry) => entry.payload.data)
      .join("");
    assert.ok(data.includes("present"), `expected pty output to include merged env, got: ${data}`);
    assert.equal(process.env.SPIRIT_PTY_SPAWN_OPTIONS_TEST, undefined);
  });
});

test("createSession without spawn options keeps the default interactive shell behavior", async () => {
  await withTempCwd(async (cwd) => {
    const manager = new WorkspacePtyManager();
    const webContents = createFakeWebContents();
    const created = manager.createSession(webContents, { cwd, cols: 80, rows: 24 });
    assert.equal(created.ok, true);
    assert.ok(created.shellDisplayName.length > 0);
    await manager.kill(webContents, created.id);
    await waitForExitPayload(webContents, created.id);
  });
});

test("createSession rejects an empty file", async () => {
  await withTempCwd(async (cwd) => {
    const manager = new WorkspacePtyManager();
    const webContents = createFakeWebContents();
    for (const file of ["", "   "]) {
      const created = manager.createSession(webContents, { cwd, cols: 80, rows: 24, file });
      assert.equal(created.ok, false);
      assert.match(created.error, /file/);
    }
  });
});
