import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { toolNamesFromDefinitions } from "@spiritagent/agent-core";
import { setKeyringStoreForTests, providerInternalKeyAccount } from "@spiritagent/host-internal";

import { createServerRuntime } from "../src/runtime-factory.js";
import { SessionManager } from "../src/session-manager.js";

function freshDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-server-dream-collector-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "openai",
          apiBase: "https://api.openai.com/v1",
          transportKind: "open-responses",
          models: [{ name: "gpt-4o-mini" }],
        },
      ],
      activeModel: { providerId: "openai", name: "gpt-4o-mini" },
    }),
  );
  return dir;
}

function withMockKeyring(run: () => Promise<void>): Promise<void> {
  const store = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  store.set(`Spirit/${providerInternalKeyAccount("openai")}`, "test-key");
  return run().finally(() => setKeyringStoreForTests(undefined));
}

describe("dream-collector session", () => {
  it("createServerRuntime exposes dream-only tool definitions", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-dream-collector-ws-"));
      const result = await createServerRuntime({
        workspaceRoot,
        spiritDataDir: dataDir,
        sessionKey: "sess_dream_collector_test",
        hostKind: "desktop",
        approvalLevel: "auto-approval",
        sessionKind: "dream-collector",
        dreamScope: { workspaceRoot, gitBranch: "main" },
        dreamSourceSession: {
          path: join(workspaceRoot, "chats", "source.json"),
          displayName: "Source chat",
          savedAtUnixMs: Date.now(),
        },
        modelRef: { providerId: "openai", name: "gpt-4o-mini" },
        onEvent: () => {},
      });

      const toolNames = toolNamesFromDefinitions(result.toolExecutor.toolDefinitionsJson());
      assert.deepEqual([...toolNames].sort(), [
        "dream_delete",
        "dream_list",
        "dream_read",
        "dream_record",
        "dream_update",
      ]);
      assert.equal(result.enabledRules.length, 0);
      assert.equal(result.enabledSkillCatalog.length, 0);

      const beforeToolNames = toolNamesFromDefinitions(result.toolExecutor.toolDefinitionsJson());
      await result.reloadHostMetadata("plan");
      const afterToolNames = toolNamesFromDefinitions(result.toolExecutor.toolDefinitionsJson());
      assert.deepEqual(afterToolNames, beforeToolNames);
    });
  });

  it("SessionManager.createSession accepts dream-collector params", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-dream-collector-ws-"));
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });

      const created = await manager.createSession({
        workspaceRoot,
        hostKind: "desktop",
        approvalLevel: "auto-approval",
        sessionKind: "dream-collector",
        dreamScope: { workspaceRoot, gitBranch: "feature-branch" },
        dreamSourceSession: {
          path: join(workspaceRoot, "chats", "pending.json"),
        },
        modelRef: { providerId: "openai", name: "gpt-4o-mini" },
      });

      assert.ok(created.sessionId.startsWith("sess_"));
      assert.equal(created.isBusy, false);
      await manager.closeSession(created.sessionId);
    });
  });
});
