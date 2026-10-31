import assert from "node:assert/strict";
import { test } from "vitest";

import { buildApprovalPromptText } from "../src/approval-text.js";

test("buildApprovalPromptText renders the shell approval with its reason line", () => {
  const { body } = buildApprovalPromptText(
    {
      kind: "tool",
      request: {
        kind: "shell",
        command: "npm test",
        reason: "Run the test suite",
        terminal: "zsh",
      },
    },
    "shell",
  );
  assert.equal(
    body,
    "Reason: Run the test suite\nHigh-risk tool call: shell\nTerminal: zsh\nCommand: npm test",
  );
});

test("buildApprovalPromptText distinguishes directory listings from file reads", () => {
  const { body } = buildApprovalPromptText(
    { kind: "tool", request: { kind: "read_path", operation: "ls", path: "/etc" } },
    "ls",
  );
  assert.equal(body, "High-risk tool call: List directory outside the workspace\nPath: /etc");
});

test("buildApprovalPromptText renders the automation schedule and approval level", () => {
  const { body } = buildApprovalPromptText(
    {
      kind: "tool",
      request: {
        kind: "create_automation",
        title: "Nightly sweep",
        trigger: { kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } },
        approvalLevel: "auto-approval",
        overview: "Check CI status and summarize failures.",
        overviewChars: 88,
      },
    },
    "create_automation",
  );
  assert.equal(
    body,
    "High-risk tool call: Create automation\nTitle: Nightly sweep\nSchedule: Weekly Mon 09:00\nRun approval: Auto-approval\nOverview length: 88 characters",
  );
});

test("buildApprovalPromptText renders a lazy MCP tool call", () => {
  const { body } = buildApprovalPromptText(
    {
      kind: "tool",
      request: {
        kind: "lazy_tool_call",
        provider: "mcp",
        server: "docs",
        tool: "search",
        arguments: { query: "x" },
      },
    },
    "tool_call",
  );
  assert.equal(
    body,
    'High-risk tool call: MCP tool_call\nServer: docs\nTool: search\nArguments:\n{\n  "query": "x"\n}',
  );
});

test("buildApprovalPromptText falls back for a message-less hook gate", () => {
  const { body } = buildApprovalPromptText({ kind: "hook", message: undefined }, "shell");
  assert.equal(body, "Hook requested approval for shell.");
});
