import { test } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildAutomationRemoteRuntimeCreateInput,
  buildEmptyAutomationArchive,
} from "../../dist-electron/src/host/automation-runtime.js";

const sampleDefinition = {
  id: "automation-test-id",
  title: "Daily",
  overview: "Run daily task",
  trigger: { kind: "time", schedule: { kind: "hourly" } },
  workspaceRoot: "/tmp/workspace",
  modelRef: { groupId: "openai", name: "gpt-test" },
  approvalLevel: "bypass-approval",
  enabled: true,
  createdAtUnixMs: 1,
  updatedAtUnixMs: 1,
};

test("buildEmptyAutomationArchive seeds empty daemon session archive", () => {
  const archive = buildEmptyAutomationArchive("auto-approval");
  assert.deepEqual(archive.messages, []);
  assert.deepEqual(archive.assistantAux, []);
  assert.deepEqual(archive.llmHistory, []);
  assert.deepEqual(archive.subagentSessions, []);
  assert.equal(archive.loopEnabled, false);
  assert.equal(archive.approvalLevel, "auto-approval");
});

test("buildAutomationRemoteRuntimeCreateInput aligns conversationKey with resolved session path", () => {
  const sessionPath = path.join("chats", "chat-automation-abc-123.json");
  const input = buildAutomationRemoteRuntimeCreateInput({
    definition: sampleDefinition,
    config: { activeModel: sampleDefinition.modelRef },
    sessionPath,
  });
  assert.equal(input.conversationKey, path.resolve(sessionPath));
  assert.equal(input.todoSessionKey, path.resolve(sessionPath));
  assert.equal(input.agentMode, "agent");
  assert.deepEqual(input.modelRef, sampleDefinition.modelRef);
  assert.equal(input.approvalLevel, "bypass-approval");
  assert.deepEqual(input.archive.llmHistory, []);
});
