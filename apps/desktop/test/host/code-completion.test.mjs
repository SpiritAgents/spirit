import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { setKeyringStoreForTests, providerInternalKeyAccount } from "@spiritagent/host-internal";

import {
  abortCodeCompletionCommand,
  clearCodeCompletionStateForWorkspace,
  recordCodeCompletionFileStateCommand,
  requestCodeCompletionCommand,
  resetCodeCompletionJournalCommand,
  resolveCodeCompletionTransportConfig,
} from "../../dist-electron/src/host/code-completion-commands.js";
import {
  defaultAgentsConfig,
  setSpiritDataDirOverride,
} from "../../dist-electron/src/host/storage.js";

const workspaceRoot = "/tmp/code-completion-test";

function writeSecondaryModelFixture(modelName, { apiKeyEnv } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "spirit-code-completion-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "example",
          apiBase: "https://llm.example/v1",
          ...(apiKeyEnv ? { apiKeyEnv } : {}),
          models: [{ name: modelName, capabilities: ["languageModel"] }],
        },
      ],
      activeModel: { providerId: "example", name: modelName },
      secondaryLanguageModel: { providerId: "example", name: modelName },
    }),
  );
  return dir;
}

function withFixture(modelName, run) {
  const dir = writeSecondaryModelFixture(modelName);
  const store = new Map();
  setSpiritDataDirOverride(dir);
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  store.set(`Spirit/${providerInternalKeyAccount("example")}`, "test-key");

  const baseConfig = {
    providers: [
      {
        id: "example",
        apiBase: "https://llm.example/v1",
        models: [{ name: modelName, capabilities: ["languageModel"] }],
      },
    ],
    activeModel: { providerId: "example", name: modelName },
    secondaryLanguageModel: { providerId: "example", name: modelName },
    recentWorkspaces: [],
    translucency: "sidebar",
    systemNotifications: true,
    agentMode: "agent",
    webHost: { enabled: false, host: "127.0.0.1", port: 1421 },
    dreams: { enabled: false, debugMode: false },
    agents: defaultAgentsConfig(),
    networks: { llmHttpVersion: "http2" },
  };
  try {
    return run(baseConfig);
  } finally {
    setSpiritDataDirOverride(undefined);
    setKeyringStoreForTests(undefined);
  }
}

test("requestCodeCompletionCommand returns empty when secondary model missing", async () => {
  const baseConfig = {
    providers: [],
    activeModel: { providerId: "", name: "" },
    recentWorkspaces: [],
    translucency: "sidebar",
    systemNotifications: true,
    agentMode: "agent",
    webHost: { enabled: false, host: "127.0.0.1", port: 1421 },
    dreams: { enabled: false, debugMode: false },
    agents: defaultAgentsConfig(),
    networks: { llmHttpVersion: "http2" },
  };
  const result = await requestCodeCompletionCommand(
    {
      workspaceRoot,
      config: {
        ...baseConfig,
        secondaryLanguageModel: { providerId: "example", name: "missing-model" },
      },
    },
    {
      relativePath: "src/a.ts",
      languageId: "typescript",
      documentText: "const a = 1;",
      cursorLine: 1,
      cursorColumn: 12,
    },
  );
  assert.deepEqual(result, { operations: [] });
});

test("requestCodeCompletionCommand returns empty when code completion disabled", async () => {
  await withFixture("local-model", async (baseConfig) => {
    const result = await requestCodeCompletionCommand(
      {
        workspaceRoot,
        config: {
          ...baseConfig,
          agents: {
            ...defaultAgentsConfig(),
            codeCompletion: { enabled: false },
          },
        },
      },
      {
        relativePath: "src/a.ts",
        languageId: "typescript",
        documentText: "const a = 1;",
        cursorLine: 1,
        cursorColumn: 12,
      },
    );
    assert.deepEqual(result, { operations: [] });
  });
});

test("record and reset journal commands do not throw", async () => {
  await withFixture("local-model", async (baseConfig) => {
    const context = { workspaceRoot: `${workspaceRoot}-journal`, config: baseConfig };
    recordCodeCompletionFileStateCommand(context, {
      relativePath: "src/a.ts",
      baselineText: "a",
      currentText: "b",
    });
    resetCodeCompletionJournalCommand(context);
    abortCodeCompletionCommand(context.workspaceRoot);
  });
});

test("clearCodeCompletionStateForWorkspace drops journal after record", async () => {
  await withFixture("local-model", async (baseConfig) => {
    const root = `${workspaceRoot}-clear`;
    const context = { workspaceRoot: root, config: baseConfig };
    recordCodeCompletionFileStateCommand(context, {
      relativePath: "src/a.ts",
      baselineText: "a",
      currentText: "b",
    });
    clearCodeCompletionStateForWorkspace(root);
    resetCodeCompletionJournalCommand(context);
  });
});

test("resolveCodeCompletionTransportConfig resolves the secondary model with the completion profile", async () => {
  await withFixture("local-model", async (baseConfig) => {
    const config = resolveCodeCompletionTransportConfig({ workspaceRoot, config: baseConfig });
    assert.ok(config);
    // The unified path carries no vendor identity; the completion profile marks the request.
    // (Reasoning-off for completions is agent-core's transitional llmVendor-keyed profile,
    // pending the declaration-driven flip in P5/P6.)
    assert.equal("llmVendor" in config, false);
    assert.equal(config.transportRequestProfile, "code-completion");
    assert.equal(config.model, "local-model");
    assert.equal(config.baseUrl, "https://llm.example/v1");
  });
});

test("resolveCodeCompletionTransportConfig returns undefined when a declared channel resolves empty", () => {
  // The transport resolution reads config.json from disk; the declared-but-missing env channel
  // must be on disk for the setup error to surface.
  const dir = writeSecondaryModelFixture("local-model", {
    apiKeyEnv: "SPIRIT_TEST_MISSING_API_KEY",
  });
  setSpiritDataDirOverride(dir);
  setKeyringStoreForTests({
    getPassword: () => undefined,
    setPassword: () => {},
    deletePassword: () => {},
  });
  try {
    const config = {
      providers: [
        {
          id: "example",
          apiBase: "https://llm.example/v1",
          models: [{ name: "local-model", capabilities: ["languageModel"] }],
        },
      ],
      activeModel: { providerId: "example", name: "local-model" },
      secondaryLanguageModel: { providerId: "example", name: "local-model" },
      agents: defaultAgentsConfig(),
    };
    assert.equal(resolveCodeCompletionTransportConfig({ workspaceRoot, config }), undefined);
  } finally {
    setSpiritDataDirOverride(undefined);
    setKeyringStoreForTests(undefined);
  }
});
