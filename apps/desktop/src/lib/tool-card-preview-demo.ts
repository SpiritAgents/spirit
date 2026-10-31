import { serializeShellToolResult } from "@spiritagent/agent-core/shell-tool-result";

import {
  DEMO_PATCH_MULTI_HUNK_MODIFIED,
  DEMO_PATCH_MULTI_HUNK_ORIGINAL,
  DEMO_PATCH_MULTI_HUNK_PATH,
} from "@/lib/approval-preview-demo";
import { formatLazyToolCallDetail } from "@/lib/lazy-tool-call-display";
import type { ToolBlockSnapshot } from "@/types";

/**
 * UI-only demo: one completed tool card per agent tool, mirroring the snapshots the host writes
 * into the conversation timeline. Cards render through the real MinimalToolCallCard, so the
 * collapsed summary lines and expanded details always match the real conversation area.
 */
export const TOOL_CARD_PREVIEW_DEMO_WORKSPACE = "/workspace/demo-project";

const DEMO_SHELL_COMMAND = "ls -la";

const DEMO_SHELL_OUTPUT = `total 4
drwxr-xr-x  5 demo  staff  160 Oct  5 12:00 .
drwxr-xr-x  3 demo  staff   96 Oct  5 11:58 ..
-rw-r--r--  1 demo  staff  420 Oct  5 12:00 package.json
drwxr-xr-x  4 demo  staff  128 Oct  5 12:00 src
`;

const DEMO_READ_FILE_PATH = "apps/desktop/src/App.tsx";

const DEMO_READ_FILE_CONTENT = `export function App() {
  const runtime = useDesktopRuntime();
  return <AppShell runtime={runtime} />;
}
`;

const DEMO_LS_PATH = "/workspace/demo-project/src";

const DEMO_LS_OUTPUT = `[list]
path: ${DEMO_LS_PATH}
directories: 2
files: 2
skipped_dirs: 0
skipped_symlinks: 0

directories
${DEMO_LS_PATH}/components
${DEMO_LS_PATH}/hooks

files
${DEMO_LS_PATH}/App.tsx
${DEMO_LS_PATH}/main.tsx
`;

const DEMO_GREP_OUTPUT = `apps/desktop/src/App.tsx:42:  const approval = useApprovalGate();
apps/desktop/src/App.tsx:87:  return <ApprovalHost approval={approval} />;`;

const DEMO_GLOB_OUTPUT = `apps/desktop/src/components/pending-approval-card.tsx
apps/desktop/src/components/conversation/approval-preview-demo-gallery.tsx
apps/desktop/src/lib/approval-preview-demo.ts`;

const DEMO_WEB_FETCH_URL = "https://example.com/docs/approval-frames";

const DEMO_WEB_FETCH_OUTPUT = `Approval frame notes

The diff preview frame shows the exact before/after content inside the approval form.

(fetched 12,438 chars, showing an excerpt)`;

const DEMO_DIAGNOSTICS_CLEAN_OUTPUT = "No errors or warnings";

const DEMO_DIAGNOSTICS_ISSUES_OUTPUT = `Diagnostics for apps/desktop/src/components/conversation/conversation-view.tsx (2 shown):
error TS2322: Type 'string' is not assignable to type 'number'.
warning TS6133: 'quoteOrigin' is declared but its value is never read.`;

const DEMO_DIAGNOSTICS_FAILED_OUTPUT =
  "[tool error] diagnostics timed out after 4000 ms waiting for the language server";

const DEMO_TODO_WRITE_AFTER = [
  { title: "Wire approval diff frames into real tool calls", status: "completed" },
  { title: "Promote MCP titles to UI casing", status: "completed" },
  { title: "Audit the remaining tool card surfaces", status: "in_progress" },
] as const;

const DEMO_TODO_WRITE_BEFORE = [
  { title: "Wire approval diff frames into real tool calls", status: "completed" },
  { title: "Promote MCP titles to UI casing", status: "in_progress" },
  { title: "Audit the remaining tool card surfaces", status: "pending" },
] as const;

