import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  applyWorkspaceCapabilityTrustDecision,
  persistPermanentWorkspaceCapabilityTrust,
  workspaceCapabilityTrustPath,
  clearWorkspaceCapabilityTrustSessionForTests,
  computeWorkspaceHooksContentHash,
  evaluateWorkspaceHooksTrustGate,
  filterDefinitionsByWorkspaceTrust,
  listWorkspaceHookTrustEntries,
  loadWorkspaceCapabilityTrustStore,
  persistPermanentWorkspaceHooksTrust,
} from "./trust.js";
import { createHookRunner } from "./service.js";
import type { LoadedHooksConfig } from "./loader.js";

async function makeWorkspaceFixture(): Promise<{
  dataDir: string;
  workspaceRoot: string;
  spiritDir: string;
  scriptPath: string;
  loaded: LoadedHooksConfig;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-hook-trust-data-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-hook-trust-ws-"));
  const spiritDir = join(workspaceRoot, ".spirit");
  const hooksDir = join(spiritDir, "hooks");
  await mkdir(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, "ws.sh");
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow"}'
`,
    "utf8",
  );
  await chmod(scriptPath, 0o755);
  await writeFile(
    join(spiritDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [{ command: "hooks/ws.sh" }],
      },
    }),
    "utf8",
  );

  const loaded: LoadedHooksConfig = {
    user: { version: 1, hooks: {} },
    workspace: {
      version: 1,
      hooks: {
        sessionStart: [{ command: "hooks/ws.sh" }],
      },
    },
    userConfigDir: dataDir,
    workspaceConfigDir: spiritDir,
  };

  return { dataDir, workspaceRoot, spiritDir, scriptPath, loaded };
}

test("listWorkspaceHookTrustEntries empty without workspace hooks", () => {
  const loaded: LoadedHooksConfig = {
    user: { version: 1, hooks: { sessionStart: [{ command: "u.sh" }] } },
    workspace: { version: 1, hooks: {} },
    userConfigDir: "/user",
    workspaceConfigDir: undefined,
  };
  assert.equal(listWorkspaceHookTrustEntries(loaded).length, 0);
  assert.equal(computeWorkspaceHooksContentHash(loaded), undefined);
});

test("evaluateWorkspaceHooksTrustGate needs prompt then permanent allow", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, loaded } = await makeWorkspaceFixture();
  const hash = computeWorkspaceHooksContentHash(loaded);
  assert.ok(hash);

  const first = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded,
  });
  assert.equal(first.status, "needsPrompt");
  if (first.status !== "needsPrompt") {
    return;
  }
  assert.equal(first.request.hashChanged, false);
  assert.equal(first.request.hooks.length, 1);

  await persistPermanentWorkspaceHooksTrust(dataDir, workspaceRoot, hash);
  const second = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded,
  });
  assert.equal(second.status, "allow");
});

test("hash change marks hashChanged and needs prompt again", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, spiritDir, scriptPath, loaded } = await makeWorkspaceFixture();
  const hash = computeWorkspaceHooksContentHash(loaded);
  assert.ok(hash);
  await persistPermanentWorkspaceHooksTrust(dataDir, workspaceRoot, hash);

  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow","userMessage":"changed"}'
`,
    "utf8",
  );
  await chmod(scriptPath, 0o755);

  const nextLoaded: LoadedHooksConfig = {
    ...loaded,
    workspaceConfigDir: spiritDir,
  };
  const nextHash = computeWorkspaceHooksContentHash(nextLoaded);
  assert.ok(nextHash);
  assert.notEqual(nextHash, hash);

  const gate = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded: nextLoaded,
  });
  assert.equal(gate.status, "needsPrompt");
  if (gate.status === "needsPrompt") {
    assert.equal(gate.request.hashChanged, true);
  }
});

test("allowOnce session allow skips second prompt", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, loaded } = await makeWorkspaceFixture();
  const hash = computeWorkspaceHooksContentHash(loaded);
  assert.ok(hash);

  await applyWorkspaceCapabilityTrustDecision({
    spiritDataDir: dataDir,
    workspaceRoot,
    contentHash: hash,
    decision: "allowOnce",
  });

  const gate = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded,
  });
  assert.equal(gate.status, "allow");

  const store = await loadWorkspaceCapabilityTrustStore(dataDir);
  assert.equal(store.hooks.length, 0);
});

test("filterDefinitionsByWorkspaceTrust drops workspace when denied", () => {
  const filtered = filterDefinitionsByWorkspaceTrust(
    [
      { command: "u.sh", scope: "user", configDir: "/u", timeout: 30 },
      { command: "w.sh", scope: "workspace", configDir: "/w", timeout: 30 },
    ],
    false,
  );
  assert.deepEqual(
    filtered.map((entry) => entry.scope),
    ["user"],
  );
});

