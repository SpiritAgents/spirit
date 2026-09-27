import assert from "node:assert/strict";
import { test } from "vitest";

import {
  clearTaskTerminalRegistry,
  disposeTaskTerminal,
  focusTaskTerminal,
  getTaskTerminal,
  listTaskTerminals,
  registerTaskTerminal,
  unregisterTaskTerminal,
  updateTaskTerminal,
} from "../../src/lib/task-terminal-registry.ts";

function createFakeSession() {
  const calls = [];
  return {
    calls,
    focus: () => {
      calls.push("focus");
    },
    dispose: () => {
      calls.push("dispose");
    },
  };
}

function register(tabId, extra = {}) {
  const session = createFakeSession();
  registerTaskTerminal(tabId, {
    session,
    taskKey: `/repo/tasks.json#${tabId}`,
    running: false,
    ...extra,
  });
  return session;
}

test("register, get, update and unregister a task terminal", () => {
  clearTaskTerminalRegistry();
  register("tab-1");
  const entry = getTaskTerminal("tab-1");
  assert.ok(entry);
  assert.equal(entry.taskKey, "/repo/tasks.json#tab-1");
  assert.equal(entry.running, false);

  updateTaskTerminal("tab-1", { running: true, instanceKey: "/repo/tasks.json#tab-1|2" });
  assert.equal(getTaskTerminal("tab-1")?.running, true);
  assert.equal(getTaskTerminal("tab-1")?.instanceKey, "/repo/tasks.json#tab-1|2");

  unregisterTaskTerminal("tab-1");
  assert.equal(getTaskTerminal("tab-1"), undefined);
});

test("unregister fires the onSessionDisposed hook", () => {
  clearTaskTerminalRegistry();
  const disposed = [];
  register("tab-1", { onSessionDisposed: (tabId) => disposed.push(tabId) });
  unregisterTaskTerminal("tab-1");
  assert.deepEqual(disposed, ["tab-1"]);
  unregisterTaskTerminal("tab-1");
  assert.deepEqual(disposed, ["tab-1"]);
});

test("disposeTaskTerminal disposes the session and unregisters in one step", () => {
  clearTaskTerminalRegistry();
  const disposed = [];
  const session = register("tab-1", { onSessionDisposed: (tabId) => disposed.push(tabId) });
  disposeTaskTerminal("tab-1");
  assert.deepEqual(session.calls, ["dispose"]);
  assert.equal(getTaskTerminal("tab-1"), undefined);
  assert.deepEqual(disposed, ["tab-1"]);

  disposeTaskTerminal("unknown-tab");
});

test("focusTaskTerminal routes focus to the session and reports unknown tabs", () => {
  clearTaskTerminalRegistry();
  const session = register("tab-1");
  assert.equal(focusTaskTerminal("tab-1"), true);
  assert.deepEqual(session.calls, ["focus"]);
  assert.equal(focusTaskTerminal("unknown-tab"), false);
});

test("listTaskTerminals iterates current registrations", () => {
  clearTaskTerminalRegistry();
  register("tab-1");
  register("tab-2");
  assert.deepEqual(
    listTaskTerminals()
      .map(([tabId]) => tabId)
      .sort(),
    ["tab-1", "tab-2"],
  );
  clearTaskTerminalRegistry();
  assert.deepEqual(listTaskTerminals(), []);
});
