import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { matchLocaleTag } from "@spiritagent/i18n";
import { mergeMcpConfigFiles } from "@spiritagent/agent-core";
import {
  RuntimeSessionStore,
  createMcpConfigSource,
  discoverSkillEntries,
  loadHooksConfig,
  resolveProviderApiKeyResolution,
  splitShellCommandLine,
  summarizeHooksConfig,
  type RuntimeSessionState,
} from "@spiritagent/host-internal";

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "spirit-domain-contract-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("TypeScript instruction discovery preserves root precedence and name ordering", async () => {
  await withTempDir(async (root) => {
    const workspaceRoot = path.join(root, "workspace");
    const spiritDataDir = path.join(root, "data");
    const skillDirectories = [
      path.join(workspaceRoot, ".spirit", "skills", "shared"),
      path.join(workspaceRoot, ".agents", "skills", "shared"),
      path.join(workspaceRoot, ".agents", "skills", "alpha"),
      path.join(spiritDataDir, "skills", "shared"),
    ];
    for (const directory of skillDirectories) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${path.basename(directory)}\ndescription: fixture\n---\n`,
      );
    }

    const entries = await discoverSkillEntries({ workspaceRoot, spiritDataDir });
    assert.deepEqual(
      entries.map((entry) => [entry.source.name, entry.source.rootKind]),
      [
        ["alpha", "workspaceAgents"],
        ["shared", "workspaceSpirit"],
      ],
    );
  });
});

test("TypeScript MCP config source applies user then workspace precedence", async () => {
  await withTempDir(async (root) => {
    const workspaceRoot = path.join(root, "workspace");
    const spiritDataDir = path.join(root, "data");
    await mkdir(path.join(workspaceRoot, ".spirit"), { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(
      path.join(spiritDataDir, "mcp.json"),
      JSON.stringify({
        servers: { shared: { transport: { type: "stdio", command: "user-fixture" } } },
      }),
    );
    await writeFile(
      path.join(workspaceRoot, ".spirit", "mcp.json"),
      JSON.stringify({
        servers: { shared: { transport: { type: "stdio", command: "workspace-fixture" } } },
      }),
    );

    const source = createMcpConfigSource(spiritDataDir, workspaceRoot);
    const loaded = source.read(true);
    const merged = mergeMcpConfigFiles(loaded.user, loaded.workspace);
    assert.deepEqual(merged.servers["shared"]?.transport, {
      type: "stdio",
      command: "workspace-fixture",
    });
    assert.deepEqual(source.read(false).workspace, { servers: {} });
  });
});

test("TypeScript hooks loading counts user and workspace definitions", async () => {
  await withTempDir(async (root) => {
    const workspaceRoot = path.join(root, "workspace");
    const spiritDataDir = path.join(root, "data");
    await mkdir(path.join(workspaceRoot, ".spirit"), { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    const config = {
      version: 1,
      hooks: {
        sessionStart: [{ command: "./hook.mjs" }],
      },
    };
    await writeFile(path.join(spiritDataDir, "hooks.json"), JSON.stringify(config));
    await writeFile(path.join(workspaceRoot, ".spirit", "hooks.json"), JSON.stringify(config));

    const summary = summarizeHooksConfig(loadHooksConfig({ spiritDataDir, workspaceRoot }));
    assert.equal(summary.sessionStart, 2);
    assert.equal(summary.sessionEnd, 0);
  });
});

test("TypeScript provider credential resolution keeps value env and keyring precedence", () => {
  const profile = {
    id: "fixture",
    apiKey: "inline",
    apiKeyEnv: "SPIRIT_FIXTURE_KEY",
    apiKeyKeyring: { service: "fixture", account: "secondary" },
  };
  assert.equal(
    resolveProviderApiKeyResolution(profile, {
      env: { SPIRIT_FIXTURE_KEY: "environment" },
    }).source,
    "value",
  );
  assert.equal(
    resolveProviderApiKeyResolution(
      {
        id: profile.id,
        apiKeyEnv: profile.apiKeyEnv,
        apiKeyKeyring: profile.apiKeyKeyring,
      },
      { env: { SPIRIT_FIXTURE_KEY: "environment" } },
    ).source,
    "env",
  );
});

test("TypeScript permission splitting includes command substitutions", () => {
  assert.deepEqual(splitShellCommandLine("printf ok && printf '%s' \"$(git status)\""), {
    ok: true,
    segments: ["printf ok", "printf '%s' \"$(git status)\"", "git status"],
  });
});

test("TypeScript runtime session persistence retains the session contract", async () => {
  await withTempDir(async (root) => {
    const store = new RuntimeSessionStore(root, "session-fixture");
    const state: RuntimeSessionState = {
      version: 1,
      sessionId: "session-fixture",
      workspaceRoot: path.join(root, "workspace"),
      agentMode: "agent",
      initialized: true,
      archive: { messages: [], assistantAux: [], llmHistory: [] },
    };
    await store.save(state);
    assert.deepEqual(await store.read(), state);
  });
});

test("TypeScript locale matching is the shared alias baseline", () => {
  assert.equal(matchLocaleTag("zh-HK"), "zh-TW");
  assert.equal(matchLocaleTag("pt-BR"), "pt-BR");
  assert.equal(matchLocaleTag("ja-JP"), "ja");
  assert.equal(matchLocaleTag("unsupported"), undefined);
});
