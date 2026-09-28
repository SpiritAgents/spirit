import assert from "node:assert/strict";
import { test } from "vitest";

import { mergeTaskLayers } from "./merge.js";
import { normalizeTaskFile, type MergedTask, type TaskPlatform } from "./schema.js";

function layeredFileJson(osKey: "windows" | "osx" | "linux"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    command: "cmd-global",
    args: ["arg-global"],
    options: { cwd: "cwd-global", env: { SRC: "global", GLOBAL_ONLY: "g" } },
    [osKey]: { command: "cmd-file-os", options: { cwd: "cwd-file-os" } },
    tasks: [
      {
        label: "t",
        command: "cmd-task",
        args: ["arg-task"],
        options: { env: { SRC: "task" } },
        [osKey]: { options: { cwd: "cwd-task-os", env: { SRC: "task-os", OS_ONLY: "t" } } },
      },
    ],
  };
}

function mergeOne(json: unknown, platform: TaskPlatform, taskIndex = 0): MergedTask {
  const file = normalizeTaskFile(json);
  assert.ok(file);
  const task = file.tasks[taskIndex];
  assert.ok(task);
  return mergeTaskLayers(file, task, platform);
}

function assertLayerPrecedence(platform: TaskPlatform, osKey: "windows" | "osx" | "linux"): void {
  const merged = mergeOne(layeredFileJson(osKey), platform);
  // task beats file-OS and file-global
  assert.equal(merged.command, "cmd-task");
  // task beats file-global (file-OS has no args)
  assert.deepEqual(merged.args, ["arg-task"]);
  // task-OS beats file-OS and file-global
  assert.equal(merged.options?.cwd, "cwd-task-os");
  // env merges across layers with higher layers winning per key
  assert.deepEqual(merged.options?.env, { SRC: "task-os", GLOBAL_ONLY: "g", OS_ONLY: "t" });
}

test("merge precedence file-global < file-OS < task < task-OS on win32 (windows blocks)", () => {
  assertLayerPrecedence("win32", "windows");
});

test("merge precedence file-global < file-OS < task < task-OS on darwin (osx blocks)", () => {
  assertLayerPrecedence("darwin", "osx");
});

test("merge precedence file-global < file-OS < task < task-OS on linux (linux blocks)", () => {
  assertLayerPrecedence("linux", "linux");
});

test("OS blocks of other platforms do not apply", () => {
  const merged = mergeOne(layeredFileJson("windows"), "linux");
  assert.equal(merged.command, "cmd-task");
  assert.equal(merged.options?.cwd, "cwd-global");
  assert.deepEqual(merged.options?.env, { SRC: "task", GLOBAL_ONLY: "g" });
});

test("file-level type and flags act as defaults and task wins", () => {
  const merged = mergeOne(
    {
      schemaVersion: 1,
      type: "process",
      isBackground: true,
      promptOnClose: true,
      tasks: [
        { label: "inherits", command: "a" },
        { label: "overrides", command: "b", type: "shell", isBackground: false },
      ],
    },
    "linux",
  );
  assert.equal(merged.type, "process");
  assert.equal(merged.isBackground, true);
  assert.equal(merged.promptOnClose, true);

  const overrides = mergeOne(
    {
      schemaVersion: 1,
      type: "process",
      isBackground: true,
      tasks: [{ label: "overrides", command: "b", type: "shell", isBackground: false }],
    },
    "linux",
  );
  assert.equal(overrides.type, "shell");
  assert.equal(overrides.isBackground, false);
  assert.equal(overrides.promptOnClose, undefined);
});

test("presentation merges per property and ignores revealProblems", () => {
  const merged = mergeOne(
    {
      schemaVersion: 1,
      presentation: { echo: false, reveal: "never" },
      tasks: [
        {
          label: "t",
          command: "a",
          presentation: { focus: true, revealProblems: "onProblem" },
        },
      ],
    },
    "linux",
  );
  assert.deepEqual(merged.presentation, {
    echo: false,
    reveal: "never",
    focus: true,
  });
});

test("problemMatcher fields at any layer merge away without effect", () => {
  const merged = mergeOne(
    {
      schemaVersion: 1,
      problemMatcher: [],
      linux: { problemMatcher: "$gcc", options: { cwd: "/os" } },
      tasks: [{ label: "t", command: "a", problemMatcher: { owner: "cpp" } }],
    },
    "linux",
  );
  assert.equal(merged.command, "a");
  assert.equal(merged.options?.cwd, "/os");
});
