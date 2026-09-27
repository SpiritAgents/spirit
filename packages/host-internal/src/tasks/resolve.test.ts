import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveWorkspaceTasks } from "./resolve.js";
import type { LoadedTaskFile, TaskFileSourceKind, TaskPlatform } from "./schema.js";
import type { TaskVariableContext } from "./variables.js";

const CONTEXT: TaskVariableContext = {
  workspaceFolder: "/ws",
  cwd: "/ws",
  userHome: "/home/user",
  env: { TOKEN: "secret" },
  pathSeparator: "/",
};

function loaded(path: string, sourceKind: TaskFileSourceKind, json: unknown): LoadedTaskFile {
  return { path, sourceKind, json };
}

function spiritJson(tasks: unknown[], extra: Record<string, unknown> = {}): LoadedTaskFile {
  return loaded("/repo/.spirit/tasks.json", "workspace", { schemaVersion: 1, ...extra, tasks });
}

function vscodeJson(tasks: unknown[], extra: Record<string, unknown> = {}): LoadedTaskFile {
  return loaded("/repo/.vscode/tasks.json", "vscode-compat", {
    version: "2.0.0",
    ...extra,
    tasks,
  });
}

function resolve(
  files: LoadedTaskFile[],
  context: TaskVariableContext = CONTEXT,
  platform: TaskPlatform = "linux",
) {
  return resolveWorkspaceTasks({ files, variableContext: context, platform });
}

