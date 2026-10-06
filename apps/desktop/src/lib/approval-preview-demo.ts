import type {
  PermissionMemoryTarget,
  ToolApprovalFileDiffPreview,
  ToolApprovalRequest,
} from "@spiritagent/agent-core";

import type { PendingQuestionsSnapshot } from "@/types";

/**
 * UI-only demo: one structured approval per tool, mirroring the descriptors the executors
 * produce at runtime (host-internal authorize / the lazy tool gateway), including the
 * `fileDiffPreview` / `fileContentPreview` payloads attached to file approvals. Display strings
 * and preview frames are derived by the same builders the real cards use
 * (`buildApprovalPromptView` and the approval-file-previews mappers), so the demo always
 * matches the real, localized approval cards.
 */
export type ApprovalPreviewDemoEntry = {
  toolName: string;
  approval: ToolApprovalRequest;
  autoReviewBlockReason: string;
  rememberTarget?: PermissionMemoryTarget;
  /** When set, the card renders as a hook-gated approval carrying the structured request. */
  hookMessage?: string;
};

/**
 * The interactive ask_questions demo: two pages — single-select with three options, then
 * multi-select with three options — mirroring the runtime's AskQuestionsRequest shape.
 */
export function buildApprovalPreviewDemoQuestions(): PendingQuestionsSnapshot {
  return {
    toolCallId: "demo-ask-questions-form",
    toolName: "ask_questions",
    request: {
      title: "Demo gallery checks",
      questions: [
        {
          id: "demo-gallery-density",
          title: "How dense should the demo gallery be?",
          allowMultiple: false,
          options: [
            { id: "cozy", label: "Cozy", summary: "One card per tool, current spacing." },
            {
              id: "compact",
              label: "Compact",
              summary: "Tighter gaps so more cards fit per screen.",
            },
            {
              id: "expanded",
              label: "Expanded",
              summary: "Every card starts expanded with its full detail.",
            },
          ],
        },
        {
          id: "demo-gallery-sections",
          title: "Which sections should stay pinned at the top?",
          allowMultiple: true,
          options: [
            {
              id: "file-frames",
              label: "File diff frames",
              summary: "Create / edit / delete / patch cards.",
            },
            { id: "questions", label: "Questions", summary: "This interactive form." },
            { id: "mcp", label: "MCP calls", summary: "Lazy tool_call and resource cards." },
          ],
        },
      ],
    },
  };
}

/** Shared placeholder reason so every demo card previews the blocked-by-auto-review row. */
const DEMO_AUTO_REVIEW_BLOCK_REASON =
  "Auto-review could not prove this call is read-only, so a manual decision is required.";

const DEMO_SHELL_SIMPLE_COMMAND = "cat README.md | head -50";

const DEMO_SHELL_EMBEDDED_COMMAND = `python3 - <<'PY' && node -e "console.log(JSON.stringify({ runtime: 'node', ok: true }))"
import json
print(json.dumps({ "runtime": "python", "ok": True }))
PY`;

const DEMO_CREATE_FILE_PATH = "docs/approval-form-preview-notes.md";

const DEMO_CREATE_FILE_CONTENT = `# Approval Form Preview Notes

- Keep the card chrome consistent across tools.
- Shell commands render with Shiki highlighting.
- File changes render as a diff preview frame.

## Open Questions

- How should the frame handle very wide panes?
- When do multi-file diffs land?
`;

const DEMO_EDIT_FILE_PATH = "apps/desktop/src/components/pending-approval-card.tsx";

const DEMO_EDIT_FILE_ORIGINAL = `      <CardHeader className="gap-2 px-3 py-0">
        <CardTitle className="min-w-0 truncate text-sm leading-tight">
          {pendingApproval.toolName}
        </CardTitle>
      </CardHeader>
`;

const DEMO_EDIT_FILE_MODIFIED = `      <CardHeader className="gap-2 px-3 py-0">
        <CardTitle className="min-w-0 truncate text-sm font-medium leading-tight">
          {pendingApproval.toolName}
        </CardTitle>
      </CardHeader>
`;

const DEMO_DELETE_FILE_PATH = "tmp/approval-preview-scratch.log";

const DEMO_DELETE_FILE_ORIGINAL = `[12:01:04] render frame ok
[12:01:05] render frame ok
[12:01:06] warn: dropped 2 frames
[12:01:07] render frame ok
`;

const DEMO_PATCH_ADD_PATH = "apps/desktop/src/components/conversation/approval-frame-notes.md";

const DEMO_PATCH_ADD_CONTENT = `# Approval Frame Notes

- The preview frame hugs its content height.
- Delete operations start collapsed.
`;

