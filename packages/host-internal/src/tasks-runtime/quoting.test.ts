import assert from "node:assert/strict";
import { test } from "vitest";

import type { ResolvedTask } from "../tasks/public.js";
import { buildShellCommandLine, buildTaskInvocation } from "./quoting.js";

const DEFAULT_SHELL = { executable: "/bin/sh", args: ["-c"] };

function makeTask(overrides: Partial<ResolvedTask>): ResolvedTask {
  return {
    key: "/repo/.spirit/tasks.json#task",
    sourceFile: "/repo/.spirit/tasks.json",
    label: "task",
    hide: false,
    type: "shell",
    command: "echo hi",
    args: [],
    quoting: "strong",
    options: {},
    isBackground: false,
    promptOnClose: false,
    dependsOn: [],
    dependsOrder: "parallel",
    runOptions: { reevaluateOnRerun: true, instanceLimit: 1 },
    presentation: {
      echo: true,
      reveal: "always",
      focus: false,
      panel: "shared",
      clear: false,
      close: false,
      preserveTerminalName: false,
    },
    ...overrides,
  };
}

test("strong quoting wraps only when needed and escapes inner double quotes", () => {
  assert.equal(buildShellCommandLine("make", []), "make");
  assert.equal(buildShellCommandLine({ value: "make all", quoting: "strong" }, []), '"make all"');
  assert.equal(
    buildShellCommandLine({ value: 'say "hi"', quoting: "strong" }, []),
    '"say \\"hi\\""',
  );
  assert.equal(buildShellCommandLine({ value: "", quoting: "strong" }, []), '""');
});

test("weak quoting uses single quotes and the POSIX escaped-quote idiom", () => {
  assert.equal(buildShellCommandLine({ value: "make all", quoting: "weak" }, []), "'make all'");
  assert.equal(buildShellCommandLine({ value: "don't", quoting: "weak" }, []), "'don'\\''t'");
  assert.equal(buildShellCommandLine({ value: "", quoting: "weak" }, []), "''");
});

test("escape quoting backslashes whitespace and quote chars without wrapping", () => {
  assert.equal(buildShellCommandLine({ value: "make all", quoting: "escape" }, []), "make\\ all");
  assert.equal(
    buildShellCommandLine({ value: 'say "hi"', quoting: "escape" }, []),
    'say\\ \\"hi\\"',
  );
  assert.equal(buildShellCommandLine({ value: "plain", quoting: "escape" }, []), "plain");
  assert.equal(buildShellCommandLine({ value: "", quoting: "escape" }, []), '""');
});

test("plain-string commands pass to the shell verbatim, shell syntax included", () => {
  assert.equal(buildShellCommandLine("sleep 60", []), "sleep 60");
  assert.equal(buildShellCommandLine("exit 1", []), "exit 1");
  assert.equal(buildShellCommandLine("echo hello > out.txt", []), "echo hello > out.txt");
  assert.equal(buildShellCommandLine("a | b", []), "a | b");
});

test("plain-string args still default to strong quoting", () => {
  assert.equal(buildShellCommandLine("make", ["build dir", "all"]), 'make "build dir" all');
});

test("string array command joins its elements verbatim with a single space", () => {
  assert.equal(buildShellCommandLine(["make", "build dir"], ["all"]), "make build dir all");
});

test("mixed arg forms apply per-arg quoting", () => {
  assert.equal(
    buildShellCommandLine("run", [
      "plain",
      { value: "has space", quoting: "weak" },
      { value: "tab\there", quoting: "escape" },
      "",
    ]),
    "run plain 'has space' tab\\\there \"\"",
  );
});

test("process invocation passes raw argv and ignores quoting objects", () => {
  const task = makeTask({
    type: "process",
    command: { value: "my tool", quoting: "strong" },
    args: ["--flag", { value: "some value", quoting: "weak" }],
  });
  assert.deepEqual(buildTaskInvocation(task, DEFAULT_SHELL), {
    file: "my tool",
    args: ["--flag", "some value"],
  });
});

test("process invocation splits string array command into file plus leading args", () => {
  const task = makeTask({ type: "process", command: ["node", "--inspect"], args: ["app.js"] });
  assert.deepEqual(buildTaskInvocation(task, DEFAULT_SHELL), {
    file: "node",
    args: ["--inspect", "app.js"],
  });
});

test("shell invocation uses the default shell and appends one command-line arg", () => {
  const task = makeTask({ command: "make", args: ["all"] });
  assert.deepEqual(buildTaskInvocation(task, DEFAULT_SHELL), {
    file: "/bin/sh",
    args: ["-c", "make all"],
  });
});

test("shell invocation honors a full options.shell override", () => {
  const task = makeTask({
    command: "make",
    options: { shell: { executable: "/bin/zsh", args: ["-l", "-c"] } },
  });
  assert.deepEqual(buildTaskInvocation(task, DEFAULT_SHELL), {
    file: "/bin/zsh",
    args: ["-l", "-c", "make"],
  });
});

test("shell invocation falls back per field to the default shell", () => {
  const task = makeTask({
    command: "make",
    options: { shell: { args: ["-x"] } },
  });
  assert.deepEqual(buildTaskInvocation(task, DEFAULT_SHELL), {
    file: "/bin/sh",
    args: ["-x", "make"],
  });
});
