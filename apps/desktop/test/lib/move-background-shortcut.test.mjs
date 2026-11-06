import assert from "node:assert/strict";
import { test } from "vitest";

import {
  firstMoveableBackgroundToolCallId,
  moveBackgroundShortcutTargetForMessages,
} from "../../src/lib/move-background-shortcut.ts";

test("move-background shortcut selects the first foreground Shell or Subagent call", () => {
  const messages = [
    { tool: { toolName: "shell", toolCallId: "done", phase: "succeeded" } },
    { tool: { toolName: "subagent", toolCallId: "first", phase: "running" } },
    { tool: { toolName: "shell", toolCallId: "second", phase: "pending-approval" } },
  ];
  assert.equal(firstMoveableBackgroundToolCallId(messages), "first");
  assert.deepEqual(moveBackgroundShortcutTargetForMessages(messages, "/chat.json"), {
    eligible: true,
    sessionPath: "/chat.json",
    toolCallId: "first",
  });
});

test("move-background shortcut ignores completed and already-background calls", () => {
  const messages = [
    { tool: { toolName: "shell", toolCallId: "done", phase: "succeeded" } },
    { tool: { toolName: "shell", toolCallId: "approval", phase: "pending-approval" } },
    {
      tool: {
        toolName: "subagent",
        toolCallId: "detached",
        phase: "running",
        backgroundTask: { id: "task-1" },
      },
    },
    { tool: { toolName: "read_file", toolCallId: "other", phase: "running" } },
  ];
  assert.equal(firstMoveableBackgroundToolCallId(messages), undefined);
  assert.deepEqual(moveBackgroundShortcutTargetForMessages(messages), { eligible: false });
});