const DEMO_PATCH_UPDATE_PATH = "apps/desktop/src/components/conversation/conversation-view.tsx";

const DEMO_PATCH_UPDATE_ORIGINAL = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >`;

const DEMO_PATCH_UPDATE_MODIFIED = `      <div
        data-spirit-surface="conversation-drop-host"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm antialiased transition-colors duration-200 ease-out motion-reduce:transition-none data-[drop-target=true]:bg-canvas-hover"
      >`;

const DEMO_PATCH_DELETE_PATH =
  "apps/desktop/src/components/conversation/legacy-approval-banner.tsx";

const DEMO_PATCH_DELETE_ORIGINAL = `export function LegacyApprovalBanner() {
  return <div data-legacy="approval-banner" />;
}
`;

export const DEMO_PATCH_MULTI_HUNK_PATH = "apps/desktop/src/hooks/use-conversation-demo.ts";

export const DEMO_PATCH_MULTI_HUNK_ORIGINAL = `import { useMemo } from "react";

import { resolveAlpha } from "@/lib/alpha";
import { resolveBeta } from "@/lib/beta";

export function useConversationDemoState(input: string) {
  const alpha = useMemo(() => resolveAlpha(input), [input]);

  const rows = useMemo(() => {
    const out: string[] = [];
    for (const line of alpha.split("\\n")) {
      out.push(line.trimEnd());
    }
    return out;
  }, [alpha]);

  const summary = useMemo(() => {
    return rows.filter((row) => row.length > 0).join(" · ");
  }, [rows]);

  return { rows, summary, beta: resolveBeta(input) };
}
`;

export const DEMO_PATCH_MULTI_HUNK_MODIFIED = `import { useMemo, useState } from "react";

import { resolveAlpha } from "@/lib/alpha";
import { resolveBeta } from "@/lib/beta";

export function useConversationDemoState(input: string) {
  const alpha = useMemo(() => resolveAlpha(input), [input]);

  const rows = useMemo(() => {
    const out: string[] = [];
    for (const line of alpha.split("\\n")) {
      out.push(line.trimEnd());
    }
    return out;
  }, [alpha]);

  const summary = useMemo(() => {
    return rows.filter((row) => row.length > 0).join(" · ");
  }, [rows]);

  return { rows, summary, beta: resolveBeta(input, { strict: true }) };
}
`;

const DEMO_HOOK_SHELL_COMMAND = "pnpm run build:desktop";

const DEMO_HOOK_MESSAGE =
  "Workspace hook pre-build-guard asks for confirmation before running build commands.";

const DEMO_READ_HOSTS_PATH = "/etc/hosts";

const DEMO_READ_HOSTS_CONTENT = `##
# Host Database
#
# localhost is used to configure the loopback interface
##
127.0.0.1\tlocalhost
255.255.255.255\tbroadcasthost
::1\t\tlocalhost
`;

const DEMO_LS_PATH = "/opt/spirit-tools";

const DEMO_LS_CONTENT = `bin/
share/
CHANGELOG.md
README.md`;

const DEMO_HOOK_READ_PATH = "/var/log/system.log";

const DEMO_HOOK_READ_CONTENT = `[12:01:04] daemon: checkpoint written
[12:01:05] daemon: idle
[12:01:06] daemon: rotating log segment
[12:01:07] daemon: idle
`;

const DEMO_HOOK_READ_MESSAGE =
  "Workspace hook audit-outside-reads asks for confirmation before reading files outside the workspace.";

const DEMO_PLAN_NAME = "approval-form-style-polish";

const DEMO_AUTOMATION_OVERVIEW = `Read the sessions that finished since the last run, summarize what
each one changed, and file a short report in the automation's thread.
Flag sessions that ended with unresolved approval prompts so a human
can sweep them in the morning.`;

const DEMO_PLAN_CONTENT = `# Plan: Approval Form Style Polish

## Background

The approval card used to render file changes as plain text metadata:
a path, plus character counts for the old and new text. Reviewers had to
approve blind, which made the approval gate feel like a formality.

The diff preview frame changes that: every file-changing tool now shows
the exact before/after content inside the approval form, and read
approvals show the file content itself.

## Goals

- Every file approval form renders a preview frame.
- Shell approvals keep the syntax-highlighted command block.
- Hook-gated approvals reuse the same rich forms.
- Delete previews start collapsed; everything else starts expanded.
- Tall content scrolls inside the frame instead of stretching the card.

## Non-Goals

- The conversation tool cards keep their existing diff treatment.
- Ask-questions forms are out of scope.
- No changes to the auto-review model prompts.

## Work Items

### Phase 1: Data Flow

