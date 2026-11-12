import assert from "node:assert/strict";
import { test } from "vitest";

import { parseShellToolResult } from "@spiritagent/agent-core/shell-tool-result";

import { resolveFileToolDiffSource } from "../../src/lib/file-tool-diff-source.ts";
import { resolveAskQuestionsAnswerGroups } from "../../src/lib/ask-questions-display.ts";
import { resolveLazyMcpToolCallInputJson } from "../../src/lib/lazy-mcp-tool-display.ts";
import { resolveTodoToolSnapshotTodos } from "../../src/lib/todo-tool-display.ts";
import i18n from "../../src/lib/i18n.ts";
import { getToolCallSummaryParts } from "../../src/lib/tool-call-display.ts";
import {
  buildToolCardPreviewDemoTools,
  TOOL_CARD_PREVIEW_DEMO_WORKSPACE,
} from "../../src/lib/tool-card-preview-demo.ts";

test("tool card preview demo covers every listed agent tool as a completed card", () => {
  const tools = buildToolCardPreviewDemoTools();

  assert.equal(tools.length, 26);
  assert.deepEqual(
    tools.map((tool) => tool.toolName),
    [
      "shell",
      "read_file",
      "ls",
      "grep",
      "glob",
      "web_fetch",
      "get_diagnostics",
      "get_diagnostics",
      "get_diagnostics",
      "todo_write",
      "create_file",
      "edit_file",
      "delete_file",
      "apply_patch",
      "apply_patch",
      "tool_call",
      "tool_call",
      "ask_questions",
      "fetch_mcp_resource",
      "dream_list",
      "dream_read",
      "dream_update",
      "dream_delete",
      "dream_record",
      "generate_image",
      "generate_image",
    ],
  );
  assert.ok(tools.every((tool) => tool.toolCallId?.startsWith("demo-")));
  assert.equal(
    tools.filter((tool) => tool.phase === "failed").length,
    1,
    "exactly one variant shows the failed phase",
  );
  assert.ok(
    tools.every((tool) => ["succeeded", "failed", "running"].includes(tool.phase)),
    "cards stay in the completed family except the one permanently-generating image card",
  );

  // The shell card carries a real serialized shell result for the expanded terminal output.
  const shell = tools[0];
  const shellResult = parseShellToolResult(shell.outputExcerpt);
  assert.equal(shellResult?.command, "ls -la");
  assert.equal(shellResult?.exitCode, 0);
  assert.ok(shellResult?.output.includes("package.json"));

  // The three get_diagnostics variants exercise all summary result states.
  const [clean, issues, failed] = tools.slice(6, 9);
  assert.deepEqual(getToolCallSummaryParts(clean), {
    headline: i18n.t("tool.diagnosticsCheck", { context: "succeeded" }),
    detail: "App.tsx",
    resultDetail: i18n.t("tool.diagnosticsNoIssues"),
  });
  const issuesParts = getToolCallSummaryParts(issues);
  assert.equal(
    issuesParts.resultDetail,
    i18n.t("tool.diagnosticsIssueCount", { count: 2 }),
    "the header count, not the line count, drives the issues badge",
  );
  const failedParts = getToolCallSummaryParts(failed);
  assert.equal(failedParts.resultDetailTone, "failed");
  assert.equal(
    failedParts.resultDetail,
    "diagnostics timed out after 4000 ms waiting for the language server",
  );

  // todo_write recomputes its delta detail from the frozen before/after payload, and the expanded
  // body resolves the structured after-state list (never the live store).
  const todoParts = getToolCallSummaryParts(tools[9]);
  assert.ok(typeof todoParts.detail === "string" && todoParts.detail.length > 0);
  assert.deepEqual(
    resolveTodoToolSnapshotTodos(tools[9])?.map((item) => item.status),
    ["completed", "completed", "in_progress"],
  );

  // File diff cards carry the full request JSON the real diff view resolves from.
  const createFile = tools[10];
  const createArgs = JSON.parse(createFile.fileToolDiffArgumentsJson ?? "");
  assert.equal(createArgs.path, "docs/approval-frame-notes.md");
  assert.ok(createArgs.content.includes("Approval Frame Notes"));
  assert.deepEqual(createFile.editLineDelta, { added: 6, removed: 0 });

  const editFile = tools[11];
  const editArgs = JSON.parse(editFile.fileToolDiffArgumentsJson ?? "");
  assert.ok(typeof editArgs.old_text === "string" && typeof editArgs.new_text === "string");

  const deleteFile = tools[12];
  assert.ok(deleteFile.deleteFileBaselineText?.includes("render frame ok"));
  assert.deepEqual(deleteFile.editLineDelta, { added: 0, removed: 4 });

  // create_automation rides the built-in lazy gateway shape; MCP rides the mcp shape.
  const automation = tools[15];
  const automationArgs = JSON.parse(automation.argsExcerpt ?? "");
  assert.equal(automationArgs.provider, "built-in");
  assert.equal(automationArgs.server, "desktop");
  assert.equal(automationArgs.tool, "create_automation");
  assert.equal(automationArgs.arguments.title, "Nightly Session Sweep");

  const mcp = tools[16];
  const mcpArgs = JSON.parse(mcp.argsExcerpt ?? "");
  assert.equal(mcpArgs.provider, "mcp");
  assert.equal(mcpArgs.server, "notes");
  assert.equal(mcpArgs.tool, "search_notes");

  // The expanded body resolves the model's arguments as the Input card; built-in lazy calls
  // keep the generic body.
  assert.equal(
    resolveLazyMcpToolCallInputJson(mcp.argsExcerpt),
    '{\n  "query": "approval preview",\n  "limit": 5\n}',
  );
  assert.equal(resolveLazyMcpToolCallInputJson(automation.argsExcerpt), undefined);

  // The second apply_patch card carries a two-hunk patch and the executor's before/after pair;
  // the resolver reads the real pair (whole-file content, real line numbers).
  const multiHunk = tools[14];
  const multiDiff = JSON.parse(multiHunk.argsExcerpt ?? "").operation.diff;
  assert.ok((multiDiff.match(/@@/g) ?? []).length >= 2);
  assert.deepEqual(multiHunk.editLineDelta, { added: 2, removed: 2 });
  assert.ok(multiHunk.fileChangeDiff);
  assert.ok(multiHunk.fileChangeDiff.before.includes('import { useMemo } from "react"'));
  assert.ok(multiHunk.fileChangeDiff.after.includes("useMemo, useState"));
  const resolvedDiff = resolveFileToolDiffSource(multiHunk, { open: true });
  assert.ok(resolvedDiff && typeof resolvedDiff === "object" && "modified" in resolvedDiff);
  assert.equal(resolvedDiff.original, multiHunk.fileChangeDiff.before);
  assert.equal(resolvedDiff.modified, multiHunk.fileChangeDiff.after);

  // The single-hunk card also carries the pair and its badge delta.
  assert.deepEqual(tools[13].editLineDelta, { added: 1, removed: 1 });
  assert.ok(tools[13].fileChangeDiff?.before.includes("flex-col"));
  assert.ok(tools[13].fileChangeDiff?.after.includes("overflow-hidden"));

  // The question card carries its structured questions payload, and the output is the runtime's
  // answered-result JSON (selected option ids, not a human-readable recap). The expanded body
  // resolves both into readable Q/A groups.
  const askQuestions = tools[17];
  assert.equal(JSON.parse(askQuestions.argsExcerpt ?? "").questions.length, 2);
  const askOutput = JSON.parse(askQuestions.outputExcerpt ?? "");
  assert.equal(askOutput.status, "answered");
  assert.deepEqual(askOutput.answers[0], {
    questionId: "release-strategy",
    selectedOptionIds: ["ship"],
  });
  assert.deepEqual(resolveAskQuestionsAnswerGroups(askQuestions), [
    { question: "Ship the approval frame refresh as one release?", answers: ["Ship it"] },
    { question: "Keep the demo gallery visible by default?", answers: ["Yes"] },
  ]);

  // The MCP resource card carries the server + URI pair (offline fixture, no fetch).
  const mcpResource = tools[18];
  assert.deepEqual(JSON.parse(mcpResource.argsExcerpt ?? ""), {
    server: "notes",
    uri: "notes://recent",
  });

  // The generate_image pair: one permanently generating, one with a local image path for the
  // preview + zoom dialog flow.
  const [generating, generated] = tools.slice(24, 26);
  assert.equal(generating.phase, "running");
  assert.equal(generating.imagePaths, undefined);
  assert.equal(generated.phase, "succeeded");
  assert.ok(generated.imagePaths?.[0]?.endsWith(".png"));

  // Every card but read_file and the in-flight image card has expandable content; read_file
  // matches the real one-liner card.
  const hasDetail = (tool) =>
    Boolean(
      tool.outputExcerpt?.trim() ||
      tool.argsExcerpt?.trim() ||
      tool.fileToolDiffArgumentsJson?.trim() ||
      tool.deleteFileBaselineText ||
      tool.imagePaths?.length,
    );
  assert.ok(
    tools
      .filter(
        (tool) =>
          tool.toolName !== "read_file" && tool.toolCallId !== "demo-generate-image-loading",
      )
      .every(hasDetail),
  );

  assert.equal(typeof TOOL_CARD_PREVIEW_DEMO_WORKSPACE, "string");
});
