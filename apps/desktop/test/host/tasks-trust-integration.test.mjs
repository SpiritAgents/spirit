import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  canonicalizeWorkspaceRoot,
  clearWorkspaceCapabilityTrustSessionForTests,
  loadWorkspaceCapabilityTrustStore,
} from "@spiritagent/host-internal";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

// The trust integration drives a real DesktopHostService with a hand-set workspaceRoot;
// the override must land before the service module is imported (its singleton captures
// spiritDataDir at construction), hence the dynamic import inside the helper.
async function withService(run) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spirit-tasks-chain-ws-"));
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-tasks-chain-data-"));
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

async function writeSpiritTasks(workspaceRoot, command) {
  const filePath = path.join(workspaceRoot, ".spirit", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 1, tasks: [{ label: "ws-task", command }] }),
    "utf8",
  );
}

async function flushPromptQueue() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("full chain: edit -> gate re-evaluates -> prompt enqueued -> allow -> menu push", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    const pushed = [];
    service.subscribeTasksUpdates((items) => pushed.push(items));
    await writeSpiritTasks(workspaceRoot, "make");

    await service.refreshTasksFromDisk();
    await flushPromptQueue();
    // Gated: the pushed menu is empty and a prompt is pending with the task listed.
    assert.deepEqual(pushed.at(-1), []);
    const pending = service["pendingWorkspaceCapabilityTrust"];
    assert.ok(pending);
    assert.equal(pending.hooks.length, 0);
    assert.equal(pending.tasks.items.length, 1);
    assert.equal(pending.tasks.items[0].label, "ws-task");

    await service["applyTasksCapabilityTrustDecision"](
      { workspaceRoot, contentHash: pending.tasks.contentHash },
      "alwaysTrust",
    );
    assert.deepEqual(
      pushed.at(-1).map((item) => item.label),
      ["ws-task"],
    );

    const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
    assert.deepEqual(
      store.tasks?.map((entry) => entry.contentHash),
      [pending.tasks.contentHash],
    );
  });
});

test("deny chain: no re-prompt for the same hash, re-prompt after edit, allow reveals", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    const pushed = [];
    service.subscribeTasksUpdates((items) => pushed.push(items));
    await writeSpiritTasks(workspaceRoot, "make");

    await service.refreshTasksFromDisk();
    await flushPromptQueue();
    const pending = service["pendingWorkspaceCapabilityTrust"];
    assert.ok(pending);

    // Answer through the queue exactly like replyWorkspaceCapabilityTrust does, then drop
    // the pending request (that clearing lives in the reply command).
    await service["tasksTrustPromptQueue"].handleReply("deny");
    service["pendingWorkspaceCapabilityTrust"] = undefined;
    assert.deepEqual(pushed.at(-1), []);
    assert.deepEqual((await loadWorkspaceCapabilityTrustStore(spiritDataDir)).tasks, []);

    // Same content: the deny hash is remembered and no new prompt is enqueued.
    await service.refreshTasksFromDisk();
    await flushPromptQueue();
    assert.equal(service["pendingWorkspaceCapabilityTrust"], undefined);

    // Content change: the gate re-prompts.
    await writeSpiritTasks(workspaceRoot, "make all");
    await service.refreshTasksFromDisk();
    await flushPromptQueue();
    const reprompt = service["pendingWorkspaceCapabilityTrust"];
    assert.ok(reprompt);
    assert.notEqual(reprompt.tasks.contentHash, pending.tasks.contentHash);

    await service["tasksTrustPromptQueue"].handleReply("allowOnce");
    service["pendingWorkspaceCapabilityTrust"] = undefined;
    assert.deepEqual(
      pushed.at(-1).map((item) => item.label),
      ["ws-task"],
    );
    // allowOnce persists nothing.
    assert.deepEqual((await loadWorkspaceCapabilityTrustStore(spiritDataDir)).tasks, []);
  });
});

test("merged prompt: one reply applies the tasks decision while the hooks section stays", async () => {
  await withService(async ({ service, workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot, "make");
    const root = canonicalizeWorkspaceRoot(workspaceRoot);

    // A hooks prompt for the same root is already open.
    service["pendingWorkspaceCapabilityTrust"] = {
      workspaceRoot: root,
      contentHash: "hooks-hash",
      hashChanged: false,
      hooks: [
        {
          event: "sessionStart",
          command: "hooks/x.sh",
          resolvedPath: path.join(workspaceRoot, ".spirit", "hooks", "x.sh"),
        },
      ],
    };

    await service["evaluateWorkspaceTasksTrust"]("test");
    const pending = service["pendingWorkspaceCapabilityTrust"];
    assert.equal(pending.hooks.length, 1);
    assert.equal(pending.tasks.items.length, 1);
    assert.equal(pending.tasks.items[0].label, "ws-task");

    await service["tasksTrustPromptQueue"].handleReply("alwaysTrust");
    const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
    assert.deepEqual(
      store.tasks?.map((entry) => entry.contentHash),
      [pending.tasks.contentHash],
    );
    // The hooks record is not desktop's to write here (the remote runtime owns it); the
    // store keeps it untouched and empty.
    assert.deepEqual(store.hooks, []);
  });
});