1. Add the file diff preview shape to the approval request contract.
2. Build previews at authorize time in the host tool service.
3. Keep previews plain JSON so they survive the host bridge.
4. Drop previews that exceed the size budget.

### Phase 2: Desktop Rendering

1. Map the structured preview into card render payloads.
2. Render diff frames for create / edit / delete / apply_patch / plan.
3. Render a content frame for out-of-workspace reads.
4. Surface the hook message as its own row on gated approvals.

### Phase 3: Demo Gallery

1. Mirror every descriptor shape in the demo entries.
2. Split apply_patch into one card per operation.
3. Add the create_plan preview example.
4. Add the hook-gated shell example.

## Edge Cases

- The target file vanishes between the tool call and the approval:
  the preview is dropped and the form falls back to the text prompt.
- The patch context no longer matches the file: same fallback.
- Binary or over-sized reads: no content preview, path row stays.
- Empty plan content: the frame renders an empty body.

## Risks

- Large files make the approval payload heavy; the byte budget keeps
  the host bridge responsive but drops the preview entirely.
- A stale preview could show content the executor no longer sees;
  previews are rebuilt at authorize time on every call to avoid this.

## Rollout

- Ship behind the existing approval form; no feature flag needed.
- The demo gallery remains a developer settings toggle.
- CLI and ACP keep their text-only approval rendering for now.

## Verification

- Unit tests for the preview builder cover every tool kind.
- Snapshot mapper tests cover the delete-collapse rule.
- The demo gallery renders every form without a model call.
- Long content stays inside the frame's capped height.

## Appendix: Frame Behavior

| Operation | Default state | Content shown |
| --------- | ------------- | ------------- |
| create    | expanded      | new content   |
| update    | expanded      | before/after  |
| delete    | collapsed     | doomed file   |
| read      | expanded      | file content  |

Tables render as plain rows inside the frame; the gutter keeps line
numbers aligned on the left edge of the content column.

Final review pass: open the demo gallery, toggle every frame closed
and open again, and confirm the card height stays stable while the
list scrolls.

## Follow-Ups

