import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  createTaskRunResolver,
  listTaskMenuItemsCommand,
} from "../../dist-electron/src/host/host-tasks-commands.js";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

async function withTaskDirs(run) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-tasks-cmd-ws-"));
  const spiritDataDir = await mkdtemp(path.join(os.tmpdir(), "spirit-tasks-cmd-data-"));
  setSpiritDataDirOverride(spiritDataDir);
  try {
    await run({ workspaceRoot, spiritDataDir });
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

async function writeSpiritTasks(workspaceRoot, json) {
  const filePath = path.join(workspaceRoot, ".spirit", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ schemaVersion: 1, ...json }), "utf8");
  return filePath;
}

test("listTaskMenuItemsCommand projects the menu and omits hidden and hide-flagged tasks", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const tasksFile = await writeSpiritTasks(workspaceRoot, {
      tasks: [
        {
          label: "build",
          command: "make",
          detail: "Builds everything",
          icon: { id: "gear" },
        },
        { label: "with-var", command: "echo ${file}" },
        { label: "helper", command: "echo helper", hide: true },
        { label: "npm-task", type: "npm", script: "test" },
      ],
    });

    const items = await listTaskMenuItemsCommand({ workspaceRoot });
    assert.deepEqual(items, [
      {
        key: `${tasksFile}#build`,
        label: "build",
        detail: "Builds everything",
        iconId: "gear",
      },
    ]);
  });
});

test("resolveTaskForRun resolves hide-flagged tasks that stay out of the menu", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const tasksFile = await writeSpiritTasks(workspaceRoot, {
      tasks: [{ label: "helper", command: "echo helper", hide: true }],
    });
    const resolver = createTaskRunResolver();
    const result = await resolver.resolveTaskForRun({
      workspaceRoot,
      key: `${tasksFile}#helper`,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.task.label, "helper");
    assert.equal(result.task.hide, true);
    assert.equal(typeof result.defaultShell.executable, "string");
    assert.ok(result.defaultShell.executable.length > 0);
    assert.ok(Array.isArray(result.defaultShell.args));
    assert.ok(result.defaultShell.args.length > 0);
  });
});

test("resolveTaskForRun returns the fully substituted task spec", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const tasksFile = await writeSpiritTasks(workspaceRoot, {
      tasks: [
        {
          label: "vars",
          command: "${workspaceFolder}/tool.sh",
          args: ["--home", "${userHome}"],
        },
      ],
    });
    const resolver = createTaskRunResolver();
    const result = await resolver.resolveTaskForRun({
      workspaceRoot,
      key: `${tasksFile}#vars`,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.task.command, `${workspaceRoot}/tool.sh`);
    assert.deepEqual(result.task.args, ["--home", os.homedir()]);
  });
});

test("resolveTaskForRun caches the first resolution when reevaluateOnRerun is false", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const tasksFile = await writeSpiritTasks(workspaceRoot, {
      tasks: [
        {
          label: "cached",
          command: "echo one",
          runOptions: { reevaluateOnRerun: false },
        },
      ],
    });
    const resolver = createTaskRunResolver();
    const key = `${tasksFile}#cached`;
    const first = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(first.status, "ok");
    assert.equal(first.task.command, "echo one");

    await writeSpiritTasks(workspaceRoot, {
      tasks: [
        {
          label: "cached",
          command: "echo two",
          runOptions: { reevaluateOnRerun: false },
        },
      ],
    });
    const second = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(second.status, "ok");
    assert.equal(second.task.command, "echo one");
  });
});

test("resolveTaskForRun picks up file changes when reevaluateOnRerun is true", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const tasksFile = await writeSpiritTasks(workspaceRoot, {
      tasks: [{ label: "fresh", command: "echo one" }],
    });
    const resolver = createTaskRunResolver();
    const key = `${tasksFile}#fresh`;
    const first = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(first.status, "ok");
    assert.equal(first.task.command, "echo one");

    await writeSpiritTasks(workspaceRoot, {
      tasks: [{ label: "fresh", command: "echo two" }],
    });
    const second = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(second.status, "ok");
    assert.equal(second.task.command, "echo two");
  });
});

test("resolveTaskForRun reports notFound for unknown keys", async () => {
  await withTaskDirs(async ({ workspaceRoot }) => {
    const resolver = createTaskRunResolver();
    const result = await resolver.resolveTaskForRun({
      workspaceRoot,
      key: `${workspaceRoot}/.spirit/tasks.json#ghost`,
    });
    assert.deepEqual(result, { status: "notFound" });
  });
});
