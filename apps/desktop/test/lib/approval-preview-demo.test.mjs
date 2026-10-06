import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  fileContentPreviewForApprovalRequest,
  fileDiffPreviewsForApprovalRequest,
} from "../../src/lib/approval-file-previews.ts";
import {
  buildApprovalPreviewDemoEntries,
  buildApprovalPreviewDemoQuestions,
} from "../../src/lib/approval-preview-demo.ts";
import { buildApprovalPromptView } from "../../src/lib/approval-prompt.ts";

const en = JSON.parse(readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8"));

/** Resolves dotted keys against en.json and interpolates {{var}} like i18next. */
function t(key, options = {}) {
  const value = key.split(".").reduce((node, part) => node?.[part], en);
  assert.equal(typeof value, "string", `missing en locale key: ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ""));
}

test("approval preview demo covers every tool approval form as structured descriptors", () => {
  const entries = buildApprovalPreviewDemoEntries();

  assert.equal(entries.length, 18);

  const shells = entries.filter((entry) => entry.approval.kind === "shell");
  assert.equal(shells.length, 3);
  assert.equal(shells[0].approval.command, "cat README.md | head -50");
  assert.match(shells[1].approval.command, /python3/u);
  assert.match(shells[1].approval.command, /node -e/u);

  for (const kind of [
    "create_file",
    "edit_file",
    "delete_file",
    "apply_patch",
    "create_plan",
    "create_automation",
    "web_fetch",
    "read_path",
    "lazy_tool_call",
  ]) {
    assert.ok(
      entries.some((entry) => entry.approval.kind === kind),
      `missing approval descriptor for ${kind}`,
    );
  }

  // Only shell and out-of-workspace read offer an "Always Allow" remember target.
  const remembered = entries.filter((entry) => entry.rememberTarget !== undefined);
  assert.equal(remembered.length, 6);
  assert.deepEqual(
    remembered.map((entry) => entry.rememberTarget.kind),
    ["shell", "shell", "shell", "read_file", "read_file", "read_file"],
  );

  // Every demo card previews the blocked-by-auto-review row.
  assert.ok(entries.every((entry) => entry.autoReviewBlockReason.trim().length > 0));

  // Two hook-gated cards: a shell command and an out-of-workspace read, both carrying the
  // structured request alongside the hook message.
  const hookGated = entries.filter((entry) => entry.hookMessage !== undefined);
  assert.equal(hookGated.length, 2);
  assert.deepEqual(
    hookGated.map((entry) => entry.approval.kind),
    ["shell", "read_path"],
  );
  assert.ok(hookGated.every((entry) => entry.hookMessage.trim().length > 0));

  // File-change cards carry the executor-shaped preview on the approval descriptor.
  const createFile = entries.find((entry) => entry.approval.kind === "create_file");
  assert.equal(createFile?.approval.fileDiffPreview?.path, "docs/approval-form-preview-notes.md");
  assert.ok(createFile?.approval.fileDiffPreview?.modified.trim().length > 0);

  const createPlan = entries.find((entry) => entry.approval.kind === "create_plan");
  assert.equal(createPlan?.approval.fileDiffPreview?.path, "plans/approval-form-style-polish.md");
  assert.equal(createPlan?.approval.fileDiffPreview?.operation, "create");
  assert.ok(createPlan?.approval.fileDiffPreview?.modified.trim().length > 0);

  // The out-of-workspace read card carries a content preview instead of the plain path text.
  const readFile = entries.find(
    (entry) => entry.approval.kind === "read_path" && entry.approval.operation === "read_file",
  );
  assert.equal(readFile?.approval.fileContentPreview?.path, "/etc/hosts");
  assert.ok(readFile?.approval.fileContentPreview?.content.includes("127.0.0.1"));
  const readPreview = fileContentPreviewForApprovalRequest(readFile.approval);
  assert.equal(readPreview?.relativePath, "/etc/hosts");
  // Read previews start expanded.
  assert.equal(readPreview?.defaultOpen, undefined);

  // The out-of-workspace ls card renders the directory listing in the same content frame.
  const lsEntry = entries.find(
    (entry) => entry.approval.kind === "read_path" && entry.approval.operation === "ls",
  );
  assert.equal(lsEntry?.approval.fileContentPreview?.path, "/opt/spirit-tools");
  assert.ok(lsEntry?.approval.fileContentPreview?.content.includes("bin/"));
  const lsPreview = fileContentPreviewForApprovalRequest(lsEntry.approval);
  assert.equal(lsPreview?.languageId, "plaintext");
  // Directory listings get the folder icon.
  assert.equal(lsPreview?.directory, true);

  // apply_patch demos each operation as its own card, like real single-operation calls, plus a
  // multi-hunk update.
  const patches = entries.filter((entry) => entry.approval.kind === "apply_patch");
  assert.deepEqual(
    patches.map((entry) => entry.approval.operation),
    ["create_file", "update_file", "update_file", "delete_file"],
  );
  assert.ok(patches.every((entry) => entry.approval.fileDiffPreview !== undefined));

  // The multi-hunk update card previews distant edits in one file.
  const multiHunk = patches[2];
  assert.equal(
    multiHunk.approval.fileDiffPreview?.path,
    "apps/desktop/src/hooks/use-conversation-demo.ts",
  );
  assert.ok(
    multiHunk.approval.fileDiffPreview?.original.includes('import { useMemo } from "react"'),
  );
  assert.ok(multiHunk.approval.fileDiffPreview?.modified.includes("useMemo, useState"));

  // Through the real snapshot mapper, delete frames start collapsed and others expanded.
  const deleteEntries = entries.filter(
    (entry) => entry.approval.fileDiffPreview?.operation === "delete",
  );
  assert.equal(deleteEntries.length, 2);
  for (const entry of deleteEntries) {
    assert.equal(fileDiffPreviewsForApprovalRequest(entry.approval)?.[0]?.defaultOpen, false);
  }
  const expandedEntries = entries.filter(
    (entry) =>
      entry.approval.fileDiffPreview !== undefined &&
      entry.approval.fileDiffPreview.operation !== "delete",
  );
  assert.ok(expandedEntries.length > 0);
  for (const entry of expandedEntries) {
    assert.equal(fileDiffPreviewsForApprovalRequest(entry.approval)?.[0]?.defaultOpen, undefined);
  }
});

test("approval preview demo entries render through the real approval prompt builder", () => {
  const entries = buildApprovalPreviewDemoEntries();
  const views = entries.map((entry) =>
    buildApprovalPromptView(
      entry.hookMessage !== undefined
        ? { kind: "hook", message: entry.hookMessage, request: entry.approval }
        : { kind: "tool", request: entry.approval },
      entry.toolName,
      t,
    ),
  );

  const [simpleShell] = views;
  assert.equal(simpleShell.title, "Preview the top of the README");
  assert.equal(simpleShell.body, "cat README.md | head -50");

  // The hook-gated card keeps the shell reason as its title and the hook message as its body.
  const hookShell = views[2];
  assert.equal(hookShell.title, "Verify the desktop build");
  assert.ok(hookShell.body.includes("pre-build-guard"));

  const automation = views[11];
  assert.equal(automation.title, "Create Nightly Session Sweep to run daily at 09:00");
  assert.ok(automation.body.startsWith("Read the sessions that finished"));

  const githubAutomation = views[12];
  assert.equal(
    githubAutomation.title,
    "Create PR Tracker to run when a pull request is opened in SpiritAgents/spirit",
  );

  const ls = views[14];
  // The ls title lists the directory path directly.
  assert.equal(ls.title, "List /opt/spirit-tools");
  assert.equal(ls.body, "Path: /opt/spirit-tools");

  const externalRead = views[15];
  assert.equal(externalRead.title, "Read File Outside the Workspace");
  assert.equal(externalRead.body, "Path: /etc/hosts");

  // The hook-gated read keeps the localized title and puts the hook message in the body.
  const hookRead = views[16];
  assert.equal(hookRead.title, "Read File Outside the Workspace");
  assert.ok(hookRead.body.includes("audit-outside-reads"));

  // The MCP lazy tool call titles "{Server} {Tool}" and carries pretty-printed arguments.
  const mcp = views[17];
  assert.equal(mcp.title, "Notes Search Notes");
  assert.ok(mcp.body.includes('"query": "approval preview"'));

  assert.ok(views.every((view) => view.title.trim().length > 0));
  // web_fetch intentionally carries no body: the URL lives in the title and the card skips
  // an empty body.
  assert.ok(
    views.every(
      (view, index) => entries[index]?.approval.kind === "web_fetch" || view.body.trim().length > 0,
    ),
  );
});

test("approval preview demo questions form is two pages: single-select then multi-select", () => {
  const demo = buildApprovalPreviewDemoQuestions();
  assert.equal(demo.toolName, "ask_questions");
  const [single, multi] = demo.request.questions;
  assert.equal(demo.request.questions.length, 2);
  assert.equal(single.options.length, 3);
  assert.equal(single.allowMultiple ?? false, false);
  assert.equal(multi.options.length, 3);
  assert.equal(multi.allowMultiple, true);
  // Ids stay unique across the form so drafts never bleed between pages.
  const ids = demo.request.questions.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
});
