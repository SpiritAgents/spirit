import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { TasksWatcher } from "../../dist-electron/src/host/tasks-watcher.js";

const EMIT_TIMEOUT_MS = 5000;
const SETTLE_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEmit(counter, atLeast) {
  const deadline = Date.now() + EMIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (counter.count >= atLeast) {
      return;
    }
    await sleep(50);
  }
  assert.fail(`expected at least ${atLeast} task change emit(s), got ${counter.count}`);
}

async function withWatcher(run) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-tasks-watch-ws-"));
  const spiritDataDir = await mkdtemp(path.join(os.tmpdir(), "spirit-tasks-watch-data-"));
  const counter = { count: 0 };
  const watcher = new TasksWatcher(() => {
    counter.count += 1;
  });
  try {
    await run({ workspaceRoot, spiritDataDir, watcher, counter });
  } finally {
    watcher.close();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

async function writeSpiritTasks(workspaceRoot, label) {
  const filePath = path.join(workspaceRoot, ".spirit", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 1, tasks: [{ label, command: "echo hi" }] }),
    "utf8",
  );
  return filePath;
}

test("watcher emits one debounced change per write burst on the watched file", async () => {
  await withWatcher(async ({ workspaceRoot, spiritDataDir, watcher, counter }) => {
    const filePath = await writeSpiritTasks(workspaceRoot, "one");
    watcher.sync({ workspaceRoot, spiritDataDir });
    await sleep(SETTLE_MS);

    // Back-to-back writes land inside one debounce window: exactly one emit.
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, tasks: [] }), "utf8");
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, tasks: [] }), "utf8");
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, tasks: [] }), "utf8");

    await waitForEmit(counter, 1);
    await sleep(SETTLE_MS);
    assert.equal(counter.count, 1);
  });
});

test("watcher falls back to the parent directory and fires when the file appears", async () => {
  await withWatcher(async ({ workspaceRoot, spiritDataDir, watcher, counter }) => {
    watcher.sync({ workspaceRoot, spiritDataDir });
    await sleep(SETTLE_MS);

    await writeSpiritTasks(workspaceRoot, "created");
    await waitForEmit(counter, 1);
  });
});

test("watcher re-arms after the watched file is deleted", async () => {
  await withWatcher(async ({ workspaceRoot, spiritDataDir, watcher, counter }) => {
    const filePath = await writeSpiritTasks(workspaceRoot, "one");
    watcher.sync({ workspaceRoot, spiritDataDir });
    await sleep(SETTLE_MS);

    await rm(filePath);
    await waitForEmit(counter, 1);

    await writeSpiritTasks(workspaceRoot, "two");
    await waitForEmit(counter, 2);
  });
});

test("watcher reports rename away and rename back as changes", async () => {
  await withWatcher(async ({ workspaceRoot, spiritDataDir, watcher, counter }) => {
    const filePath = await writeSpiritTasks(workspaceRoot, "one");
    const renamedPath = `${filePath}.bak`;
    watcher.sync({ workspaceRoot, spiritDataDir });
    await sleep(SETTLE_MS);

    await rename(filePath, renamedPath);
    await waitForEmit(counter, 1);

    await rename(renamedPath, filePath);
    await waitForEmit(counter, 2);
  });
});

test("watcher stays silent for unrelated files in the watched parent directory", async () => {
  await withWatcher(async ({ workspaceRoot, spiritDataDir, watcher, counter }) => {
    watcher.sync({ workspaceRoot, spiritDataDir });
    await sleep(SETTLE_MS);

    await writeFile(path.join(workspaceRoot, "unrelated.txt"), "hello", "utf8");
    await writeFile(path.join(spiritDataDir, "unrelated.txt"), "hello", "utf8");
    await sleep(SETTLE_MS);
    assert.equal(counter.count, 0);
  });
});
