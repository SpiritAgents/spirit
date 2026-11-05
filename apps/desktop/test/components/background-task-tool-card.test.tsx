/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import type { BackgroundTaskRecord } from "@spiritagent/agent-core";

import { MinimalToolCallCard } from "@/components/minimal-tool-call-card";
import i18n from "@/lib/i18n";
import type { ToolBlockSnapshot } from "@/types";

vi.mock("@/components/shell-tool-xterm-output", () => ({
  ShellToolXtermOutput: ({ text }: { text: string }) => <pre>{text}</pre>,
}));

vi.mock("@/components/shell-tool-command-highlight", () => ({
  ShellToolCommandHighlight: ({ command }: { command: string }) => <span>{command}</span>,
  JsonToolArgumentsHighlight: ({ argumentsJson }: { argumentsJson: string }) => (
    <pre>{argumentsJson}</pre>
  ),
}));

const task: BackgroundTaskRecord = {
  version: 1,
  id: "task_0123456789ab",
  sessionKey: "fixture",
  runtimeId: "main",
  toolCallId: "call-shell",
  kind: "shell",
  input: "echo done",
  argumentsJson: JSON.stringify({ command: "echo done", reason: "Run a task" }),
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

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

test("expanded background Shell output omits task IDs, exit codes, and output paths", async () => {
  const tool: ToolBlockSnapshot = {
    toolCallId: task.toolCallId,
    toolName: "shell",
    phase: "succeeded",
    headline: "Ran Run a task",
    headlineDetail: task.input,
    detailLines: [],
    argsExcerpt: task.argumentsJson,
    backgroundTask: task,
    backgroundTaskOutput: { text: "done\n", truncated: false },
  };
  render(<MinimalToolCallCard tool={tool} onOpenReadFile={() => {}} />);

  fireEvent.click(screen.getByRole("button", { expanded: false }));

  expect(await screen.findByText("done")).toBeTruthy();
  expect(screen.queryByText(new RegExp(task.id))).toBeNull();
  expect(screen.queryByText(/Exit Code/u)).toBeNull();
  expect(screen.queryByText(task.outputPath)).toBeNull();
});
