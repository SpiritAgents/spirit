import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  applyWorkspaceTasksTrustDecision,
  clearWorkspaceCapabilityTrustSessionForTests,
  loadWorkspaceCapabilityTrustStore,
  persistPermanentWorkspaceCapabilityTrust,
  persistPermanentWorkspaceHooksTrust,
  saveWorkspaceCapabilityTrustStore,
  WORKSPACE_CAPABILITY_TRUST_VERSION,
} from "../hooks/trust.js";
import { loadTaskFiles, userTasksFilePath } from "./discovery.js";
import type { LoadedTaskFile, TaskFileSourceKind } from "./schema.js";
import { computeWorkspaceTasksContentHash, evaluateWorkspaceTasksTrustGate } from "./trust.js";

async function withDataDir(run: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-tasks-trust-"));
  try {
    await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function taskFile(
  path: string,
  sourceKind: TaskFileSourceKind,
  json: unknown,
  rawText = JSON.stringify(json),
): LoadedTaskFile {
  return { path, sourceKind, json, rawText };
}

const WS = "/repo/.spirit/tasks.json";
const VS = "/repo/.vscode/tasks.json";
const USER = "/data/tasks.json";
const ROOT = "/repo";

test("trust store keeps hooks and tasks records independent", async () => {
  await withDataDir(async (dataDir) => {
    await persistPermanentWorkspaceHooksTrust(dataDir, ROOT, "hooks-hash");
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", ROOT, "tasks-hash");

    const store = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.deepEqual(
      store.hooks.map((entry) => entry.contentHash),
      ["hooks-hash"],
    );
    assert.deepEqual(
      store.tasks?.map((entry) => entry.contentHash),
      ["tasks-hash"],
    );

    // Persisting one capability never clobbers the other.
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", ROOT, "tasks-hash-2");
    const reloaded = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.deepEqual(
      reloaded.hooks.map((entry) => entry.contentHash),
      ["hooks-hash"],
    );
    assert.deepEqual(
      reloaded.tasks?.map((entry) => entry.contentHash),
      ["tasks-hash-2"],
    );
  });
});

test("a legacy store file without tasks loads with an empty tasks array", async () => {
  await withDataDir(async (dataDir) => {
    await saveWorkspaceCapabilityTrustStore(dataDir, {
      version: WORKSPACE_CAPABILITY_TRUST_VERSION,
      hooks: [
        {
          workspaceRoot: ROOT,
          contentHash: "hooks-hash",
          decision: "allow",
          decidedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const store = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.equal(store.hooks.length, 1);
    assert.deepEqual(store.tasks, []);
  });
});

test("tasks content hash tracks raw text of both workspace-controlled files", () => {
  const json = { schemaVersion: 1, tasks: [{ label: "a", command: "make" }] };
  const base = [
    taskFile(WS, "workspace", json),
    taskFile(VS, "vscode-compat", { version: "2.0.0", tasks: [] }),
  ];
  const userOnly = [...base, taskFile(USER, "user", json, '{"different":true}')];

  assert.equal(
    computeWorkspaceTasksContentHash(base),
    computeWorkspaceTasksContentHash([
      taskFile(WS, "workspace", json),
      taskFile(VS, "vscode-compat", { version: "2.0.0", tasks: [] }),
    ]),
  );
  // The user-level file never participates.
  assert.equal(computeWorkspaceTasksContentHash(base), computeWorkspaceTasksContentHash(userOnly));
  // Raw text change in either workspace-controlled file changes the hash.
  const changedWs = [taskFile(WS, "workspace", json, `${JSON.stringify(json)}\n`), base[1]!];
  assert.notEqual(
    computeWorkspaceTasksContentHash(base),
    computeWorkspaceTasksContentHash(changedWs),
  );
  const changedVs = [
    base[0]!,
    taskFile(VS, "vscode-compat", { version: "2.0.0", tasks: [] }, "// hi\n{}"),
  ];
  assert.notEqual(
    computeWorkspaceTasksContentHash(base),
    computeWorkspaceTasksContentHash(changedVs),
  );
});

test("tasks content hash covers JSONC comments (raw bytes, not parsed json)", () => {
  const json = { version: "2.0.0", tasks: [{ label: "a", command: "make" }] };
  const plain = [taskFile(VS, "vscode-compat", json, JSON.stringify(json))];
  const commented = [taskFile(VS, "vscode-compat", json, `// a comment\n${JSON.stringify(json)}`)];
  assert.notEqual(
    computeWorkspaceTasksContentHash(plain),
    computeWorkspaceTasksContentHash(commented),
  );
});

test("tasks trust gate reports noWorkspaceFiles without a root or workspace-controlled files", async () => {
  await withDataDir(async (dataDir) => {
    const json = { schemaVersion: 1, tasks: [{ label: "a", command: "make" }] };
    assert.deepEqual(
      await evaluateWorkspaceTasksTrustGate({
        spiritDataDir: dataDir,
        workspaceRoot: undefined,
        files: [],
      }),
      { status: "noWorkspaceFiles" },
    );
    assert.deepEqual(
      await evaluateWorkspaceTasksTrustGate({
        spiritDataDir: dataDir,
        workspaceRoot: ROOT,
        files: [taskFile(USER, "user", json)],
      }),
      { status: "noWorkspaceFiles" },
    );
  });
});

test("tasks trust gate: permanent allow, session allowOnce, stale permanent hashChanged", async () => {
  await withDataDir(async (dataDir) => {
    clearWorkspaceCapabilityTrustSessionForTests();
    const files = [
      taskFile(WS, "workspace", { schemaVersion: 1, tasks: [{ label: "a", command: "make" }] }),
    ];
    const contentHash = computeWorkspaceTasksContentHash(files);

    const first = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files,
    });
    assert.equal(first.status, "needsPrompt");
    if (first.status === "needsPrompt") {
      assert.equal(first.tasks.hashChanged, false);
      assert.deepEqual(first.tasks.items, [{ label: "a", command: "make", sourcePath: WS }]);
    }

    await applyWorkspaceTasksTrustDecision({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      contentHash,
      decision: "allowOnce",
    });
    const allowed = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files,
    });
    assert.equal(allowed.status, "allow");

    // A stale permanent record plus a session match reports hashChanged for context.
    clearWorkspaceCapabilityTrustSessionForTests();
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", ROOT, "older-hash");
    await applyWorkspaceTasksTrustDecision({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      contentHash,
      decision: "allowOnce",
    });
    const stale = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files,
    });
    assert.deepEqual(stale, { status: "allow", contentHash, hashChanged: true });
  });
});

