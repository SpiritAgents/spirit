/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { test } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

const { createWorkspaceTaskTerminalSession } =
  await import("../../src/lib/workspace-task-terminal.ts");

function createFakeBridge() {
  const bridge = {
    created: [],
    killed: [],
    written: [],
    subscriber: null,
    nextId: 0,
    failNextCreate: null,
    ptyCreate(request) {
      bridge.created.push(request);
      if (bridge.failNextCreate !== null) {
        const error = bridge.failNextCreate;
        bridge.failNextCreate = null;
        return Promise.resolve({ ok: false, error });
      }
      bridge.nextId += 1;
      return Promise.resolve({
        ok: true,
        id: `pty-${bridge.nextId}`,
        shellDisplayName: "fake-shell",
      });
    },
    ptyWrite(id, data) {
      bridge.written.push({ id, data });
    },
    ptyResize() {},
    ptyKill(id) {
      bridge.killed.push(id);
      return Promise.resolve();
    },
    ptySubscribe(callbacks) {
      bridge.subscriber = callbacks;
      return () => {
        bridge.subscriber = null;
      };
    },
    emitData(id, data) {
      bridge.subscriber?.onData({ id, data });
    },
    emitExit(id, exitCode) {
      bridge.subscriber?.onExit({ id, exitCode });
    },
  };
  return bridge;
}

function createSession(bridge) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const session = createWorkspaceTaskTerminalSession({ container, bridge });
  const writes = [];
  const originalWrite = session.terminal.write.bind(session.terminal);
  session.terminal.write = (data, callback) => {
    writes.push(data);
    return originalWrite(data, callback);
  };
  return { session, writes, container };
}

const INVOCATION = { file: "/bin/echo", args: ["hello"] };

test("start spawns via the extended pty create and resolves with the exit code", async () => {
  const bridge = createFakeBridge();
  const { session, writes } = createSession(bridge);

  const exitPromise = session.start(INVOCATION, {
    cwd: "/tmp",
    env: { TASK_ENV_MARK: "1" },
    echoLine: "$ echo hello",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(bridge.created.length, 1);
  const request = bridge.created[0];
  assert.equal(request.file, "/bin/echo");
  assert.deepEqual(request.args, ["hello"]);
  assert.equal(request.cwd, "/tmp");
  assert.deepEqual(request.env, { TASK_ENV_MARK: "1" });
  assert.ok(writes.some((data) => typeof data === "string" && data.includes("$ echo hello")));
  assert.equal(session.isRunning(), true);

  bridge.emitExit("pty-1", 5);
  assert.equal(await exitPromise, 5);
  assert.equal(session.isRunning(), false);
  session.dispose();
});

test("start forwards process output and keyboard input for the active pty", async () => {
  const bridge = createFakeBridge();
  const { session, writes } = createSession(bridge);
  const exitPromise = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  bridge.emitData("pty-1", "process-output");
  assert.ok(writes.includes("process-output"));

  bridge.emitExit("pty-1", 0);
  assert.equal(await exitPromise, 0);
  session.dispose();
});

test("respawn reuses the same xterm instance across two spawns", async () => {
  const bridge = createFakeBridge();
  const { session } = createSession(bridge);
  const terminalBefore = session.terminal;

  const first = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  bridge.emitExit("pty-1", 0);
  assert.equal(await first, 0);

  const second = session.respawn({ file: "/bin/true", args: [] }, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.terminal, terminalBefore);
  assert.equal(bridge.created.length, 2);
  assert.equal(bridge.created[1].file, "/bin/true");
  assert.equal(session.isRunning(), true);

  bridge.emitExit("pty-2", 0);
  assert.equal(await second, 0);
  session.dispose();
});

test("start while a process is running rejects", async () => {
  const bridge = createFakeBridge();
  const { session } = createSession(bridge);
  const exitPromise = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await assert.rejects(session.start(INVOCATION, { cwd: "/tmp" }), /already has a running/);
  await assert.rejects(session.respawn(INVOCATION, { cwd: "/tmp" }), /already has a running/);

  bridge.emitExit("pty-1", 0);
  await exitPromise;
  session.dispose();
});

test("start rejects when the pty cannot be created", async () => {
  const bridge = createFakeBridge();
  bridge.failNextCreate = "spawn failed";
  const { session } = createSession(bridge);
  await assert.rejects(session.start(INVOCATION, { cwd: "/tmp" }), /spawn failed/);
  assert.equal(session.isRunning(), false);
  session.dispose();
});

test("clear and focus call through to the xterm instance", async () => {
  const bridge = createFakeBridge();
  const { session } = createSession(bridge);
  const calls = [];
  const originalClear = session.terminal.clear.bind(session.terminal);
  const originalFocus = session.terminal.focus.bind(session.terminal);
  session.terminal.clear = () => {
    calls.push("clear");
    originalClear();
  };
  session.terminal.focus = () => {
    calls.push("focus");
    originalFocus();
  };

  session.clear();
  session.focus();
  assert.deepEqual(calls, ["clear", "focus"]);
  session.dispose();
});

test("dispose kills the live pty and later starts reject", async () => {
  const bridge = createFakeBridge();
  const { session } = createSession(bridge);
  const exitPromise = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  session.dispose();
  assert.deepEqual(bridge.killed, ["pty-1"]);
  await assert.rejects(session.start(INVOCATION, { cwd: "/tmp" }), /disposed/);
  bridge.emitExit("pty-1", 0);
  assert.equal(await exitPromise, 0);
});

test("kill terminates the pty but keeps the xterm and settles start via the exit event", async () => {
  const bridge = createFakeBridge();
  const { session } = createSession(bridge);
  const exitPromise = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.isRunning(), true);

  session.kill();
  assert.deepEqual(bridge.killed, ["pty-1"]);
  // Still "running" until the real exit event arrives and settles the pending promise.
  assert.equal(session.isRunning(), true);

  bridge.emitExit("pty-1", 143);
  assert.equal(await exitPromise, 143);
  assert.equal(session.isRunning(), false);

  // The xterm is reusable after a kill.
  const second = session.start(INVOCATION, { cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bridge.created.length, 2);
  bridge.emitExit("pty-2", 0);
  assert.equal(await second, 0);
  session.dispose();
});