test("createHookRunner denies workspace hooks without trust callback", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, spiritDir, scriptPath } = await makeWorkspaceFixture();
  const userScript = join(dataDir, "user.sh");
  await writeFile(
    userScript,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow","userMessage":"user-hook"}'
`,
    "utf8",
  );
  await chmod(userScript, 0o755);

  let prompts = 0;
  const runner = createHookRunner({
    spiritDataDir: dataDir,
    workspaceRoot,
    reloadConfig: () => ({
      user: {
        version: 1,
        hooks: { sessionStart: [{ command: "user.sh" }] },
      },
      workspace: {
        version: 1,
        hooks: { sessionStart: [{ command: "hooks/ws.sh" }] },
      },
      userConfigDir: dataDir,
      workspaceConfigDir: spiritDir,
    }),
  });

  const result = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "startup",
  });

  assert.equal(prompts, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.definition.scope, "user");
  assert.equal(result.records[0]?.definition.command, "user.sh");
  void scriptPath;
});

test("createHookRunner prompts once then runs workspace hooks on allowOnce", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, spiritDir } = await makeWorkspaceFixture();
  let prompts = 0;
  const runner = createHookRunner({
    spiritDataDir: dataDir,
    workspaceRoot,
    reloadConfig: () => ({
      user: { version: 1, hooks: {} },
      workspace: {
        version: 1,
        hooks: { sessionStart: [{ command: "hooks/ws.sh" }] },
      },
      userConfigDir: dataDir,
      workspaceConfigDir: spiritDir,
    }),
    requestWorkspaceCapabilityTrust: async () => {
      prompts += 1;
      return "allowOnce";
    },
  });

  const first = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "startup",
  });
  assert.equal(first.records.length, 1);
  assert.equal(prompts, 1);

  const second = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "resume",
  });
  assert.equal(second.records.length, 1);
  assert.equal(prompts, 1);
});

test("createHookRunner deny skips workspace hooks", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, spiritDir } = await makeWorkspaceFixture();
  let prompts = 0;
  const runner = createHookRunner({
    spiritDataDir: dataDir,
    workspaceRoot,
    reloadConfig: () => ({
      user: { version: 1, hooks: {} },
      workspace: {
        version: 1,
        hooks: { sessionStart: [{ command: "hooks/ws.sh" }] },
      },
      userConfigDir: dataDir,
      workspaceConfigDir: spiritDir,
    }),
    requestWorkspaceCapabilityTrust: async () => {
      prompts += 1;
      return "deny";
    },
  });

  const result = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "open",
  });
  assert.equal(result.records.length, 0);
  assert.equal(prompts, 1);

  // Deny is remembered per content hash: the next event with identical content
  // does not prompt again.
  const second = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "resume",
  });
  assert.equal(second.records.length, 0);
  assert.equal(prompts, 1);
});

test("hooks trust gate: deny is remembered per content hash until the content changes", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, loaded } = await makeWorkspaceFixture();
  const hash = computeWorkspaceHooksContentHash(loaded);
  assert.ok(hash);

  await applyWorkspaceCapabilityTrustDecision({
    spiritDataDir: dataDir,
    workspaceRoot,
    contentHash: hash,
    decision: "deny",
  });
  const denied = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded,
  });
  assert.deepEqual(denied, { status: "denied" });

  const changed: LoadedHooksConfig = {
    ...loaded,
    workspace: {
      version: 1,
      hooks: { sessionStart: [{ command: "hooks/other.sh" }] },
    },
  };
  const reprompt = await evaluateWorkspaceHooksTrustGate({
    spiritDataDir: dataDir,
    workspaceRoot,
    loaded: changed,
  });
  assert.equal(reprompt.status, "needsPrompt");
});

test("createHookRunner skips workspace hooks when content hash changes during prompt", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const { dataDir, workspaceRoot, spiritDir, scriptPath } = await makeWorkspaceFixture();
  let prompts = 0;
  const runner = createHookRunner({
    spiritDataDir: dataDir,
    workspaceRoot,
    reloadConfig: () => ({
      user: { version: 1, hooks: {} },
      workspace: {
        version: 1,
        hooks: { sessionStart: [{ command: "hooks/ws.sh" }] },
      },
      userConfigDir: dataDir,
      workspaceConfigDir: spiritDir,
    }),
    requestWorkspaceCapabilityTrust: async () => {
      prompts += 1;
      await writeFile(
        scriptPath,
        `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow","additionalContext":"tampered"}'
`,
        "utf8",
      );
      return "allowOnce";
    },
  });

  const result = await runner.runSessionStart({
    sessionId: "s",
    conversationPath: null,
    workspaceRoot,
    model: "m",
    source: "startup",
  });
  assert.equal(prompts, 1);
  assert.equal(result.records.length, 0);
  assert.equal(result.additionalContexts.length, 0);
});

test("concurrent persists from both capability kinds survive each other", async () => {
  clearWorkspaceCapabilityTrustSessionForTests();
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-trust-merge-"));
  try {
    // Interleaved as two processes would: each persist re-reads and merges on write.
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "hooks", "/repo-a", "h1");
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", "/repo-b", "t1");
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "hooks", "/repo-c", "h2");
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", "/repo-a", "t2");

    const store = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.deepEqual(
      store.hooks.map((entry) => [entry.workspaceRoot, entry.contentHash]),
      [
        ["/repo-a", "h1"],
        ["/repo-c", "h2"],
      ],
    );
    assert.deepEqual(
      store.tasks?.map((entry) => [entry.workspaceRoot, entry.contentHash]),
      [
        ["/repo-b", "t1"],
        ["/repo-a", "t2"],
      ],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a corrupted tmp leftover from a crashed write does not break load", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-trust-tmp-"));
  try {
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", "/repo", "t1");
    await writeFile(`${workspaceCapabilityTrustPath(dataDir)}.tmp`, "{not json", "utf8");
    const store = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.deepEqual(
      store.tasks?.map((entry) => entry.contentHash),
      ["t1"],
    );

    // The next write replaces the leftover tmp file.
    await persistPermanentWorkspaceCapabilityTrust(dataDir, "tasks", "/repo", "t2");
    const reloaded = await loadWorkspaceCapabilityTrustStore(dataDir);
    assert.deepEqual(
      reloaded.tasks?.map((entry) => entry.contentHash),
      ["t2"],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
