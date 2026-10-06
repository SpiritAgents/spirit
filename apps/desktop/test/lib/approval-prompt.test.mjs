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

test("shell approval uses the reason as title and the raw command as body", () => {
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
  // The approval card renders the command as a Shiki block; the body is the raw command for
  // the timeline detail lines and notifications.
  assert.equal(view.body, "cat README.md | head -50");
});

test("shell approval without reason falls back to the tool name as title", () => {
  const view = buildApprovalPromptView(
    { kind: "tool", request: { kind: "shell", command: "ls", terminal: "zsh" } },
    "shell",
    t,
  );

  assert.equal(view.title, "shell");
});

test("web_fetch approval titles the action with the URL and carries no body", () => {
  const view = buildApprovalPromptView(
    { kind: "tool", request: { kind: "web_fetch", url: "https://example.com/docs" } },
    "web_fetch",
    t,
  );

  assert.equal(view.title, "Fetch https://example.com/docs");
  assert.equal(view.body, "");
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

  assert.equal(read.title, "Read File Outside the Workspace");
  assert.equal(read.body, "Path: /etc/hosts");
  assert.equal(ls.title, "List /etc");
  assert.equal(ls.body, "Path: /etc");
});

test("in-workspace read approvals drop the outside-the-workspace wording", () => {
  const view = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "read_path",
        operation: "read_file",
        path: "src/index.ts",
        workspaceExternal: false,
      },
    },
    "read_file",
    t,
  );

  assert.equal(view.title, "Read File");
  assert.equal(view.body, "Path: src/index.ts");
});

test("file tool approvals title the action and carry their lengths and paths", () => {
  const created = buildApprovalPromptView(
    { kind: "tool", request: { kind: "create_file", path: "a.md", contentChars: 42 } },
    "create_file",
    t,
  );
  assert.equal(created.title, "Create File");
  assert.equal(created.body, "Path: a.md\nContent length: 42 chars");

  const edited = buildApprovalPromptView(
    { kind: "tool", request: { kind: "edit_file", path: "b.md", oldChars: 3, newChars: 9 } },
    "edit_file",
    t,
  );
  assert.equal(edited.title, "Edit File");
  assert.equal(edited.body, "Path: b.md\nOld text length: 3 chars\nNew text length: 9 chars");

  const deleted = buildApprovalPromptView(
    { kind: "tool", request: { kind: "delete_file", path: "c.md" } },
    "delete_file",
    t,
  );
  assert.equal(deleted.title, "Delete File");
  assert.equal(deleted.body, "Path: c.md");

  const plan = buildApprovalPromptView(
    { kind: "tool", request: { kind: "create_plan", planName: "polish", contentChars: 7 } },
    "create_plan",
    t,
  );
  assert.equal(plan.title, "Create Plan");
  assert.equal(plan.body, "Name: polish\nContent length: 7 chars");
});

test("apply_patch approval titles the operation like the single-purpose file tools", () => {
  const update = buildApprovalPromptView(
    {
      kind: "tool",
      request: { kind: "apply_patch", operation: "update_file", path: "d.ts", diffLines: 12 },
    },
    "apply_patch",
    t,
  );
  assert.equal(update.title, "Edit File");
  assert.equal(update.body, "Path: d.ts\nDiff lines: 12");

  const create = buildApprovalPromptView(
    { kind: "tool", request: { kind: "apply_patch", operation: "create_file", path: "e.ts" } },
    "apply_patch",
    t,
  );
  assert.equal(create.title, "Create File");
  assert.equal(create.body, "Path: e.ts");

  const remove = buildApprovalPromptView(
    { kind: "tool", request: { kind: "apply_patch", operation: "delete_file", path: "f.ts" } },
    "apply_patch",
    t,
  );
  assert.equal(remove.title, "Delete File");

  // Unknown operations fall back to the generic key.
  const unknown = buildApprovalPromptView(
    { kind: "tool", request: { kind: "apply_patch", operation: "move_file", path: "g.ts" } },
    "apply_patch",
    t,
  );
  assert.equal(unknown.title, "Apply Patch");
});

