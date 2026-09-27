/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { TaskInstanceLimitDialog } from "@/components/task-instance-limit-dialog";
import {
  initTaskRunService,
  resetTaskRunService,
  resolveTaskInstanceLimitPrompt,
  runTaskByKey,
} from "@/lib/task-run-service";
import { clearTaskTerminalRegistry, registerTaskTerminal } from "@/lib/task-terminal-registry";

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
    started: 0,
    killed: 0,
    settleFn: null,
    start() {
      session.started += 1;
      return new Promise((resolve) => {
        session.settleFn = resolve;
      });
    },
    respawn(invocation, opts) {
      return session.start(invocation, opts);
    },
    clear() {},
    focus() {},
    kill() {
      session.killed += 1;
      session.settleFn?.(0);
    },
    isRunning() {
      return session.settleFn !== null;
    },
    dispose() {},
    settleExit(code) {
      const settle = session.settleFn;
      session.settleFn = null;
      settle?.(code);
    },
  };
  return session;
}

function initFakeService(tasks) {
  resetTaskRunService();
  clearTaskTerminalRegistry();
  const state = { tabs: [], sessions: new Map() };
  initTaskRunService({
    resolveTaskForRun: async (key) => {
      const task = tasks.find((candidate) => candidate.key === key);
      return task
        ? { status: "ok", task, defaultShell: { executable: "/bin/sh", args: ["-c"] } }
        : { status: "notFound" };
    },
    resolveTaskByLabel: async () => ({ status: "notFound" }),
    getTabs: () => state.tabs,
    setTabs: (tabs) => {
      state.tabs = tabs;
      for (const tab of tabs) {
        if (tab.kind === "task" && !state.sessions.has(tab.id)) {
          const session = createFakeSession();
          state.sessions.set(tab.id, session);
          registerTaskTerminal(tab.id, { session, taskKey: tab.taskKey, running: false });
        }
      }
    },
    getActiveTabId: () => state.tabs[0]?.id ?? "",
    setActiveTabId: () => {},
    setToolsOpen: () => {},
    getWorkspaceRoot: () => "/repo",
  });
  return state;
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("the dialog preselects the first of several instances and enables Replace immediately", async () => {
  const task = makeResolvedTask({ runOptions: { reevaluateOnRerun: true, instanceLimit: 2 } });
  const state = initFakeService([task]);
  const first = runTaskByKey(task.key);
  await flush();
  const second = runTaskByKey(task.key);
  await flush();
  const third = runTaskByKey(task.key);
  await flush();

  render(<TaskInstanceLimitDialog />);
  const radios = screen.getAllByRole("radio");
  expect(radios.length).toBe(2);
  expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  expect(radios[1]?.getAttribute("aria-checked")).toBe("false");
  expect(radios[0]?.textContent).toContain("#1");
  expect(radios[1]?.textContent).toContain("#2");
  for (const radio of radios) {
    expect(radio.classList.contains("hover:bg-overlay-hover")).toBe(true);
  }

  const replaceButton = screen.getByRole("button", { name: "Replace" });
  expect(replaceButton.hasAttribute("disabled")).toBe(false);

  resolveTaskInstanceLimitPrompt({ kind: "cancel" });
  await third;
  for (const session of state.sessions.values()) {
    session.settleExit(0);
  }
  await first;
  await second;
});

test("a single active instance is preselected and Replace is actionable", async () => {
  const task = makeResolvedTask();
  const state = initFakeService([task]);
  const first = runTaskByKey(task.key);
  await flush();
  const second = runTaskByKey(task.key);
  await flush();

  render(<TaskInstanceLimitDialog />);
  const radios = screen.getAllByRole("radio");
  expect(radios.length).toBe(1);
  expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  const replaceButton = screen.getByRole("button", { name: "Replace" });
  expect(replaceButton.hasAttribute("disabled")).toBe(false);

  resolveTaskInstanceLimitPrompt({ kind: "cancel" });
  await second;
  for (const session of state.sessions.values()) {
    session.settleExit(0);
  }
  await first;
});
