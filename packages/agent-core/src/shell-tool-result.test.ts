import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildShellToolResult,
  combineShellToolOutput,
  parseShellToolResult,
  serializeShellToolResult,
} from "./shell-tool-result.js";

test("combineShellToolOutput merges stdout and stderr with a newline when needed", () => {
  assert.equal(combineShellToolOutput("a\n", "b"), "a\nb");
  assert.equal(combineShellToolOutput("", "err"), "err");
  assert.equal(combineShellToolOutput("out", ""), "out");
  assert.equal(combineShellToolOutput("", ""), "");
});

test("serializeShellToolResult returns compact JSON for LLM context", () => {
  const json = serializeShellToolResult(
    buildShellToolResult({
      terminal: "Command Prompt (cmd.exe)",
      workspace: "D:\\Spirit",
      command: "echo hello",
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
    }),
  );

  assert.equal(json.includes("\n"), false);
  assert.deepEqual(JSON.parse(json), {
    terminal: "Command Prompt (cmd.exe)",
    workspace: "D:\\Spirit",
    command: "echo hello",
    exitCode: 0,
    output: "hello\n",
  });
});

test("serializeShellToolResult preserves full output without truncation", () => {
  const longOutput = "x".repeat(20);
  const json = serializeShellToolResult(
    buildShellToolResult({
      terminal: "bash",
      workspace: "/tmp",
      command: "cat",
      exitCode: 0,
      stdout: longOutput,
      stderr: "",
    }),
  );

  const parsed = JSON.parse(json) as {
    output: string;
    truncated?: boolean;
  };
  assert.equal(parsed.output, longOutput);
  assert.equal(parsed.truncated, undefined);
});

test("parseShellToolResult rejects legacy human transcript", () => {
  assert.equal(parseShellToolResult("终端      bash\n工作目录  /tmp\n"), null);
});

test("parseShellToolResult round-trips serialized JSON", () => {
  const result = buildShellToolResult({
    terminal: "zsh",
    workspace: "/workspace",
    command: "false",
    exitCode: 1,
    stdout: "",
    stderr: "command failed\n",
  });
  const parsed = parseShellToolResult(serializeShellToolResult(result));
  assert.deepEqual(parsed, result);
});

test("shell results preserve unknown exit codes and the full output file reference", () => {
  const result = {
    terminal: "shell",
    workspace: "/workspace",
    command: "build",
    exitCode: null,
    output: "partial",
    truncated: true,
    outputPath: "/data/background-tasks/output.log",
  };
  assert.deepEqual(parseShellToolResult(serializeShellToolResult(result)), result);
});