test("tasks trust gate prompt lists entries from both workspace files with display commands", async () => {
  await withDataDir(async (dataDir) => {
    clearWorkspaceCapabilityTrustSessionForTests();
    const files = [
      taskFile(WS, "workspace", {
        schemaVersion: 1,
        tasks: [
          { label: "string", command: "make" },
          { label: "array", command: ["bash", "run.sh"], args: ["--fast"] },
          { label: "object", command: { value: "node" }, args: ["server.js", { value: "-p 1" }] },
        ],
      }),
      taskFile(VS, "vscode-compat", {
        version: "2.0.0",
        tasks: [{ label: "vs-task", command: "npm test" }],
      }),
    ];
    const gate = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files,
    });
    assert.equal(gate.status, "needsPrompt");
    if (gate.status !== "needsPrompt") {
      return;
    }
    assert.deepEqual(gate.tasks.items, [
      { label: "string", command: "make", sourcePath: WS },
      { label: "array", command: "bash run.sh --fast", sourcePath: WS },
      { label: "object", command: "node server.js -p 1", sourcePath: WS },
      { label: "vs-task", command: "npm test", sourcePath: VS },
    ]);
  });
});

test("tasks trust gate: deny stops re-prompting until the content changes", async () => {
  await withDataDir(async (dataDir) => {
    clearWorkspaceCapabilityTrustSessionForTests();
    const files = [
      taskFile(WS, "workspace", { schemaVersion: 1, tasks: [{ label: "a", command: "make" }] }),
    ];
    const contentHash = computeWorkspaceTasksContentHash(files);

    await applyWorkspaceTasksTrustDecision({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      contentHash,
      decision: "deny",
    });
    const denied = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files,
    });
    assert.deepEqual(denied, { status: "denied" });

    const changed = [
      taskFile(WS, "workspace", { schemaVersion: 1, tasks: [{ label: "a", command: "make all" }] }),
    ];
    const reprompt = await evaluateWorkspaceTasksTrustGate({
      spiritDataDir: dataDir,
      workspaceRoot: ROOT,
      files: changed,
    });
    assert.equal(reprompt.status, "needsPrompt");
  });
});

test("loaded task files carry byte-identical rawText for Spirit and JSONC sources", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-tasks-raw-ws-"));
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-tasks-raw-data-"));
  try {
    const spiritContent = `{\n  "schemaVersion": 1,\n  "tasks": []\n}\n`;
    const vscodeContent = `{
  // JSONC comment
  "version": "2.0.0",
  "tasks": [],
}
`;
    await mkdir(join(workspaceRoot, ".spirit"), { recursive: true });
    await mkdir(join(workspaceRoot, ".vscode"), { recursive: true });
    await writeFile(join(workspaceRoot, ".spirit", "tasks.json"), spiritContent, "utf8");
    await writeFile(join(workspaceRoot, ".vscode", "tasks.json"), vscodeContent, "utf8");
    await writeFile(userTasksFilePath(spiritDataDir), `{"schemaVersion":1,"tasks":[]}`, "utf8");

    const files = await loadTaskFiles({ workspaceRoot, spiritDataDir });
    assert.equal(files.length, 3);
    assert.equal(files[0]?.rawText, spiritContent);
    assert.equal(files[1]?.rawText, `{"schemaVersion":1,"tasks":[]}`);
    assert.equal(files[2]?.rawText, vscodeContent);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
