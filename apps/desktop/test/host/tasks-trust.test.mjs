import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  applyWorkspaceTasksTrustDecision,
  clearWorkspaceCapabilityTrustSessionForTests,
  loadWorkspaceCapabilityTrustStore,
} from "@spiritagent/host-internal";
import {
  createTaskRunResolver,
  evaluateAndFilterTaskFiles,
  listTaskMenuItemsCommand,
} from "../../dist-electron/src/host/host-tasks-commands.js";
import { setSpiritDataDirOverride } from "../../dist-electron/src/host/storage.js";

async function withDirs(run) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "spirit-tasks-trust-ws-"));
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-tasks-trust-data-"));
  setSpiritDataDirOverride(spiritDataDir);
  clearWorkspaceCapabilityTrustSessionForTests();
  try {
    await run({ workspaceRoot, spiritDataDir });
  } finally {
    setSpiritDataDirOverride(undefined);
    clearWorkspaceCapabilityTrustSessionForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
}

async function writeSpiritTasks(workspaceRoot, command = "make") {
  const filePath = path.join(workspaceRoot, ".spirit", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ schemaVersion: 1, tasks: [{ label: "ws-task", command }] }),
    "utf8",
  );
}

async function writeVscodeTasks(workspaceRoot) {
  const filePath = path.join(workspaceRoot, ".vscode", "tasks.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ version: "2.0.0", tasks: [{ label: "vs-task", command: "make" }] }),
    "utf8",
  );
}

async function writeUserTasks(spiritDataDir) {
  await writeFile(
    path.join(spiritDataDir, "tasks.json"),
    JSON.stringify({ schemaVersion: 1, tasks: [{ label: "user-task", command: "make" }] }),
    "utf8",
  );
}

test("untrusted workspace files drop out of loading while user tasks pass", async () => {
  await withDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot);
    await writeVscodeTasks(workspaceRoot);
    await writeUserTasks(spiritDataDir);

    const { files, gate } = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(gate.status, "needsPrompt");
    assert.deepEqual(
      files.map((file) => file.sourceKind),
      ["user"],
    );

    const items = await listTaskMenuItemsCommand({ workspaceRoot });
    assert.deepEqual(
      items.map((item) => item.label),
      ["user-task"],
    );
  });
});

test("a vscode-only workspace is gated too", async () => {
  await withDirs(async ({ workspaceRoot }) => {
    await writeVscodeTasks(workspaceRoot);

    const { files, gate } = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(gate.status, "needsPrompt");
    assert.deepEqual(files, []);
    assert.deepEqual(await listTaskMenuItemsCommand({ workspaceRoot }), []);
  });
});

test("alwaysTrust allows the files and writes a permanent tasks record", async () => {
  await withDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot);
    await writeVscodeTasks(workspaceRoot);

    const first = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(first.gate.status, "needsPrompt");
    if (first.gate.status !== "needsPrompt") {
      return;
    }
    await applyWorkspaceTasksTrustDecision({
      spiritDataDir,
      workspaceRoot,
      contentHash: first.gate.tasks.contentHash,
      decision: "alwaysTrust",
    });

    const second = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(second.gate.status, "allow");
    assert.deepEqual(
      second.files.map((file) => file.sourceKind),
      ["workspace", "vscode-compat"],
    );
    const items = await listTaskMenuItemsCommand({ workspaceRoot });
    assert.deepEqual(
      items.map((item) => item.label),
      ["ws-task", "vs-task"],
    );

    const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
    assert.deepEqual(
      store.tasks?.map((entry) => entry.contentHash),
      [first.gate.tasks.contentHash],
    );
    assert.deepEqual(store.hooks, []);
  });
});

test("allowOnce allows for the session without persisting", async () => {
  await withDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot);

    const first = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(first.gate.status, "needsPrompt");
    if (first.gate.status !== "needsPrompt") {
      return;
    }
    await applyWorkspaceTasksTrustDecision({
      spiritDataDir,
      workspaceRoot,
      contentHash: first.gate.tasks.contentHash,
      decision: "allowOnce",
    });

    const second = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(second.gate.status, "allow");
    assert.deepEqual(
      (await listTaskMenuItemsCommand({ workspaceRoot })).map((item) => item.label),
      ["ws-task"],
    );
    const store = await loadWorkspaceCapabilityTrustStore(spiritDataDir);
    assert.deepEqual(store.tasks, []);
  });
});

test("deny keeps files out, does not re-prompt, and re-prompts after a content change", async () => {
  await withDirs(async ({ workspaceRoot, spiritDataDir }) => {
    await writeSpiritTasks(workspaceRoot);

    const first = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(first.gate.status, "needsPrompt");
    if (first.gate.status !== "needsPrompt") {
      return;
    }
    await applyWorkspaceTasksTrustDecision({
      spiritDataDir,
      workspaceRoot,
      contentHash: first.gate.tasks.contentHash,
      decision: "deny",
    });

    const second = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(second.gate.status, "denied");
    assert.deepEqual(second.files, []);

    await writeSpiritTasks(workspaceRoot, "make all");
    const third = await evaluateAndFilterTaskFiles({ workspaceRoot });
    assert.equal(third.gate.status, "needsPrompt");
  });
});

test("invalidate drops cached rerun resolutions so content is re-read from disk", async () => {
  await withDirs(async ({ workspaceRoot, spiritDataDir }) => {
    const filePath = path.join(spiritDataDir, "tasks.json");
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        tasks: [
          {
            label: "cached",
            command: "echo one",
            runOptions: { reevaluateOnRerun: false },
          },
        ],
      }),
      "utf8",
    );
    const resolver = createTaskRunResolver();
    const key = `${filePath}#cached`;
    const first = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(first.status, "ok");
    assert.equal(first.task.command, "echo one");

    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        tasks: [
          {
            label: "cached",
            command: "echo two",
            runOptions: { reevaluateOnRerun: false },
          },
        ],
      }),
      "utf8",
    );
    const cached = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(cached.status, "ok");
    assert.equal(cached.task.command, "echo one");

    resolver.invalidate();
    const fresh = await resolver.resolveTaskForRun({ workspaceRoot, key });
    assert.equal(fresh.status, "ok");
    assert.equal(fresh.task.command, "echo two");
  });
});
