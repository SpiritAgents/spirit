import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import i18n from "../../src/lib/i18n.ts";
import {
  appendBackgroundTaskOutput,
  backgroundTaskNotificationTool,
} from "../../src/lib/background-task-display.ts";
import {
  formatToolCallSummaryPlainText,
  getToolCallSummaryParts,
  toolHasExpandableContent,
} from "../../src/lib/tool-call-display.ts";

const task = {
  version: 1,
  id: "task_0123456789ab",
  sessionKey: "fixture",
  runtimeId: "main",
  toolCallId: "call-shell",
  kind: "shell",
  input: "echo done",
  argumentsJson: '{"command":"echo done"}',
  owner: { id: "fixture", pid: 1 },
  status: "completed",
  background: true,
  outputPath: "/session/background-tasks/shell-task_0123456789ab.log",
  startedAtUnixMs: 100,
  updatedAtUnixMs: 300,
  endedAtUnixMs: 300,
  elapsedMs: 200,
  exitCode: 0,
  terminalEventId: "task_0123456789ab:completed",
};
const makeTool = (overrides = {}) =>
  backgroundTaskNotificationTool(
    {
      task: { ...task, ...overrides },
      content: "Model notification",
      restored: false,
      output: { text: "done\n", truncated: false },
    },
    (key, options) => i18n.t(key, options),
  );

afterEach(() => i18n.changeLanguage("en"));

test("notifications retranslate statuses without appending a misleading Failed suffix", async () => {
  await i18n.changeLanguage("en");
  for (const [status, label] of [
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["stopped", "Stopped"],
    ["interrupted", "Interrupted"],
  ]) {
    const tool = makeTool({ status, exitCode: undefined });
    assert.equal(getToolCallSummaryParts(tool).headline, `Shell ${label}`);
    assert.equal(formatToolCallSummaryPlainText(tool), `Shell ${label} echo done`);
    assert.equal(toolHasExpandableContent(tool), true);
  }
  const tool = makeTool();
  await i18n.changeLanguage("zh-CN");
  assert.equal(getToolCallSummaryParts(tool).headline, "Shell 已完成");
});

test("subagent notice uses the final reply, not progress, and keeps the original navigation ID", async () => {
  await i18n.changeLanguage("en");
  const tool = makeTool({
    kind: "subagent",
    finalOutputPreview: "**Done** with `src/entry.ts`.\n\n[Details](https://example.invalid)",
    sessionId: "child",
    sessionTranscript: "/session/child/transcript.json",
  });
  assert.equal(getToolCallSummaryParts(tool).detail, "Done with src/entry.ts. Details");
  assert.equal(toolHasExpandableContent(tool), false);
  assert.equal(tool.backgroundTask.toolCallId, "call-shell");
  assert.equal(tool.taskNotification.origin, "background-task");
});

test("streaming preview stays bounded and marks truncation explicitly", () => {
  const tool = makeTool();
  const preview = appendBackgroundTaskOutput(tool, "a".repeat(20_000));
  assert.equal(preview.text.length, 16_384);
  assert.equal(preview.truncated, true);
});

test("Read labels classify only task output paths and preserve line ranges", async () => {
  await i18n.changeLanguage("en");
  for (const [path, label] of [
    [task.outputPath, "Shell Output"],
    ["C:\\session\\background-tasks\\subagent-task_0123456789ab.md", "Subagent Output"],
  ]) {
    const parts = getToolCallSummaryParts({
      toolName: "read_file",
      phase: "succeeded",
      headline: "Read",
      detailLines: [],
      argsExcerpt: JSON.stringify({ path }),
    });
    assert.equal(parts.detail, label);
  }
});
