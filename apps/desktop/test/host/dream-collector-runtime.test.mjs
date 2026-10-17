import { test } from "vitest";
import assert from "node:assert/strict";

import { buildDreamCollectorRemoteCreateInput } from "../../dist-electron/src/host/dream-collector-runtime.js";

test("buildDreamCollectorRemoteCreateInput shapes daemon session.create payload", () => {
  const input = buildDreamCollectorRemoteCreateInput({
    workspaceRoot: "/tmp/workspace",
    gitBranch: "main",
    modelRef: { providerId: "openai", name: "gpt-test" },
    dreamSourceSession: {
      path: "/tmp/workspace/chats/source.json",
      displayName: "Source chat",
      savedAtUnixMs: 1_700_000_000_000,
    },
    approvalLevel: "auto-approval",
  });

  assert.equal(input.sessionKind, "dream-collector");
  assert.equal(input.agentMode, "agent");
  assert.equal(input.approvalLevel, "auto-approval");
  assert.deepEqual(input.dreamScope, {
    workspaceRoot: "/tmp/workspace",
    gitBranch: "main",
  });
  assert.equal(input.dreamSourceSession.path, "/tmp/workspace/chats/source.json");
  assert.equal(input.dreamSourceSession.displayName, "Source chat");
  assert.equal(input.dreamSourceSession.savedAtUnixMs, 1_700_000_000_000);
  assert.deepEqual(input.archive.llmHistory, []);
  assert.equal(input.conversationKey, undefined);
  assert.equal(input.todoSessionKey, undefined);
});

test("buildDreamCollectorRemoteCreateInput defaults approval to auto-approval", () => {
  const input = buildDreamCollectorRemoteCreateInput({
    workspaceRoot: "/tmp/workspace",
    gitBranch: "feature",
    modelRef: { providerId: "openai", name: "gpt-test" },
    dreamSourceSession: { path: "/tmp/workspace/chats/source.json" },
  });
  assert.equal(input.approvalLevel, "auto-approval");
});
