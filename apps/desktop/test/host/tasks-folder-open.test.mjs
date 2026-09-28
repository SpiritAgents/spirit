import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  clearWorkspaceCapabilityTrustSessionForTests,
  loadTaskFiles,
  computeWorkspaceTasksContentHash,
  persistPermanentWorkspaceCapabilityTrust,
} from "@spiritagent/host-internal";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

async function withService(run) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spirit-tasks-fopen-ws-"));
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-tasks-fopen-data-"));
  setSpiritDataDirOverride(spiritDataDir);
  clearWorkspaceCapabilityTrustSessionForTests();
  const { DesktopHostService } = await import("../../dist-electron/src/host/service.js");
  const service = new DesktopHostService();
  service["state"] = { workspaceRoot };
  try {
    await run({ service, workspaceRoot, spiritDataDir });
  } finally {
    setSpiritDataDirOverride(undefined);
    clearWorkspaceCapabilityTrustSessionForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

async function writeSpiritTasks(workspaceRoot, tasks) {
  const filePath = path.join(workspaceRoot, ".spirit", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ schemaVersion: 1, tasks }), "utf8");
}

const FOLDER_OPEN_TASK = {
  label: "on-open",
  command: "echo open",
  runOptions: { runOn: "folderOpen" },
};

async function flushPromptQueue() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function trustPermanently(workspaceRoot, spiritDataDir) {
  const files = await loadTaskFiles({ workspaceRoot, spiritDataDir });
  await persistPermanentWorkspaceCapabilityTrust(
    spiritDataDir,
    "tasks",
    workspaceRoot,
    computeWorkspaceTasksContentHash(files),
  );
}

test("trusted activation arms folderOpen tasks and consumption clears them", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot, [
      FOLDER_OPEN_TASK,
      { label: "manual", command: "echo manual" },
      { label: "on-worktree", command: "echo wt", runOptions: { runOn: "worktreeCreated" } },
    ]);
    await trustPermanently(workspaceRoot, spiritDataDir);

    await service["evaluateWorkspaceTasksTrust"]("adopt");
    assert.equal(service["pendingWorkspaceCapabilityTrust"], undefined);
    const key = `${path.join(workspaceRoot, ".spirit", "tasks.json")}#on-open`;
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), [key]);
    // Consumption clears: a second pull returns nothing.
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);
  });
});

test("untrusted workspace arms nothing until the prompt is allowed (deferred folder-open)", async () => {
  await withService(async ({ service, workspaceRoot }) => {
    await writeSpiritTasks(workspaceRoot, [FOLDER_OPEN_TASK]);

    await service["evaluateWorkspaceTasksTrust"]("adopt");
    await flushPromptQueue();
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);
    const pending = service["pendingWorkspaceCapabilityTrust"];
    assert.ok(pending);
    assert.equal(pending.tasks.items.length, 1);

    await service["applyTasksCapabilityTrustDecision"](
      { workspaceRoot, contentHash: pending.tasks.contentHash },
      "allowOnce",
    );
    const keys = await service.consumeFolderOpenTaskTriggers();
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith("#on-open"));
  });
});

test("deny never arms, including after refresh cycles", async () => {
  await withService(async ({ service, workspaceRoot }) => {
    await writeSpiritTasks(workspaceRoot, [FOLDER_OPEN_TASK]);
    await service["evaluateWorkspaceTasksTrust"]("adopt");
    await flushPromptQueue();
    const pending = service["pendingWorkspaceCapabilityTrust"];
    assert.ok(pending);
    await service["applyTasksCapabilityTrustDecision"](
      { workspaceRoot, contentHash: pending.tasks.contentHash },
      "deny",
    );
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);

    await service.refreshTasksFromDisk();
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);
  });
});

test("watcher refreshes never re-arm, and same-root re-adopt does not double-fire", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot, [FOLDER_OPEN_TASK]);
    await trustPermanently(workspaceRoot, spiritDataDir);

    await service["evaluateWorkspaceTasksTrust"]("adopt");
    assert.equal((await service.consumeFolderOpenTaskTriggers()).length, 1);

    // Watcher-driven refresh after the round is consumed: no re-arm.
    await service.refreshTasksFromDisk();
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);

    // Editing tasks.json then refreshing still re-arms nothing.
    await writeSpiritTasks(workspaceRoot, [{ ...FOLDER_OPEN_TASK, command: "echo edited" }]);
    await service.refreshTasksFromDisk();
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);

    // Re-adopting the same root within the stay does not re-arm.
    await service["evaluateWorkspaceTasksTrust"]("adopt");
    assert.deepEqual(await service.consumeFolderOpenTaskTriggers(), []);
  });
});

test("adopting a different root starts a new round", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot, [FOLDER_OPEN_TASK]);
    await trustPermanently(workspaceRoot, spiritDataDir);
    await service["evaluateWorkspaceTasksTrust"]("adopt");
    assert.equal((await service.consumeFolderOpenTaskTriggers()).length, 1);

    const otherRoot = await mkdtemp(path.join(tmpdir(), "spirit-tasks-fopen-other-"));
    try {
      await writeSpiritTasks(otherRoot, [FOLDER_OPEN_TASK]);
      await persistPermanentWorkspaceCapabilityTrust(
        spiritDataDir,
        "tasks",
        otherRoot,
        computeWorkspaceTasksContentHash(
          await loadTaskFiles({ workspaceRoot: otherRoot, spiritDataDir }),
        ),
      );
      service["state"] = { workspaceRoot: otherRoot };
      await service["evaluateWorkspaceTasksTrust"]("adopt");
      assert.equal((await service.consumeFolderOpenTaskTriggers()).length, 1);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});

test("user-level folderOpen tasks arm without any workspace file", async () => {
  await withService(async ({ service, spiritDataDir }) => {
    await writeFile(
      path.join(spiritDataDir, "tasks.json"),
      JSON.stringify({ schemaVersion: 1, tasks: [FOLDER_OPEN_TASK] }),
      "utf8",
    );
    await service["evaluateWorkspaceTasksTrust"]("adopt");
    const keys = await service.consumeFolderOpenTaskTriggers();
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith("#on-open"));
    assert.ok(keys[0].startsWith(path.join(spiritDataDir, "tasks.json")));
  });
});