- Word-wrap toggle for long lines in the frame.
- Line-count cap for read previews, on top of the byte budget.
- Multi-file patch envelopes if the tool contract ever grows them.
- Sidebar deep link from a plan chip to its preview frame.
- Localized line-count badge in the frame header for reads.
`;

function demoFileDiffPreview(
  path: string,
  original: string,
  modified: string,
  operation: ToolApprovalFileDiffPreview["operation"],
): ToolApprovalFileDiffPreview {
  return { path, original, modified, operation };
}

export function buildApprovalPreviewDemoEntries(): ApprovalPreviewDemoEntry[] {
  return [
    {
      toolName: "shell",
      approval: {
        kind: "shell",
        command: DEMO_SHELL_SIMPLE_COMMAND,
        reason: "Preview the top of the README",
        terminal: "zsh",
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
      rememberTarget: { kind: "shell", command: DEMO_SHELL_SIMPLE_COMMAND },
    },
    {
      toolName: "shell",
      approval: {
        kind: "shell",
        command: DEMO_SHELL_EMBEDDED_COMMAND,
        reason: "Compare JSON output across runtimes",
        terminal: "zsh",
      },
      autoReviewBlockReason:
        "Auto-review could not confirm the heredoc boundary handling in this compound command: it embeds a Python script and pipes its output into a Node process, and the reviewer could not prove that no workspace file is modified or sent out along the way, so a manual decision is required.",
      rememberTarget: { kind: "shell", command: DEMO_SHELL_EMBEDDED_COMMAND },
    },
    {
      toolName: "shell",
      approval: {
        kind: "shell",
        command: DEMO_HOOK_SHELL_COMMAND,
        reason: "Verify the desktop build",
        terminal: "zsh",
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
      rememberTarget: { kind: "shell", command: DEMO_HOOK_SHELL_COMMAND },
      hookMessage: DEMO_HOOK_MESSAGE,
    },
    {
      toolName: "create_file",
      approval: {
        kind: "create_file",
        path: DEMO_CREATE_FILE_PATH,
        contentChars: [...DEMO_CREATE_FILE_CONTENT].length,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_CREATE_FILE_PATH,
          "",
          DEMO_CREATE_FILE_CONTENT,
          "create",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "edit_file",
      approval: {
        kind: "edit_file",
        path: DEMO_EDIT_FILE_PATH,
        oldChars: [...DEMO_EDIT_FILE_ORIGINAL].length,
        newChars: [...DEMO_EDIT_FILE_MODIFIED].length,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_EDIT_FILE_PATH,
          DEMO_EDIT_FILE_ORIGINAL,
          DEMO_EDIT_FILE_MODIFIED,
          "update",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "delete_file",
      approval: {
        kind: "delete_file",
        path: DEMO_DELETE_FILE_PATH,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_DELETE_FILE_PATH,
          DEMO_DELETE_FILE_ORIGINAL,
          "",
          "delete",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "apply_patch",
      approval: {
        kind: "apply_patch",
        operation: "create_file",
        path: DEMO_PATCH_ADD_PATH,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_PATCH_ADD_PATH,
          "",
          DEMO_PATCH_ADD_CONTENT,
          "create",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "apply_patch",
      approval: {
        kind: "apply_patch",
        operation: "update_file",
        path: DEMO_PATCH_UPDATE_PATH,
        diffLines: DEMO_PATCH_UPDATE_MODIFIED.split("\n").length,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_PATCH_UPDATE_PATH,
          DEMO_PATCH_UPDATE_ORIGINAL,
          DEMO_PATCH_UPDATE_MODIFIED,
          "update",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "apply_patch",
      approval: {
        kind: "apply_patch",
        operation: "update_file",
        path: DEMO_PATCH_MULTI_HUNK_PATH,
        diffLines: 14,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_PATCH_MULTI_HUNK_PATH,
          DEMO_PATCH_MULTI_HUNK_ORIGINAL,
          DEMO_PATCH_MULTI_HUNK_MODIFIED,
          "update",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "apply_patch",
      approval: {
        kind: "apply_patch",
        operation: "delete_file",
        path: DEMO_PATCH_DELETE_PATH,
        fileDiffPreview: demoFileDiffPreview(
          DEMO_PATCH_DELETE_PATH,
          DEMO_PATCH_DELETE_ORIGINAL,
          "",
          "delete",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "create_plan",
      approval: {
        kind: "create_plan",
        planName: DEMO_PLAN_NAME,
        contentChars: [...DEMO_PLAN_CONTENT].length,
        fileDiffPreview: demoFileDiffPreview(
          `plans/${DEMO_PLAN_NAME}.md`,
          "",
          DEMO_PLAN_CONTENT,
          "create",
        ),
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "create_automation",
      approval: {
        kind: "create_automation",
        title: "Nightly Session Sweep",
        trigger: { kind: "time", schedule: { kind: "daily", hour: 9, minute: 0 } },
        approvalLevel: "default",
        overview: DEMO_AUTOMATION_OVERVIEW,
        overviewChars: [...DEMO_AUTOMATION_OVERVIEW].length,
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "create_automation",
      approval: {
        kind: "create_automation",
        title: "PR Tracker",
        trigger: {
          kind: "github",
          owner: "SpiritAgents",
          repo: "spirit",
          event: "pull_request_created",
        },
        approvalLevel: "auto-approval",
        overview: DEMO_AUTOMATION_OVERVIEW,
        overviewChars: [...DEMO_AUTOMATION_OVERVIEW].length,
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "web_fetch",
      approval: { kind: "web_fetch", url: "https://github.com/SpiritAgents/spirit/releases" },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
    {
      toolName: "ls",
      approval: {
        kind: "read_path",
        operation: "ls",
        path: DEMO_LS_PATH,
        workspaceExternal: true,
        fileContentPreview: { path: DEMO_LS_PATH, content: DEMO_LS_CONTENT },
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
      rememberTarget: { kind: "read_file", path: DEMO_LS_PATH },
    },
    {
      toolName: "read_file",
      approval: {
        kind: "read_path",
        operation: "read_file",
        path: DEMO_READ_HOSTS_PATH,
        workspaceExternal: true,
        fileContentPreview: { path: DEMO_READ_HOSTS_PATH, content: DEMO_READ_HOSTS_CONTENT },
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
      rememberTarget: { kind: "read_file", path: DEMO_READ_HOSTS_PATH },
    },
    {
      toolName: "read_file",
      approval: {
        kind: "read_path",
        operation: "read_file",
        path: DEMO_HOOK_READ_PATH,
        workspaceExternal: true,
        fileContentPreview: { path: DEMO_HOOK_READ_PATH, content: DEMO_HOOK_READ_CONTENT },
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
      rememberTarget: { kind: "read_file", path: DEMO_HOOK_READ_PATH },
      hookMessage: DEMO_HOOK_READ_MESSAGE,
    },
    {
      toolName: "tool_call",
      approval: {
        kind: "lazy_tool_call",
        provider: "mcp",
        server: "notes",
        tool: "search_notes",
        arguments: { query: "approval preview", limit: 5 },
      },
      autoReviewBlockReason: DEMO_AUTO_REVIEW_BLOCK_REASON,
    },
  ];
}
