import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeTaskEntry, normalizeTaskFile } from "./schema.js";

test("normalizeTaskEntry parses a fully specified task", () => {
  const task = normalizeTaskEntry({
    label: "build",
    type: "process",
    command: { value: "make", quoting: "escape" },
    args: ["all", { value: "fast", quoting: "weak" }, 42],
    quoting: "weak",
    options: {
      cwd: "/repo",
      env: { MODE: "fast", COUNT: 3 },
      shell: { executable: "/bin/zsh", args: ["-l", 7] },
    },
    isBackground: true,
    promptOnClose: true,
    dependsOn: ["prep", { type: "shell" }],
    dependsOrder: "sequence",
    runOptions: {
      reevaluateOnRerun: false,
      runOn: "folderOpen",
      instanceLimit: 2,
      instancePolicy: "warn",
    },
    presentation: {
      echo: false,
      reveal: "silent",
      focus: true,
      panel: "dedicated",
      clear: true,
      close: true,
      preserveTerminalName: true,
      revealProblems: "onProblem",
      showReuseMessage: true,
      group: "term-group",
    },
    icon: { id: "gear", color: "terminal.ansiRed" },
    detail: "Builds everything",
    hide: true,
    problemMatcher: "$gcc",
    group: "build",
  });
  assert.ok(task);
  assert.equal(task.label, "build");
  assert.equal(task.type, "process");
  assert.deepEqual(task.command, { value: "make", quoting: "escape" });
  assert.deepEqual(task.args, ["all", { value: "fast", quoting: "weak" }]);
  assert.equal(task.quoting, "weak");
  assert.deepEqual(task.options, {
    cwd: "/repo",
    env: { MODE: "fast" },
    shell: { executable: "/bin/zsh", args: ["-l"] },
  });
  assert.equal(task.isBackground, true);
  assert.equal(task.promptOnClose, true);
  assert.deepEqual(task.dependsOn, { labels: ["prep"], hasObjectForm: true });
  assert.equal(task.dependsOrder, "sequence");
  assert.deepEqual(task.runOptions, {
    reevaluateOnRerun: false,
    runOn: "folderOpen",
    instanceLimit: 2,
    instancePolicy: "warn",
  });
  assert.deepEqual(task.presentation, {
    echo: false,
    reveal: "silent",
    focus: true,
    panel: "dedicated",
    clear: true,
    close: true,
    preserveTerminalName: true,
  });
  assert.equal(task.iconId, "gear");
  assert.equal(task.detail, "Builds everything");
  assert.equal(task.hide, true);
  // problemMatcher and presentation.revealProblems are tolerated but never carried.
  assert.equal("hasProblemMatcher" in task, false);
  assert.equal("hasRevealProblems" in task.presentation, false);
});

test("normalizeTaskEntry skips items with a missing or empty label", () => {
  assert.equal(normalizeTaskEntry({ command: "make" }), undefined);
  assert.equal(normalizeTaskEntry({ label: "   ", command: "make" }), undefined);
  assert.equal(normalizeTaskEntry("build"), undefined);
  assert.equal(normalizeTaskEntry(null), undefined);
});

test("normalizeTaskEntry ignores extension-customized type entries", () => {
  assert.equal(normalizeTaskEntry({ label: "npm task", type: "npm", command: "run" }), undefined);
  assert.equal(normalizeTaskEntry({ label: "grunt", type: "grunt" }), undefined);
  const shell = normalizeTaskEntry({ label: "a", type: "shell" });
  assert.equal(shell?.type, "shell");
  const processTask = normalizeTaskEntry({ label: "b", type: "process" });
  assert.equal(processTask?.type, "process");
  const garbage = normalizeTaskEntry({ label: "c", type: 42 });
  assert.equal(garbage?.type, undefined);
});

test("normalizeTaskEntry normalizes command forms", () => {
  assert.equal(normalizeTaskEntry({ label: "a", command: "make" })?.command, "make");
  assert.deepEqual(normalizeTaskEntry({ label: "a", command: ["make", "all"] })?.command, [
    "make",
    "all",
  ]);
  assert.deepEqual(normalizeTaskEntry({ label: "a", command: { value: "make" } })?.command, {
    value: "make",
    quoting: "strong",
  });
  assert.equal(normalizeTaskEntry({ label: "a", command: "" })?.command, undefined);
  assert.equal(normalizeTaskEntry({ label: "a", command: [] })?.command, undefined);
  assert.equal(normalizeTaskEntry({ label: "a", command: 42 })?.command, undefined);
});