const DEMO_ASK_QUESTIONS_ARGS = {
  questions: [
    {
      id: "release-strategy",
      title: "Ship the approval frame refresh as one release?",
      options: [
        { id: "ship", label: "Ship it" },
        { id: "split", label: "Split into two releases" },
      ],
    },
    {
      id: "demo-gallery-default",
      title: "Keep the demo gallery visible by default?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
  ],
};

// The runtime answers ask_questions with JSON.stringify of the result (selected option ids).
const DEMO_ASK_QUESTIONS_OUTPUT = JSON.stringify(
  {
    status: "answered",
    answers: [
      { questionId: "release-strategy", selectedOptionIds: ["ship"] },
      { questionId: "demo-gallery-default", selectedOptionIds: ["yes"] },
    ],
  },
  null,
  2,
);

const DEMO_DREAM_LIST_OUTPUT = `demo-dream-rollout    updated 2 days ago    Rollout notes for the preview frames
demo-dream-frames     updated 5 days ago    Approval frame spacing learnings`;

const DEMO_DREAM_READ_OUTPUT = `# Rollout notes for the preview frames

- Delete operations start collapsed.
- Keep the muted detail chrome consistent across cards.`;

const DEMO_FETCH_MCP_RESOURCE_OUTPUT = `- Approval frame notes
- Preview frame rollout`;

const DEMO_CREATE_FILE_PATH = "docs/approval-frame-notes.md";

const DEMO_CREATE_FILE_CONTENT = `# Approval Frame Notes

- The preview frame hugs its content height.
- Delete operations start collapsed.
- Long diffs scroll inside the frame.
`;

const DEMO_EDIT_FILE_PATH = "apps/desktop/src/components/conversation/conversation-view.tsx";

const DEMO_EDIT_FILE_OLD = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >`;

const DEMO_EDIT_FILE_NEW = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm antialiased transition-colors duration-200 ease-out motion-reduce:transition-none data-[drop-target=true]:bg-canvas-hover"
      >`;

const DEMO_DELETE_FILE_PATH = "tmp/approval-preview-scratch.log";

const DEMO_DELETE_FILE_CONTENT = `[12:01:04] render frame ok
[12:01:05] render frame ok
[12:01:06] warn: dropped 2 frames
[12:01:07] render frame ok
`;

const DEMO_APPLY_PATCH_PATH = "apps/desktop/src/components/conversation/conversation-view.tsx";

const DEMO_APPLY_PATCH_DIFF = `@@ 
       data-spirit-surface="conversation-drop-host"
-      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
+      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
*** End Patch`;

const DEMO_APPLY_PATCH_MULTI_HUNK_PATH = "apps/desktop/src/hooks/use-conversation-demo.ts";

const DEMO_APPLY_PATCH_MULTI_HUNK_DIFF = `@@ 
-import { useMemo } from "react";
+import { useMemo, useState } from "react";
 
 import { resolveAlpha } from "@/lib/alpha";
@@   return { rows, summary, beta: resolveBeta
-  return { rows, summary, beta: resolveBeta(input) };
+  return { rows, summary, beta: resolveBeta(input, { strict: true }) };
 }
*** End Patch`;

const DEMO_APPLY_PATCH_BEFORE = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >`;

const DEMO_APPLY_PATCH_AFTER = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >`;

const DEMO_AUTOMATION_TITLE = "Nightly Session Sweep";

const DEMO_AUTOMATION_OVERVIEW = "Archive sessions that have been idle for over a week.";

const DEMO_AUTOMATION_TRIGGER = {
  kind: "time",
  schedule: { kind: "daily", hour: 9, minute: 0 },
};

const DEMO_AUTOMATION_GATEWAY_ARGS = {
  provider: "built-in",
  server: "desktop",
  tool: "create_automation",
  arguments: {
    title: DEMO_AUTOMATION_TITLE,
    overview: DEMO_AUTOMATION_OVERVIEW,
    trigger: DEMO_AUTOMATION_TRIGGER,
    approval_level: "default",
  },
};

const DEMO_AUTOMATION_OUTPUT = `[automation]
action: create_automation
id: auto-demo-nightly-sweep
title: ${DEMO_AUTOMATION_TITLE}
trigger: Daily 09:00
workspace: /workspace/demo-project`;

const DEMO_MCP_GATEWAY_ARGS = {
  provider: "mcp",
  server: "notes",
  tool: "search_notes",
  arguments: { query: "approval preview", limit: 5 },
};

const DEMO_MCP_OUTPUT = JSON.stringify(
  {
    results: [
      { id: "n-42", title: "Approval frame notes" },
      { id: "n-17", title: "Preview frame rollout" },
    ],
  },
  null,
  2,
);

export function buildToolCardPreviewDemoTools(): ToolBlockSnapshot[] {
  return [
    {
      toolCallId: "demo-shell",
      toolName: "shell",
      phase: "succeeded",
      headline: "List workspace files",
      headlineDetail: DEMO_SHELL_COMMAND,
      detailLines: [],
      outputExcerpt: serializeShellToolResult({
        terminal: "zsh",
        workspace: TOOL_CARD_PREVIEW_DEMO_WORKSPACE,
        command: DEMO_SHELL_COMMAND,
        exitCode: 0,
        output: DEMO_SHELL_OUTPUT,
      }),
    },
    {
      toolCallId: "demo-read-file",
      toolName: "read_file",
      phase: "succeeded",
      headline: "Read",
      argsExcerpt: JSON.stringify({ path: DEMO_READ_FILE_PATH }),
      detailLines: [],
      outputExcerpt: DEMO_READ_FILE_CONTENT,
    },
    {
      toolCallId: "demo-ls",
      toolName: "ls",
      phase: "succeeded",
      headline: "Listed",
      headlineDetail: DEMO_LS_PATH,
      detailLines: [],
      outputExcerpt: DEMO_LS_OUTPUT,
    },
    {
      toolCallId: "demo-grep",
      toolName: "grep",
      phase: "succeeded",
      headline: "Searched",
      detailLines: [],
      argsExcerpt: JSON.stringify({ pattern: "useApprovalGate", glob: "apps/**/App.tsx" }),
      outputExcerpt: DEMO_GREP_OUTPUT,
    },
    {
      toolCallId: "demo-glob",
      toolName: "glob",
      phase: "succeeded",
      headline: "Matched",
      headlineDetail: "apps/**/approval-*.ts*",
      detailLines: [],
      outputExcerpt: DEMO_GLOB_OUTPUT,
    },
    {
      toolCallId: "demo-web-fetch",
      toolName: "web_fetch",
      phase: "succeeded",
      headline: "Fetched",
      headlineDetail: DEMO_WEB_FETCH_URL,
      detailLines: [],
      outputExcerpt: DEMO_WEB_FETCH_OUTPUT,
    },
    {
      toolCallId: "demo-diagnostics-clean",
      toolName: "get_diagnostics",
      phase: "succeeded",
      headline: "Checked",
      headlineDetail: "App.tsx",
      detailLines: [],
      outputExcerpt: DEMO_DIAGNOSTICS_CLEAN_OUTPUT,
    },
    {
      toolCallId: "demo-diagnostics-issues",
      toolName: "get_diagnostics",
      phase: "succeeded",
      headline: "Checked",
      headlineDetail: "conversation-view.tsx",
      detailLines: [],
      outputExcerpt: DEMO_DIAGNOSTICS_ISSUES_OUTPUT,
    },
    {
      toolCallId: "demo-diagnostics-failed",
      toolName: "get_diagnostics",
      phase: "failed",
      headline: "Checked",
      headlineDetail: "packages/ui/src",
      detailLines: [],
      outputExcerpt: DEMO_DIAGNOSTICS_FAILED_OUTPUT,
    },
    {
      toolCallId: "demo-todo-write",
      toolName: "todo_write",
      phase: "succeeded",
      headline: "Updated todos",
      detailLines: [],
      argsExcerpt: JSON.stringify({ todos: DEMO_TODO_WRITE_AFTER }),
      todoWriteBeforeTodos: [...DEMO_TODO_WRITE_BEFORE],
      outputExcerpt: JSON.stringify({ todos: DEMO_TODO_WRITE_AFTER }),
    },
    {
      toolCallId: "demo-create-file",
      toolName: "create_file",
      phase: "succeeded",
      headline: "Created",
      headlineDetail: DEMO_CREATE_FILE_PATH,
      editLineDelta: { added: 6, removed: 0 },
      detailLines: [],
      fileToolDiffArgumentsJson: JSON.stringify({
        path: DEMO_CREATE_FILE_PATH,
        content: DEMO_CREATE_FILE_CONTENT,
      }),
      outputExcerpt: `[write]\naction: create_file\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/docs/approval-frame-notes.md\nchars: ${[...DEMO_CREATE_FILE_CONTENT].length}`,
    },
    {
      toolCallId: "demo-edit-file",
      toolName: "edit_file",
      phase: "succeeded",
      headline: "Edited",
      headlineDetail: DEMO_EDIT_FILE_PATH,
      editLineDelta: { added: 1, removed: 1 },
      detailLines: [],
      fileToolDiffArgumentsJson: JSON.stringify({
        path: DEMO_EDIT_FILE_PATH,
        old_text: DEMO_EDIT_FILE_OLD,
        new_text: DEMO_EDIT_FILE_NEW,
      }),
      outputExcerpt: `[write]\naction: edit_file\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/${DEMO_EDIT_FILE_PATH}\nreplaced_once: true\nold_chars: ${[...DEMO_EDIT_FILE_OLD].length}\nnew_chars: ${[...DEMO_EDIT_FILE_NEW].length}`,
    },
    {
      toolCallId: "demo-delete-file",
      toolName: "delete_file",
      phase: "succeeded",
      headline: "Deleted",
      headlineDetail: DEMO_DELETE_FILE_PATH,
      editLineDelta: { added: 0, removed: 4 },
      detailLines: [],
      fileToolDiffArgumentsJson: JSON.stringify({ path: DEMO_DELETE_FILE_PATH }),
      deleteFileBaselineText: DEMO_DELETE_FILE_CONTENT,
      outputExcerpt: `[write]\naction: delete_file\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/tmp/approval-preview-scratch.log`,
    },
    {
      toolCallId: "demo-apply-patch",
      toolName: "apply_patch",
      phase: "succeeded",
      headline: "Edited",
      headlineDetail: DEMO_APPLY_PATCH_PATH,
      editLineDelta: { added: 1, removed: 1 },
      detailLines: [],
      argsExcerpt: JSON.stringify({
        operation: {
          type: "update_file",
          path: DEMO_APPLY_PATCH_PATH,
          diff: DEMO_APPLY_PATCH_DIFF,
        },
      }),
      fileChangeDiff: {
        path: DEMO_APPLY_PATCH_PATH,
        before: DEMO_APPLY_PATCH_BEFORE,
        after: DEMO_APPLY_PATCH_AFTER,
      },
      outputExcerpt: `[write]\naction: apply_patch\noperation: update_file\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/${DEMO_APPLY_PATCH_PATH}\nold_chars: 120\nnew_chars: 140`,
    },
    {
      toolCallId: "demo-apply-patch-multi-hunk",
      toolName: "apply_patch",
      phase: "succeeded",
      headline: "Edited",
      headlineDetail: DEMO_APPLY_PATCH_MULTI_HUNK_PATH,
      editLineDelta: { added: 2, removed: 2 },
      detailLines: [],
      argsExcerpt: JSON.stringify({
        operation: {
          type: "update_file",
          path: DEMO_APPLY_PATCH_MULTI_HUNK_PATH,
          diff: DEMO_APPLY_PATCH_MULTI_HUNK_DIFF,
        },
      }),
      fileChangeDiff: {
        path: DEMO_PATCH_MULTI_HUNK_PATH,
        before: DEMO_PATCH_MULTI_HUNK_ORIGINAL,
        after: DEMO_PATCH_MULTI_HUNK_MODIFIED,
      },
      outputExcerpt: `[write]\naction: apply_patch\noperation: update_file\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/${DEMO_APPLY_PATCH_MULTI_HUNK_PATH}\nold_chars: 480\nnew_chars: 500`,
    },
    {
      toolCallId: "demo-create-automation",
      toolName: "tool_call",
      phase: "succeeded",
      headline: "Created",
      detailLines: [],
      argsExcerpt: JSON.stringify(DEMO_AUTOMATION_GATEWAY_ARGS),
      outputExcerpt: DEMO_AUTOMATION_OUTPUT,
    },
    {
      toolCallId: "demo-mcp",
      toolName: "tool_call",
      phase: "succeeded",
      headline: "Called",
      headlineDetail: formatLazyToolCallDetail("mcp", "notes", "search_notes"),
      detailLines: [],
      argsExcerpt: JSON.stringify(DEMO_MCP_GATEWAY_ARGS),
      outputExcerpt: DEMO_MCP_OUTPUT,
    },
    {
      toolCallId: "demo-ask-questions",
      toolName: "ask_questions",
      phase: "succeeded",
      headline: "Asked",
      headlineDetail: "2 questions",
      detailLines: [],
      argsExcerpt: JSON.stringify(DEMO_ASK_QUESTIONS_ARGS),
      outputExcerpt: DEMO_ASK_QUESTIONS_OUTPUT,
    },
    {
      toolCallId: "demo-fetch-mcp-resource",
      toolName: "fetch_mcp_resource",
      phase: "succeeded",
      headline: "Fetched",
      headlineDetail: "notes / notes://recent",
      detailLines: [],
      argsExcerpt: JSON.stringify({ server: "notes", uri: "notes://recent" }),
      outputExcerpt: DEMO_FETCH_MCP_RESOURCE_OUTPUT,
    },
    {
      toolCallId: "demo-dream-list",
      toolName: "dream_list",
      phase: "succeeded",
      headline: "Listed dreams",
      detailLines: [],
      outputExcerpt: DEMO_DREAM_LIST_OUTPUT,
    },
    {
      toolCallId: "demo-dream-read",
      toolName: "dream_read",
      phase: "succeeded",
      headline: "Read dream",
      headlineDetail: "demo-dream-rollout",
      detailLines: [],
      argsExcerpt: JSON.stringify({ id: "demo-dream-rollout" }),
      outputExcerpt: DEMO_DREAM_READ_OUTPUT,
    },
    {
      toolCallId: "demo-dream-update",
      toolName: "dream_update",
      phase: "succeeded",
      headline: "Updated dream",
      headlineDetail: "demo-dream-rollout",
      detailLines: [],
      argsExcerpt: JSON.stringify({ id: "demo-dream-rollout", content: DEMO_DREAM_READ_OUTPUT }),
      outputExcerpt: "[dream]\naction: dream_update\nid: demo-dream-rollout",
    },
    {
      toolCallId: "demo-dream-delete",
      toolName: "dream_delete",
      phase: "succeeded",
      headline: "Deleted dream",
      headlineDetail: "demo-dream-frames",
      detailLines: [],
      argsExcerpt: JSON.stringify({ id: "demo-dream-frames" }),
      outputExcerpt: "[dream]\naction: dream_delete\nid: demo-dream-frames",
    },
    {
      toolCallId: "demo-dream-record",
      toolName: "dream_record",
      phase: "succeeded",
      headline: "Recorded dream",
      headlineDetail: "Approval frame learnings",
      detailLines: [],
      argsExcerpt: JSON.stringify({
        title: "Approval frame learnings",
        summary: "Delete previews start collapsed; keep detail chrome muted.",
      }),
      outputExcerpt: "[dream]\naction: dream_record\nid: demo-dream-approval-frames",
    },
    {
      // Permanently generating: the running phase keeps the shimmer placeholder up.
      toolCallId: "demo-generate-image-loading",
      toolName: "generate_image",
      phase: "running",
      headline: "Generating",
      detailLines: [],
    },
    {
      toolCallId: "demo-generate-image",
      toolName: "generate_image",
      phase: "succeeded",
      headline: "Generated",
      detailLines: [],
      imagePaths: [`${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/out/approval-frame-mock.png`],
      outputExcerpt: `[media]\naction: generate_image\npath: ${TOOL_CARD_PREVIEW_DEMO_WORKSPACE}/out/approval-frame-mock.png`,
    },
  ];
}