test("create_automation approval composes a structured title and carries the overview as body", () => {
  const automation = (trigger, extra = {}) => ({
    kind: "tool",
    request: {
      kind: "create_automation",
      title: "Nightly sweep",
      trigger,
      approvalLevel: "bypass-approval",
      overview: "Summarize what changed.",
      overviewChars: 24,
      ...extra,
    },
  });

  const daily = buildApprovalPromptView(
    automation({ kind: "time", schedule: { kind: "daily", hour: 9, minute: 0 } }),
    "create_automation",
    t,
  );
  assert.equal(daily.title, "Create Nightly sweep to run daily at 09:00");
  assert.equal(daily.body, "Summarize what changed.");

  const hourly = buildApprovalPromptView(
    automation({ kind: "time", schedule: { kind: "hourly" } }),
    "create_automation",
    t,
  );
  assert.equal(hourly.title, "Create Nightly sweep to run hourly");

  const weekly = buildApprovalPromptView(
    automation({ kind: "time", schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 } }),
    "create_automation",
    t,
  );
  assert.equal(weekly.title, "Create Nightly sweep to run every Monday at 09:00");

  const issue = buildApprovalPromptView(
    automation({ kind: "github", owner: "SpiritAgents", repo: "spirit", event: "issue_created" }),
    "create_automation",
    t,
  );
  assert.equal(
    issue.title,
    "Create Nightly sweep to run when an issue is opened in SpiritAgents/spirit",
  );

  const pr = buildApprovalPromptView(
    automation({
      kind: "github",
      owner: "SpiritAgents",
      repo: "spirit",
      event: "pull_request_created",
    }),
    "create_automation",
    t,
  );
  assert.equal(
    pr.title,
    "Create Nightly sweep to run when a pull request is opened in SpiritAgents/spirit",
  );

  // An unparseable trigger falls back to the generic title.
  const fallback = buildApprovalPromptView(
    automation({ kind: "time", schedule: { kind: "daily", hour: 99, minute: 0 } }),
    "create_automation",
    t,
  );
  assert.equal(fallback.title, "Create Automation");
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

  assert.equal(view.title, "extension_tool");
  assert.match(
    view.body,
    /^Extension tool requires confirmation\nExtension: weather\nTool: forecast\n\nArguments\n\{\n  "city": "Berlin"\n\}$/u,
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
  assert.equal(builtIn.title, "built-in tool_call");
  assert.equal(builtIn.body, "Server: desktop\nTool: create_automation\nArguments:\n(none)");

  // MCP titles read "{Server} {Tool}" in UI casing; the body is the pretty-printed arguments.
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
  assert.equal(mcp.title, "Docs Search");
  assert.equal(mcp.body, '{\n  "query": "x"\n}');

  // Well-known casing overrides survive tokenization (`ai` → `AI`), and no arguments means an
  // empty body so the card skips it.
  const mcpAi = buildApprovalPromptView(
    {
      kind: "tool",
      request: {
        kind: "lazy_tool_call",
        provider: "mcp",
        server: "ai_assistant",
        tool: "ai_search",
      },
    },
    "tool_call",
    t,
  );
  assert.equal(mcpAi.title, "AI Assistant AI Search");
  assert.equal(mcpAi.body, "");

  const other = buildApprovalPromptView(
    {
      kind: "tool",
      request: { kind: "lazy_tool_call", provider: "custom", server: "s", tool: "t" },
    },
    "tool_call",
    t,
  );
  // The title cannot carry an unknown provider, so the provider line stays in the body.
  assert.equal(other.title, "tool_call");
  assert.equal(other.body, "provider: custom\nServer: s\nTool: t\nArguments:\n(none)");
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