test("normalizeTaskEntry defaults invalid quoting to strong", () => {
  const task = normalizeTaskEntry({ label: "a", quoting: "bogus" });
  assert.equal(task?.quoting, "strong");
  const command = normalizeTaskEntry({
    label: "b",
    command: { value: "make", quoting: "bogus" },
  })?.command;
  assert.deepEqual(command, { value: "make", quoting: "strong" });
});

test("normalizeTaskEntry parses dependsOn forms", () => {
  assert.deepEqual(normalizeTaskEntry({ label: "a", dependsOn: "prep" })?.dependsOn, {
    labels: ["prep"],
    hasObjectForm: false,
  });
  assert.deepEqual(normalizeTaskEntry({ label: "a", dependsOn: ["one", "two"] })?.dependsOn, {
    labels: ["one", "two"],
    hasObjectForm: false,
  });
  assert.deepEqual(normalizeTaskEntry({ label: "a", dependsOn: { type: "shell" } })?.dependsOn, {
    labels: [],
    hasObjectForm: true,
  });
  assert.deepEqual(normalizeTaskEntry({ label: "a" })?.dependsOn, {
    labels: [],
    hasObjectForm: false,
  });
});

test("normalizeTaskEntry applies runOptions defaults and rejects invalid values", () => {
  assert.deepEqual(normalizeTaskEntry({ label: "a" })?.runOptions, {
    reevaluateOnRerun: true,
    runOn: "default",
    instanceLimit: 1,
    instancePolicy: "prompt",
  });
  assert.deepEqual(
    normalizeTaskEntry({
      label: "a",
      runOptions: { runOn: "bogus", instanceLimit: 0, instancePolicy: "bogus" },
    })?.runOptions,
    {
      reevaluateOnRerun: true,
      runOn: "default",
      instanceLimit: 1,
      instancePolicy: "prompt",
    },
  );
});

test("normalizeTaskEntry maps OS blocks to platforms and ignores block problemMatchers", () => {
  const task = normalizeTaskEntry({
    label: "a",
    command: "make",
    windows: { command: "build.cmd", args: ["/c"] },
    osx: { options: { cwd: "/mac" }, problemMatcher: [] },
    linux: { options: { env: { OS: "linux" } } },
  });
  assert.ok(task);
  assert.deepEqual(task.os.win32, { command: "build.cmd", args: ["/c"] });
  assert.deepEqual(task.os.darwin, {
    options: { cwd: "/mac" },
  });
  assert.deepEqual(task.os.linux, {
    options: { env: { OS: "linux" } },
  });
});

test("normalizeTaskFile keeps only supported file-level defaults", () => {
  const file = normalizeTaskFile({
    schemaVersion: 1,
    type: "process",
    command: "global-command",
    args: ["global-arg"],
    options: { cwd: "/global" },
    isBackground: true,
    promptOnClose: true,
    presentation: { reveal: "never" },
    problemMatcher: "$gcc",
    group: "build",
    dependsOn: "ignored",
    runOptions: { instanceLimit: 9 },
    hide: true,
    detail: "ignored",
    inputs: [{ id: "x" }],
    windows: { command: "global-windows" },
    tasks: [{ label: "a" }],
  });
  assert.ok(file);
  assert.deepEqual(file.defaults, {
    type: "process",
    command: "global-command",
    args: ["global-arg"],
    options: { cwd: "/global" },
    isBackground: true,
    promptOnClose: true,
    presentation: { reveal: "never" },
  });
  assert.deepEqual(file.osDefaults.win32, {
    command: "global-windows",
  });
  assert.equal(file.tasks.length, 1);
});

test("normalizeTaskFile drops invalid entries but keeps valid siblings", () => {
  const file = normalizeTaskFile({
    schemaVersion: 1,
    tasks: ["junk", { command: "no-label" }, { label: "ok", command: "make" }],
  });
  assert.ok(file);
  assert.deepEqual(
    file.tasks.map((task) => task.label),
    ["ok"],
  );
});

test("normalizeTaskFile returns undefined for non-object input and empty tasks otherwise", () => {
  assert.equal(normalizeTaskFile("junk"), undefined);
  assert.equal(normalizeTaskFile([1, 2]), undefined);
  const file = normalizeTaskFile({ schemaVersion: 1 });
  assert.ok(file);
  assert.deepEqual(file.tasks, []);
});
