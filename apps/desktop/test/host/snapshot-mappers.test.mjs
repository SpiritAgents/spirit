import assert from "node:assert/strict";
import { test } from "vitest";

import { mapPendingToolApproval } from "../../dist-electron/src/host/snapshot-mappers.js";

test("mapPendingToolApproval forwards subagentSessionId when present", () => {
  const mapped = mapPendingToolApproval({
    toolName: "shell",
    request: { command: "git status" },
    prompt: {
      kind: "tool",
      request: { kind: "shell", command: "git status", terminal: "zsh" },
    },
    rememberTarget: { kind: "shell", command: "git status" },
    subagentSessionId: "subagent-123",
  });

  assert.equal(mapped.subagentSessionId, "subagent-123");
  assert.equal(mapped.toolName, "shell");
  assert.deepEqual(mapped.rememberTarget, { kind: "shell", command: "git status" });
});

test("mapPendingToolApproval uses the shell reason as the card title", () => {
  const mapped = mapPendingToolApproval({
    toolName: "shell",
    request: { command: "git status", reason: "Check the working tree" },
    prompt: {
      kind: "tool",
      request: {
        kind: "shell",
        command: "git status",
        reason: "Check the working tree",
        terminal: "zsh",
      },
    },
  });

  assert.equal(mapped.toolName, "Check the working tree");
});

test("mapPendingToolApproval keeps the shell reason as title for a hook gate", () => {
  const mapped = mapPendingToolApproval({
    toolName: "shell",
    request: { command: "git status", reason: "Check the working tree" },
    prompt: { kind: "hook", message: "confirm with the team first" },
  });

  assert.equal(mapped.toolName, "Check the working tree");
  assert.equal(mapped.prompt, "confirm with the team first");
});

test("mapPendingToolApproval omits blank subagentSessionId", () => {
  const mapped = mapPendingToolApproval({
    toolName: "read_file",
    request: { path: "README.md" },
    prompt: {
      kind: "tool",
      request: { kind: "read_path", operation: "read_file", path: "/etc/hosts" },
    },
    subagentSessionId: "   ",
  });

  assert.equal(mapped.subagentSessionId, undefined);
});