test("resolves a fully specified task into the run spec", () => {
  const result = resolve([
    spiritJson([
      {
        label: "build",
        type: "process",
        command: { value: "make", quoting: "escape" },
        args: ["all", { value: "fast", quoting: "weak" }],
        options: {
          cwd: "/repo",
          env: { MODE: "fast" },
          shell: { executable: "/bin/zsh", args: ["-l"] },
        },
        isBackground: true,
        promptOnClose: true,
        dependsOn: ["prep"],
        dependsOrder: "sequence",
        runOptions: { reevaluateOnRerun: false, instanceLimit: 3 },
        presentation: {
          echo: false,
          reveal: "silent",
          focus: true,
          panel: "dedicated",
          clear: true,
          close: true,
          preserveTerminalName: true,
        },
        icon: { id: "gear" },
        detail: "Builds everything",
      },
      { label: "prep", command: "echo hi" },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, []);
  assert.equal(result.tasks.length, 2);

  const build = result.tasks[0]!;
  assert.equal(build.key, "/repo/.spirit/tasks.json#build");
  assert.equal(build.sourceFile, "/repo/.spirit/tasks.json");
  assert.equal(build.label, "build");
  assert.equal(build.detail, "Builds everything");
  assert.equal(build.iconId, "gear");
  assert.equal(build.hide, false);
  assert.equal(build.type, "process");
  assert.deepEqual(build.command, { value: "make", quoting: "escape" });
  assert.deepEqual(build.args, ["all", { value: "fast", quoting: "weak" }]);
  assert.equal(build.quoting, "strong");
  assert.deepEqual(build.options, {
    cwd: "/repo",
    env: { MODE: "fast" },
    shell: { executable: "/bin/zsh", args: ["-l"] },
  });
  assert.equal(build.isBackground, true);
  assert.equal(build.promptOnClose, true);
  assert.deepEqual(build.dependsOn, ["prep"]);
  assert.equal(build.dependsOrder, "sequence");
  assert.deepEqual(build.runOptions, { reevaluateOnRerun: false, instanceLimit: 3 });
  assert.deepEqual(build.presentation, {
    echo: false,
    reveal: "silent",
    focus: true,
    panel: "dedicated",
    clear: true,
    close: true,
    preserveTerminalName: true,
  });

  const prep = result.tasks[1]!;
  assert.equal(prep.command, "echo hi");
  assert.deepEqual(prep.args, []);
  assert.deepEqual(prep.options, {});
  assert.equal(prep.isBackground, false);
  assert.equal(prep.promptOnClose, false);
  assert.deepEqual(prep.runOptions, { reevaluateOnRerun: true, instanceLimit: 1 });
  assert.deepEqual(prep.presentation, {
    echo: true,
    reveal: "always",
    focus: false,
    panel: "shared",
    clear: false,
    close: false,
    preserveTerminalName: false,
  });

  assert.deepEqual(result.menuItems, [
    {
      key: "/repo/.spirit/tasks.json#build",
      label: "build",
      detail: "Builds everything",
      iconId: "gear",
    },
    { key: "/repo/.spirit/tasks.json#prep", label: "prep" },
  ]);
});

test("hide flag excludes from the menu but keeps the task runnable via dependsOn", () => {
  const result = resolve([
    spiritJson([
      { label: "hidden-helper", command: "echo helper", hide: true },
      { label: "main", command: "echo main", dependsOn: ["hidden-helper"] },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, []);
  assert.deepEqual(
    result.tasks.map((task) => task.label),
    ["hidden-helper", "main"],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["main"],
  );
  assert.equal(result.tasks[0]!.hide, true);
});

test("skips label-less items entirely without hiding siblings", () => {
  const result = resolve([
    spiritJson([
      { command: "no-label" },
      { label: "  ", command: "blank-label" },
      { label: "ok", command: "echo ok" },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, []);
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["ok"],
  );
});

test("ignores extension-customized entries entirely without hiding siblings", () => {
  const result = resolve([
    vscodeJson([
      { label: "npm-test", type: "npm", script: "test" },
      { label: "plain", command: "echo ok" },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, []);
  assert.deepEqual(
    result.tasks.map((task) => task.label),
    ["plain"],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["plain"],
  );
});

test("hides tasks carrying problemMatcher in string, object, array and OS block forms", () => {
  const result = resolve([
    vscodeJson([
      { label: "pm-string", command: "make", problemMatcher: "$gcc" },
      { label: "pm-object", command: "make", problemMatcher: { owner: "cpp" } },
      { label: "pm-array", command: "make", problemMatcher: [] },
      {
        label: "pm-os-block",
        command: "make",
        linux: { command: "make linux", problemMatcher: "$gcc" },
      },
      { label: "clean", command: "make clean" },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["pm-string", "problemMatcher"],
      ["pm-object", "problemMatcher"],
      ["pm-array", "problemMatcher"],
      ["pm-os-block", "problemMatcher"],
    ],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["clean"],
  );
});

test("hides every task when the file carries a default problemMatcher", () => {
  const result = resolve([
    vscodeJson(
      [
        { label: "a", command: "make" },
        { label: "b", command: "make" },
      ],
      {
        problemMatcher: "$gcc",
      },
    ),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => reason.rule),
    ["problemMatcher", "problemMatcher"],
  );
  assert.deepEqual(result.menuItems, []);
});

test("hides tasks carrying presentation.revealProblems", () => {
  const result = resolve([
    spiritJson([
      {
        label: "a",
        command: "make",
        presentation: { revealProblems: "onProblem" },
      },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, [
    { key: "/repo/.spirit/tasks.json#a", label: "a", rule: "revealProblems" },
  ]);
});

test("hides tasks referencing unsupported variables across command, args and options", () => {
  const result = resolve([
    vscodeJson(
      [
        { label: "v-file", command: "echo ${file}" },
        { label: "v-input", command: "echo", args: ["${input:foo}"] },
        { label: "v-config", command: "echo", options: { cwd: "${config:x}" } },
        { label: "v-command", command: "echo", options: { env: { A: "${command:x}" } } },
        {
          label: "v-selected",
          command: "echo",
          options: { shell: { executable: "${selectedText}" } },
        },
        {
          label: "v-line",
          command: "echo",
          options: { shell: { executable: "/bin/sh", args: ["${lineNumber}"] } },
        },
        { label: "v-default-build", command: ["${defaultBuildTask}"] },
        { label: "clean", command: "echo ok" },
      ],
      { inputs: [{ id: "foo", type: "promptString" }] },
    ),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["v-file", "unsupportedVariable"],
      ["v-input", "unsupportedVariable"],
      ["v-config", "unsupportedVariable"],
      ["v-command", "unsupportedVariable"],
      ["v-selected", "unsupportedVariable"],
      ["v-line", "unsupportedVariable"],
      ["v-default-build", "unsupportedVariable"],
    ],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["clean"],
  );
});

test("hides tasks with runOptions.runOn other than default", () => {
  const result = resolve([
    spiritJson([
      { label: "on-open", command: "echo a", runOptions: { runOn: "folderOpen" } },
      { label: "on-worktree", command: "echo b", runOptions: { runOn: "worktreeCreated" } },
      { label: "clean", command: "echo c", runOptions: { runOn: "default" } },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["on-open", "runOn"],
      ["on-worktree", "runOn"],
    ],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["clean"],
  );
});

test("hides tasks using the dependsOn object form, single or inside the array", () => {
  const result = resolve([
    spiritJson([
      { label: "single", command: "echo a", dependsOn: { type: "shell" } },
      { label: "in-array", command: "echo b", dependsOn: ["missing", { task: "other" }] },
      { label: "clean", command: "echo c", dependsOn: ["single"] },
    ]),
  ]);
  // "in-array" reports the object form rather than the missing label because per-task
  // rules are evaluated before transitive propagation.
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["single", "dependsOnObjectForm"],
      ["in-array", "dependsOnObjectForm"],
      ["clean", "transitiveHiddenDependency"],
    ],
  );
});

test("hides tasks depending on an isBackground task", () => {
  const result = resolve([
    spiritJson([
      { label: "watch", command: "echo watch", isBackground: true },
      { label: "after-watch", command: "echo after", dependsOn: ["watch"] },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [["after-watch", "dependsOnBackground"]],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["watch"],
  );
});

test("hides tasks with a non-prompt instancePolicy", () => {
  const result = resolve([
    spiritJson([
      { label: "p-newest", command: "a", runOptions: { instancePolicy: "terminateNewest" } },
      { label: "p-oldest", command: "b", runOptions: { instancePolicy: "terminateOldest" } },
      { label: "p-warn", command: "c", runOptions: { instancePolicy: "warn" } },
      { label: "p-silent", command: "d", runOptions: { instancePolicy: "silent" } },
      { label: "p-prompt", command: "e", runOptions: { instancePolicy: "prompt" } },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => reason.rule),
    ["instancePolicy", "instancePolicy", "instancePolicy", "instancePolicy"],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["p-prompt"],
  );
});

test("rejects cyclic dependencies including self-references", () => {
  const result = resolve([
    spiritJson([
      { label: "a", command: "echo a", dependsOn: ["b"] },
      { label: "b", command: "echo b", dependsOn: ["a"] },
      { label: "self", command: "echo self", dependsOn: ["self"] },
      { label: "onto-cycle", command: "echo c", dependsOn: ["a"] },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["a", "cyclicDependency"],
      ["b", "cyclicDependency"],
      ["self", "cyclicDependency"],
      ["onto-cycle", "transitiveHiddenDependency"],
    ],
  );
});

test("hides tasks depending on hidden or nonexistent labels, transitively", () => {
  const result = resolve([
    spiritJson([
      { label: "hidden", command: "make", problemMatcher: "$gcc" },
      { label: "on-hidden", command: "echo a", dependsOn: ["hidden"] },
      { label: "on-transitive", command: "echo b", dependsOn: ["on-hidden"] },
      { label: "on-missing", command: "echo c", dependsOn: ["does-not-exist"] },
      { label: "clean", command: "echo d" },
    ]),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["hidden", "problemMatcher"],
      ["on-hidden", "transitiveHiddenDependency"],
      ["on-transitive", "transitiveHiddenDependency"],
      ["on-missing", "transitiveHiddenDependency"],
    ],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["clean"],
  );
});

test("hides tasks referencing workspace variables when no workspaceFolder is available", () => {
  const context: TaskVariableContext = {
    cwd: "/tmp",
    userHome: "/home/user",
    env: {},
    pathSeparator: "/",
  };
  const result = resolve(
    [
      spiritJson([
        { label: "needs-ws", command: "${workspaceFolder}/build.sh" },
        { label: "needs-ws-base", command: "echo ${workspaceFolderBasename}" },
        { label: "fine", command: "echo ${cwd}" },
      ]),
    ],
    context,
  );
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["needs-ws", "unresolvableWorkspaceVariable"],
      ["needs-ws-base", "unresolvableWorkspaceVariable"],
    ],
  );
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["fine"],
  );
});

test("hides tasks without a command as invalidTask, process and shell alike", () => {
  // Deliberate Spirit choice: a shell task with no command is invalid too (VS Code only
  // requires a label), because there is nothing meaningful to run.
  const result = resolve([
    spiritJson([
      { label: "process-no-command", type: "process" },
      { label: "shell-no-command", type: "shell" },
      { label: "shell-default-no-command" },
    ]),
    vscodeJson([{ label: "inherits-command" }], { command: "global-command" }),
  ]);
  assert.deepEqual(
    result.hiddenReasons.map((reason) => [reason.label, reason.rule]),
    [
      ["process-no-command", "invalidTask"],
      ["shell-no-command", "invalidTask"],
      ["shell-default-no-command", "invalidTask"],
    ],
  );
  // The file-level default command merges in, so the label-only task is valid.
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["inherits-command"],
  );
  assert.equal(result.tasks[0]!.command, "global-command");
});

test("substitutes supported variables into the resolved run spec", () => {
  const result = resolve([
    spiritJson([
      {
        label: "vars",
        command:
          "echo ${workspaceFolder} ${workspaceFolderBasename} ${cwd} ${userHome} ${env:TOKEN} ${/} ${pathSeparator}",
        args: ["--token", "${env:TOKEN}"],
        options: {
          cwd: "${workspaceFolder}/sub",
          env: { PATH: "${userHome}/bin" },
          shell: { executable: "${workspaceFolder}/tool/sh", args: ["-c"] },
        },
      },
    ]),
  ]);
  assert.deepEqual(result.hiddenReasons, []);
  const task = result.tasks[0]!;
  assert.equal(task.command, "echo /ws ws /ws /home/user secret / /");
  assert.deepEqual(task.args, ["--token", "secret"]);
  assert.deepEqual(task.options, {
    cwd: "/ws/sub",
    env: { PATH: "/home/user/bin" },
    shell: { executable: "/ws/tool/sh", args: ["-c"] },
  });
});

test("dedupes same-label tasks by source priority for menu and dependsOn resolution", () => {
  const workspace = spiritJson([
    { label: "shared", command: "ws-shared" },
    { label: "dep", command: "ws-dep" },
    { label: "ws-only", command: "ws-only" },
  ]);
  const user = loaded("/data/tasks.json", "user", {
    schemaVersion: 1,
    tasks: [
      { label: "shared", command: "user-shared" },
      { label: "use-dep", command: "user-use", dependsOn: ["dep"] },
      { label: "user-only", command: "user-only" },
    ],
  });
  const vscode = vscodeJson([
    { label: "shared", command: "vs-shared" },
    { label: "dep", command: "vs-dep", isBackground: true },
    { label: "vs-only", command: "vs-only" },
  ]);
  // Files are passed out of priority order on purpose; resolve must rank by source kind.
  const result = resolve([vscode, user, workspace]);
  assert.deepEqual(result.hiddenReasons, []);
  assert.deepEqual(
    result.menuItems.map((item) => item.label),
    ["shared", "dep", "ws-only", "use-dep", "user-only", "vs-only"],
  );
  const shared = result.tasks[0]!;
  assert.equal(shared.command, "ws-shared");
  assert.equal(shared.sourceFile, "/repo/.spirit/tasks.json");
  assert.equal(shared.key, "/repo/.spirit/tasks.json#shared");
  // dependsOn resolves against the deduped namespace: the workspace "dep" (not
  // isBackground) wins over the .vscode one, so "use-dep" stays visible.
  const useDep = result.tasks.find((task) => task.label === "use-dep");
  assert.ok(useDep);
  assert.deepEqual(useDep.dependsOn, ["dep"]);
});

test("applies OS blocks per platform and hides OS problemMatcher only on that platform", () => {
  const files = [
    vscodeJson([
      {
        label: "build",
        command: "make",
        osx: { command: "make darwin", problemMatcher: "$gcc" },
        linux: { command: "make linux" },
      },
    ]),
  ];
  const darwin = resolve(files, CONTEXT, "darwin");
  assert.deepEqual(
    darwin.hiddenReasons.map((reason) => reason.rule),
    ["problemMatcher"],
  );
  assert.deepEqual(darwin.menuItems, []);

  const linux = resolve(files, CONTEXT, "linux");
  assert.deepEqual(linux.hiddenReasons, []);
  assert.equal(linux.tasks[0]!.command, "make linux");

  const win = resolve(files, CONTEXT, "win32");
  assert.deepEqual(win.hiddenReasons, []);
  assert.equal(win.tasks[0]!.command, "make");
});
