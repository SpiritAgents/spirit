import assert from "node:assert/strict";
import { test } from "vitest";

import {
  clearTaskTerminalRegistry,
  disposeTaskTerminal,
  getTaskTerminal,
  registerTaskTerminal,
} from "../../src/lib/task-terminal-registry.ts";
import {
  formatTaskDisplayCommandLine,
  initTaskRunService,
  resetTaskRunService,
  runTaskByKey,
} from "../../src/lib/task-run-service.ts";
import { closeWorkspaceToolTab } from "../../src/lib/workspace-tool-tabs.ts";

function makeResolvedTask(overrides = {}) {
  return {
    key: "/repo/.spirit/tasks.json#build",
    sourceFile: "/repo/.spirit/tasks.json",
    label: "build",
    hide: false,
    type: "shell",
    command: "make",
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

function createFakeSession() {
  const session = {
    terminal: {},
    startInvocations: [],
    respawnInvocations: [],
    cleared: 0,
    killed: 0,
    focused: 0,
    disposed: 0,
    settleFn: null,
    start(invocation, opts) {
      session.startInvocations.push({ invocation, opts });
      return new Promise((resolve) => {
        session.settleFn = resolve;
      });
    },
    respawn(invocation, opts) {
      session.respawnInvocations.push({ invocation, opts });
      return new Promise((resolve) => {
        session.settleFn = resolve;
      });
    },
    clear() {
      session.cleared += 1;
    },
    focus() {
      session.focused += 1;
    },
    kill() {
      session.killed += 1;
    },
    isRunning() {
      return session.settleFn !== null;
    },
    dispose() {
      session.disposed += 1;
    },
    settleExit(code) {
      const settle = session.settleFn;
      session.settleFn = null;
      settle?.(code);
    },
  };
  return session;
}

function createDeps(tasks) {
  const state = {
    tabs: [],
    activeTabId: "",
    toolsOpen: false,
    sessionsByTabId: new Map(),
    labelQueries: [],
  };
  const ok = (task) => ({
    status: "ok",
    task,
    defaultShell: { executable: "/bin/sh", args: ["-c"] },
  });
  const deps = {
    resolveTaskForRun: async (key) => {
      const task = tasks.find((candidate) => candidate.key === key);
      return task ? ok(task) : { status: "notFound" };
    },
    resolveTaskByLabel: async (label) => {
      state.labelQueries.push(label);
      const task = tasks.find((candidate) => candidate.label === label);
      return task ? ok(task) : { status: "notFound" };
    },
    getTabs: () => state.tabs,
    setTabs: (tabs) => {
      state.tabs = tabs;
      // The real tab component mounts right after the state update: register a fake
      // session for each new task tab synchronously.
      for (const tab of tabs) {
        if (tab.kind === "task" && !state.sessionsByTabId.has(tab.id)) {
          const session = createFakeSession();
          state.sessionsByTabId.set(tab.id, session);
          registerTaskTerminal(tab.id, { session, taskKey: tab.taskKey, running: false });
        }
      }
    },
    getActiveTabId: () => state.activeTabId,
    setActiveTabId: (id) => {
      state.activeTabId = id;
    },
    setToolsOpen: (open) => {
      state.toolsOpen = open;
    },
    getWorkspaceRoot: () => "/repo",
  };
  return { deps, state };
}

function setup(tasks) {
  resetTaskRunService();
  clearTaskTerminalRegistry();
  const { deps, state } = createDeps(tasks);
  initTaskRunService(deps);
  return { state };
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function onlyTaskTab(state) {
  assert.equal(state.tabs.length, 1);
  const tab = state.tabs[0];
  assert.equal(tab.kind, "task");
  return tab;
}

/** The chip close path plus the unmount-time session disposal, as the real panel does it. */
function userCloseTab(state, tabId) {
  const next = closeWorkspaceToolTab(state.tabs, state.activeTabId, tabId);
  state.tabs = next.tabs;
  state.activeTabId = next.activeId;
  disposeTaskTerminal(tabId);
}

test("runTaskByKey creates a task tab, starts the session, and applies the launch intent", async () => {
  const task = makeResolvedTask();
  const { state } = setup([task]);
  const run = runTaskByKey(task.key);
  await flush();

  const tab = onlyTaskTab(state);
  assert.equal(tab.taskKey, task.key);
  assert.equal(tab.tabTitle, "build");
  assert.equal(tab.pinnedTitle, undefined);
  assert.equal(state.activeTabId, tab.id);
  assert.equal(state.toolsOpen, true);

  const session = state.sessionsByTabId.get(tab.id);
  assert.equal(session.startInvocations.length, 1);
  const { invocation, opts } = session.startInvocations[0];
  assert.deepEqual(invocation, { file: "/bin/sh", args: ["-c", "make"] });
  assert.equal(opts.cwd, "/repo");
  assert.equal(opts.echoLine, "make");
  assert.equal(getTaskTerminal(tab.id)?.running, true);

  session.settleExit(0);
  await run;
  assert.equal(getTaskTerminal(tab.id)?.running, false);
});

test("echo, focus, cwd and env follow the task presentation and options", async () => {
  const task = makeResolvedTask({
    options: { cwd: "/custom", env: { MODE: "fast" } },
    presentation: {
      echo: false,
      reveal: "never",
      focus: true,
      panel: "shared",
      clear: false,
      close: false,
      preserveTerminalName: true,
    },
  });
  const { state } = setup([task]);
  const run = runTaskByKey(task.key);
  await flush();

  const tab = onlyTaskTab(state);
  assert.equal(tab.pinnedTitle, true);
  const session = state.sessionsByTabId.get(tab.id);
  const { opts } = session.startInvocations[0];
  assert.equal(opts.cwd, "/custom");
  assert.deepEqual(opts.env, { MODE: "fast" });
  assert.equal("echoLine" in opts, false);
  // focus implies reveal-expand at launch.
  assert.equal(state.toolsOpen, true);
  assert.equal(session.focused, 1);

  session.settleExit(0);
  await run;
});

test("a completed run pools the terminal and the next run respawns on the same session", async () => {
  const task = makeResolvedTask();
  const { state } = setup([task]);

  const first = runTaskByKey(task.key);
  await flush();
  const tab = onlyTaskTab(state);
  const session = state.sessionsByTabId.get(tab.id);
  session.settleExit(0);
  await first;

  const second = runTaskByKey(task.key);
  await flush();
  assert.equal(state.tabs.length, 1);
  assert.equal(session.startInvocations.length, 1);
  assert.equal(session.respawnInvocations.length, 1);
  assert.equal(session.cleared, 0);

  session.settleExit(0);
  await second;
});

test("clear presentation clears the terminal before respawn", async () => {
  const task = makeResolvedTask({
    presentation: {
      echo: true,
      reveal: "always",
      focus: false,
      panel: "shared",
      clear: true,
      close: false,
      preserveTerminalName: false,
    },
  });
  const { state } = setup([task]);

  const first = runTaskByKey(task.key);
  await flush();
  const session = state.sessionsByTabId.get(state.tabs[0].id);
  session.settleExit(0);
  await first;

  const second = runTaskByKey(task.key);
  await flush();
  assert.equal(session.respawnInvocations.length, 1);
  assert.equal(session.cleared, 1);

  session.settleExit(0);
  await second;
});

test("panel new never respawns and always creates a fresh tab", async () => {
  const task = makeResolvedTask({
    presentation: {
      echo: true,
      reveal: "always",
      focus: false,
      panel: "new",
      clear: false,
      close: false,
      preserveTerminalName: false,
    },
  });
  const { state } = setup([task]);

  const first = runTaskByKey(task.key);
  await flush();
  const firstSession = state.sessionsByTabId.get(state.tabs[0].id);
  firstSession.settleExit(0);
  await first;

  const second = runTaskByKey(task.key);
  await flush();
  assert.equal(state.tabs.length, 2);
  const secondTab = state.tabs.find((tab) => firstSession !== state.sessionsByTabId.get(tab.id));
  assert.ok(secondTab);
  const secondSession = state.sessionsByTabId.get(secondTab.id);
  assert.equal(firstSession.respawnInvocations.length, 0);
  assert.equal(secondSession.startInvocations.length, 1);

  secondSession.settleExit(0);
  await second;
});

test("close presentation closes the tab through the shared close path on exit", async () => {
  const task = makeResolvedTask({
    presentation: {
      echo: true,
      reveal: "always",
      focus: false,
      panel: "shared",
      clear: false,
      close: true,
      preserveTerminalName: false,
    },
  });
  const { state } = setup([task]);
  const run = runTaskByKey(task.key);
  await flush();
  const tab = onlyTaskTab(state);
  const session = state.sessionsByTabId.get(tab.id);

  session.settleExit(0);
  await run;
  assert.equal(state.tabs.length, 0);
});

test("silent nonzero exit expands the panel without stealing focus", async () => {
  const task = makeResolvedTask({
    presentation: {
      echo: true,
      reveal: "silent",
      focus: false,
      panel: "shared",
      clear: false,
      close: false,
      preserveTerminalName: false,
    },
  });
  const { state } = setup([task]);
  const run = runTaskByKey(task.key);
  await flush();
  const session = state.sessionsByTabId.get(state.tabs[0].id);
  assert.equal(state.toolsOpen, false);

  session.settleExit(1);
  await run;
  assert.equal(state.toolsOpen, true);
  assert.equal(session.focused, 0);
});

test("user-closing a task tab releases the instance so a rerun is not prompted", async () => {
  const task = makeResolvedTask();
  const { state } = setup([task]);
  const first = runTaskByKey(task.key);
  await flush();
  const tab = onlyTaskTab(state);

  userCloseTab(state, tab.id);
  await flush();

  const second = runTaskByKey(task.key);
  await flush();
  // promptInstanceLimit would have cancelled this run if the instance had leaked.
  assert.equal(state.tabs.length, 1);
  assert.notEqual(state.tabs[0].id, tab.id);
  const newSession = state.sessionsByTabId.get(state.tabs[0].id);
  assert.equal(newSession.startInvocations.length, 1);

  newSession.settleExit(0);
  await second;
  void first;
});

test("dependencies resolve through the prewarmed label map before the main task", async () => {
  const dep = makeResolvedTask({
    key: "/repo/.spirit/tasks.json#prep",
    label: "prep",
    command: "echo prep",
  });
  const main = makeResolvedTask({ dependsOn: ["prep"], dependsOrder: "sequence" });
  const { state } = setup([dep, main]);
  const run = runTaskByKey(main.key);
  await flush();

  assert.deepEqual(state.labelQueries, ["prep"]);
  assert.equal(state.tabs.length, 1);
  const depTab = state.tabs[0];
  assert.equal(depTab.taskKey, dep.key);
  const depSession = state.sessionsByTabId.get(depTab.id);
  assert.equal(depSession.startInvocations.length, 1);

  depSession.settleExit(0);
  await flush();
  assert.equal(state.tabs.length, 2);
  const mainTab = state.tabs.find((tab) => tab.id !== depTab.id);
  const mainSession = state.sessionsByTabId.get(mainTab.id);
  assert.equal(mainSession.startInvocations.length, 1);

  mainSession.settleExit(0);
  await run;
});

test("an unknown task key is a silent no-op", async () => {
  const { state } = setup([]);
  await runTaskByKey("/repo/.spirit/tasks.json#ghost");
  await flush();
  assert.deepEqual(state.tabs, []);
  assert.equal(state.toolsOpen, false);
});

test("formatTaskDisplayCommandLine uses the trailing arg for shells and joins for processes", () => {
  const shellTask = makeResolvedTask();
  assert.equal(
    formatTaskDisplayCommandLine(shellTask, { file: "/bin/sh", args: ["-c", "make all"] }),
    "make all",
  );
  const processTask = makeResolvedTask({ type: "process", command: "node" });
  assert.equal(
    formatTaskDisplayCommandLine(processTask, {
      file: "node",
      args: ["server.js", "--port", "80"],
    }),
    "node server.js --port 80",
  );
  assert.equal(formatTaskDisplayCommandLine(shellTask, { file: "/bin/sh", args: [] }), "/bin/sh");
});
