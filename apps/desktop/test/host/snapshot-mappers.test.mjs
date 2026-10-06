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
  assert.equal(mapped.shellCommand, "git status");
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
  assert.equal(mapped.shellCommand, undefined);
});

test("mapPendingToolApproval maps the executor file diff preview into card payloads", () => {
  const mapped = mapPendingToolApproval({
    toolName: "delete_file",
    request: { name: "delete_file", path: "tmp/scratch.log" },
    prompt: {
      kind: "tool",
      request: {
        kind: "delete_file",
        path: "tmp/scratch.log",
        fileDiffPreview: {
          path: "tmp/scratch.log",
          original: "seed\n",
          modified: "",
          operation: "delete",
        },
      },
    },
  });

  assert.equal(mapped.fileDiffPreviews?.length, 1);
  assert.equal(mapped.fileDiffPreviews[0].relativePath, "tmp/scratch.log");
  assert.equal(mapped.fileDiffPreviews[0].original, "seed\n");
  assert.equal(mapped.fileDiffPreviews[0].modified, "");
  // Delete frames start collapsed.
  assert.equal(mapped.fileDiffPreviews[0].defaultOpen, false);
});

test("mapPendingToolApproval leaves approvals without a preview untouched", () => {
  const mapped = mapPendingToolApproval({
    toolName: "shell",
    request: { command: "git status" },
    prompt: {
      kind: "tool",
      request: { kind: "shell", command: "git status", terminal: "zsh" },
    },
  });

  assert.equal(mapped.fileDiffPreviews, undefined);

  const hookGated = mapPendingToolApproval({
    toolName: "create_file",
    request: { name: "create_file", path: "a.md", content: "x" },
    prompt: { kind: "hook", message: "confirm first" },
  });
  assert.equal(hookGated.fileDiffPreviews, undefined);
});

test("mapPendingToolApproval maps the out-of-workspace read content preview", () => {
  const mapped = mapPendingToolApproval({
    toolName: "read_file",
    request: { name: "read_file", path: "/etc/hosts" },
    prompt: {
      kind: "tool",
      request: {
        kind: "read_path",
        operation: "read_file",
        path: "/etc/hosts",
        fileContentPreview: { path: "/etc/hosts", content: "127.0.0.1 localhost\n" },
      },
    },
  });

  assert.deepEqual(mapped.fileContentPreview, {
    relativePath: "/etc/hosts",
    languageId: "plaintext",
    content: "127.0.0.1 localhost\n",
  });
});

test("mapPendingToolApproval renders hook-gated tools through the structured request", () => {
  const mapped = mapPendingToolApproval({
    toolName: "shell",
    request: { name: "shell", command: "pnpm run build:desktop", reason: "Verify the build" },
    prompt: {
      kind: "hook",
      message: "Workspace hook asks for confirmation.",
      request: {
        kind: "shell",
        command: "pnpm run build:desktop",
        reason: "Verify the build",
        terminal: "zsh",
      },
    },
    rememberTarget: { kind: "shell", command: "pnpm run build:desktop" },
  });

  assert.equal(mapped.toolName, "Verify the build");
  assert.equal(mapped.hookMessage, "Workspace hook asks for confirmation.");
  assert.equal(mapped.shellCommand, "pnpm run build:desktop");
  assert.deepEqual(mapped.rememberTarget, { kind: "shell", command: "pnpm run build:desktop" });
});

test("mapPendingToolApproval maps hook-gated file previews from the carried request", () => {
  const mapped = mapPendingToolApproval({
    toolName: "delete_file",
    request: { name: "delete_file", path: "tmp/scratch.log" },
    prompt: {
      kind: "hook",
      message: "confirm the cleanup",
      request: {
        kind: "delete_file",
        path: "tmp/scratch.log",
        fileDiffPreview: {
          path: "tmp/scratch.log",
          original: "seed\n",
          modified: "",
          operation: "delete",
        },
      },
    },
  });

  assert.equal(mapped.hookMessage, "confirm the cleanup");
  assert.equal(mapped.fileDiffPreviews?.length, 1);
  assert.equal(mapped.fileDiffPreviews[0].defaultOpen, false);
});
