import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { buildApprovalPromptView } from "../../src/lib/approval-prompt.ts";

const en = JSON.parse(readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8"));

/** Resolves dotted keys against en.json and interpolates {{var}} like i18next. */
function t(key, options = {}) {
  const value = key.split(".").reduce((node, part) => node?.[part], en);
  assert.equal(typeof value, "string", `missing en locale key: ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ""));
}

test("shell approval uses the reason as title and builds terminal and command lines", () => {
  const view = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "shell",
        command: "cat README.md | head -50",
        reason: "Preview the README",
        terminal: "zsh",
      },
    },
    "shell",
    t,
  );

  assert.equal(view.title, "Preview the README");
  assert.equal(
    view.body,
    "High-risk tool call: shell\nTerminal: zsh\nCommand: cat README.md | head -50",
  );
});

test("shell approval without reason falls back to the tool name as title", () => {
  const view = buildApprovalPromptView(
    { kind: "tool", request: { kind: "shell", command: "ls", terminal: "zsh" } },
    "shell",
    t,
  );

  assert.equal(view.title, "shell");
});

test("web_fetch approval keeps the injection warning", () => {
  const view = buildApprovalPromptView(
    { kind: "tool", request: { kind: "web_fetch", url: "https://example.com/docs" } },
    "web_fetch",
    t,
  );

  assert.equal(view.title, "web_fetch");
  assert.match(view.body, /fetch web page\nURL: https:\/\/example\.com\/docs\n\n/u);
  assert.match(view.body, /prompt injection/u);
});

test("read_path approval distinguishes file reads from directory listings", () => {
  const read = buildApprovalPromptView(
    { kind: "tool", request: { kind: "read_path", operation: "read_file", path: "/etc/hosts" } },
    "read_file",
    t,
  );
  const ls = buildApprovalPromptView(
    { kind: "tool", request: { kind: "read_path", operation: "ls", path: "/etc" } },
    "ls",
    t,
  );

  assert.match(
    read.body,
    /^High-risk tool call: Read file outside the workspace\nPath: \/etc\/hosts$/u,
  );
  assert.match(
    ls.body,
    /^High-risk tool call: List directory outside the workspace\nPath: \/etc$/u,
  );
});

test("file tool approvals carry their lengths and paths", () => {
  const created = buildApprovalPromptView(
    { kind: "tool", request: { kind: "create_file", path: "a.md", contentChars: 42 } },
    "create_file",
    t,
  );
  assert.match(created.body, /create file\nPath: a\.md\nContent length: 42 chars$/u);

  const edited = buildApprovalPromptView(
    { kind: "tool", request: { kind: "edit_file", path: "b.md", oldChars: 3, newChars: 9 } },
    "edit_file",
    t,
  );
  assert.match(
    edited.body,
    /edit file \(exact replacement\)\nPath: b\.md\nOld text length: 3 chars\nNew text length: 9 chars$/u,
  );

  const deleted = buildApprovalPromptView(
    { kind: "tool", request: { kind: "delete_file", path: "c.md" } },
    "delete_file",
    t,
  );
  assert.match(deleted.body, /delete file\nPath: c\.md$/u);

  const plan = buildApprovalPromptView(
    { kind: "tool", request: { kind: "create_plan", planName: "polish", contentChars: 7 } },
    "create_plan",
    t,
  );
  assert.match(plan.body, /create plan\nName: polish\nContent length: 7 chars$/u);
});

test("apply_patch approval includes the diff line count only for updates", () => {
  const update = buildApprovalPromptView(
    {
      kind: "tool",
      request: { kind: "apply_patch", operation: "update_file", path: "d.ts", diffLines: 12 },
    },
    "apply_patch",
    t,
  );
  assert.match(update.body, /apply_patch \(update_file\)\nPath: d\.ts\nDiff lines: 12$/u);

  const create = buildApprovalPromptView(
    { kind: "tool", request: { kind: "apply_patch", operation: "create_file", path: "e.ts" } },
    "apply_patch",
    t,
  );
  assert.match(create.body, /apply_patch \(create_file\)\nPath: e\.ts$/u);
  assert.ok(!create.body.includes("Diff lines"));
});

test("create_automation approval localizes the schedule and the approval level", () => {
  const view = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "create_automation",
        title: "Nightly sweep",
        trigger: { kind: "time", schedule: { kind: "daily", hour: 9, minute: 0 } },
        approvalLevel: "bypass-approval",
        overviewChars: 88,
      },
    },
    "create_automation",
    t,
  );

  assert.match(
    view.body,
    /Create automation\nTitle: Nightly sweep\nSchedule: Daily 09:00\nRun approval: Bypass Approval\nOverview length: 88 characters$/u,
  );
});

test("extension tool approval carries the extension, tool, and arguments preview", () => {
  const view = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "extension_tool",
        extensionId: "weather",
        toolName: "forecast",
        argumentsPreview: '{\n  "city": "Berlin"\n}',
      },
    },
    "extension_tool",
    t,
  );

  assert.match(
    view.body,
    /Extension tool requires confirmation\nExtension: weather\nTool: forecast\n\nArguments\n\{\n  "city": "Berlin"\n\}$/u,
  );
});

test("lazy tool_call approval distinguishes built-in, MCP, and unknown providers", () => {
  const builtIn = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "lazy_tool_call",
        provider: "built-in",
        server: "desktop",
        tool: "create_automation",
      },
    },
    "tool_call",
    t,
  );
  assert.match(
    builtIn.body,
    /^High-risk tool call: built-in tool_call\nServer: desktop\nTool: create_automation\nArguments:\n\(none\)$/u,
  );

  const mcp = buildApprovalPromptView(
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
    t,
  );
  assert.match(
    mcp.body,
    /^High-risk tool call: MCP tool_call\nServer: docs\nTool: search\nArguments:\n\{\n  "query": "x"\n\}$/u,
  );

  const other = buildApprovalPromptView(
    {
      kind: "tool",
      request: { kind: "lazy_tool_call", provider: "custom", server: "s", tool: "t" },
    },
    "tool_call",
    t,
  );
  assert.match(
    other.body,
    /^High-risk tool call: tool_call\nprovider: custom\nServer: s\nTool: t\nArguments:\n\(none\)$/u,
  );
});

test("hook approval passes the message through and falls back when absent", () => {
  const withMessage = buildApprovalPromptView(
    { kind: "hook", message: "confirm with the team" },
    "shell",
    t,
  );
  assert.equal(withMessage.title, "shell");
  assert.equal(withMessage.body, "confirm with the team");

  const withoutMessage = buildApprovalPromptView({ kind: "hook", message: undefined }, "shell", t);
  assert.equal(withoutMessage.body, "Hook requested approval for shell.");
});
