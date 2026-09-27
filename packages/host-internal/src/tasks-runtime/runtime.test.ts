import assert from "node:assert/strict";
import { test } from "vitest";

import type { ResolvedTask } from "../tasks/public.js";
import type { TaskTerminalClaim } from "./pool.js";
import type { TaskLaunchIntent } from "./presentation.js";
import type { TaskInvocation } from "./quoting.js";
import { TaskRunCoordinator, type TaskProcessHandle, type TaskRunHost } from "./runtime.js";

interface StartRequest {
  task: ResolvedTask;
  instanceKey: string;
  invocation: TaskInvocation;
  launchIntent: TaskLaunchIntent;
  terminal: TaskTerminalClaim;
}

class FakeHost implements TaskRunHost {
  readonly started: StartRequest[] = [];
  readonly terminated: string[] = [];
  readonly terminalIds: string[] = [];
  readonly promptCalls: { task: ResolvedTask; active: number }[] = [];
  promptChoice: "new" | "replace" | "cancel" = "cancel";
  private readonly exits = new Map<
    string,
    { promise: Promise<number>; resolve: (code: number) => void }
  >();

  startProcess(req: StartRequest): Promise<TaskProcessHandle> {
    this.started.push(req);
    const terminalId = "reuse" in req.terminal ? req.terminal.reuse : `term-${this.started.length}`;
    this.terminalIds.push(terminalId);
    let resolve!: (code: number) => void;
    const promise = new Promise<number>((res) => {
      resolve = res;
    });
    this.exits.set(terminalId, { promise, resolve });
    return Promise.resolve({ terminalId });
  }

  waitForExit(handle: TaskProcessHandle): Promise<number> {
    return this.exits.get(handle.terminalId)!.promise;
  }

  terminate(handle: TaskProcessHandle): Promise<void> {
    this.terminated.push(handle.terminalId);
    this.resolveExit(handle.terminalId, 0);
    return Promise.resolve();
  }

  promptInstanceLimit(task: ResolvedTask, active: number): Promise<"new" | "replace" | "cancel"> {
    this.promptCalls.push({ task, active });
    return Promise.resolve(this.promptChoice);
  }

  resolveExit(terminalId: string, code: number): void {
    this.exits.get(terminalId)?.resolve(code);
  }
}

function makeTask(label: string, overrides: Partial<ResolvedTask> = {}): ResolvedTask {
  return {
    key: `/repo/.spirit/tasks.json#${label}`,
    sourceFile: "/repo/.spirit/tasks.json",
    label,
    hide: false,
    type: "shell",
    command: "echo",
    args: ["hi"],
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

function setup(tasks: ResolvedTask[], host: FakeHost = new FakeHost()) {
  const byLabel = new Map(tasks.map((task) => [task.label, task]));
  const coordinator = new TaskRunCoordinator({
    host,
    defaultShell: { executable: "/bin/sh", args: ["-c"] },
    resolveByLabel: (label) => byLabel.get(label),
  });
  return { host, coordinator };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("runs a simple task to completion and returns exit intent and terminal", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  const run = coordinator.run(task);
  await tick();
  assert.equal(host.started.length, 1);
  const req = host.started[0]!;
  assert.equal(req.instanceKey, task.key);
  assert.deepEqual(req.invocation, { file: "/bin/sh", args: ["-c", "echo hi"] });
  assert.deepEqual(req.launchIntent, { reveal: "expand", focus: false });
  assert.deepEqual(req.terminal, { create: true });

  host.resolveExit("term-1", 0);
  const outcome = await run;
  assert.deepEqual(outcome, {
    status: "completed",
    exitCode: 0,
    exitIntent: { reveal: "none", closeTab: false },
    terminalId: "term-1",
  });
  assert.equal(coordinator.activeInstanceCount(task.key), 0);
  assert.equal(coordinator.idleTerminalCount(task.key), 1);
});

test("passes the focus-driven launch intent through to the host", async () => {
  const task = makeTask("build", {
    presentation: {
      echo: true,
      reveal: "never",
      focus: true,
      panel: "shared",
      clear: false,
      close: false,
      preserveTerminalName: false,
    },
  });
  const { host, coordinator } = setup([task]);
  const run = coordinator.run(task);
  await tick();
  assert.deepEqual(host.started[0]!.launchIntent, { reveal: "expand", focus: true });
  host.resolveExit("term-1", 0);
  await run;
});

test("runs sequence dependencies in order before the main task", async () => {
  const b = makeTask("b");
  const c = makeTask("c");
  const a = makeTask("a", { dependsOn: ["b", "c"], dependsOrder: "sequence" });
  const { host, coordinator } = setup([a, b, c]);
  const run = coordinator.run(a);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b"],
  );
  host.resolveExit("term-1", 0);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b", "c"],
  );
  host.resolveExit("term-2", 0);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b", "c", "a"],
  );
  host.resolveExit("term-3", 0);
  const outcome = await run;
  assert.equal(outcome.status, "completed");
});

test("sequence dependency failure aborts before the main task starts and releases it", async () => {
  const b = makeTask("b");
  const a = makeTask("a", { dependsOn: ["b"], dependsOrder: "sequence" });
  const { host, coordinator } = setup([a, b]);
  const run = coordinator.run(a);
  await tick();
  host.resolveExit("term-1", 1);
  const outcome = await run;
  assert.deepEqual(outcome, { status: "aborted", exitCode: 1, failedTaskKey: b.key });
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b"],
  );
  assert.equal(coordinator.activeInstanceCount(a.key), 0);
  assert.equal(coordinator.activeInstanceCount(b.key), 0);
});

test("nested dependency failure propagates the originally failing task key", async () => {
  const c = makeTask("c");
  const b = makeTask("b", { dependsOn: ["c"], dependsOrder: "sequence" });
  const a = makeTask("a", { dependsOn: ["b"], dependsOrder: "sequence" });
  const { host, coordinator } = setup([a, b, c]);
  const run = coordinator.run(a);
  await tick();
  host.resolveExit("term-1", 3);
  const outcome = await run;
  assert.deepEqual(outcome, { status: "aborted", exitCode: 3, failedTaskKey: c.key });
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["c"],
  );
  assert.equal(coordinator.activeInstanceCount(a.key), 0);
  assert.equal(coordinator.activeInstanceCount(b.key), 0);
});

test("parallel dependencies start together and the main task runs after all succeed", async () => {
  const b = makeTask("b");
  const c = makeTask("c");
  const a = makeTask("a", { dependsOn: ["b", "c"] });
  const { host, coordinator } = setup([a, b, c]);
  const run = coordinator.run(a);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b", "c"],
  );
  host.resolveExit("term-1", 0);
  await tick();
  assert.equal(host.started.length, 2);
  host.resolveExit("term-2", 0);
  await tick();
  assert.equal(host.started.length, 3);
  host.resolveExit("term-3", 0);
  const outcome = await run;
  assert.equal(outcome.status, "completed");
});

test("parallel dependency failure waits for all exits and skips the main task", async () => {
  const b = makeTask("b");
  const c = makeTask("c");
  const a = makeTask("a", { dependsOn: ["b", "c"] });
  const { host, coordinator } = setup([a, b, c]);
  const run = coordinator.run(a);
  await tick();
  host.resolveExit("term-1", 1);
  await tick();
  assert.equal(host.started.length, 2);
  host.resolveExit("term-2", 0);
  const outcome = await run;
  assert.deepEqual(outcome, { status: "aborted", exitCode: 1, failedTaskKey: b.key });
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b", "c"],
  );
});

test("an already-active dependency is awaited instead of restarted", async () => {
  const b = makeTask("b");
  const a = makeTask("a", { dependsOn: ["b"], dependsOrder: "sequence" });
  const { host, coordinator } = setup([a, b]);
  const runB = coordinator.run(b);
  const runA = coordinator.run(a);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b"],
  );
  host.resolveExit("term-1", 0);
  await tick();
  assert.deepEqual(
    host.started.map((req) => req.task.label),
    ["b", "a"],
  );
  host.resolveExit("term-2", 0);
  assert.equal((await runA).status, "completed");
  assert.equal((await runB).status, "completed");
});

test("instance limit prompt cancel starts nothing new", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  host.promptChoice = "cancel";
  const first = coordinator.run(task);
  await tick();
  const second = coordinator.run(task);
  assert.equal((await second).status, "cancelled");
  assert.deepEqual(
    host.promptCalls.map((call) => call.active),
    [1],
  );
  assert.equal(host.started.length, 1);
  assert.equal(coordinator.activeInstanceCount(task.key), 1);
  host.resolveExit("term-1", 0);
  await first;
});

test("instance limit prompt new allocates a parallel instance regardless of the limit", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  host.promptChoice = "new";
  const first = coordinator.run(task);
  await tick();
  const second = coordinator.run(task);
  await tick();
  assert.equal(host.started.length, 2);
  assert.equal(host.started[1]!.instanceKey, `${task.key}|2`);
  assert.equal(coordinator.activeInstanceCount(task.key), 2);
  host.resolveExit("term-1", 0);
  host.resolveExit("term-2", 0);
  assert.equal((await first).status, "completed");
  assert.equal((await second).status, "completed");
  assert.equal(coordinator.activeInstanceCount(task.key), 0);
});

test("instance limit prompt replace terminates the oldest instance first", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  host.promptChoice = "replace";
  const first = coordinator.run(task);
  await tick();
  const second = coordinator.run(task);
  await tick();
  assert.deepEqual(host.terminated, ["term-1"]);
  assert.equal(host.started.length, 2);
  assert.equal(host.started[1]!.instanceKey, task.key);
  // The first run's exit offered term-1 back to the pool, so the replacement reuses it.
  host.resolveExit(host.terminalIds[1]!, 0);
  assert.equal((await first).status, "completed");
  assert.equal((await second).status, "completed");
  assert.equal(coordinator.activeInstanceCount(task.key), 0);
});

test("an idle terminal of the same key is reused for the next run", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  const first = coordinator.run(task);
  await tick();
  host.resolveExit("term-1", 0);
  await first;
  assert.equal(coordinator.idleTerminalCount(task.key), 1);

  const second = coordinator.run(task);
  await tick();
  assert.deepEqual(host.started[1]!.terminal, { reuse: "term-1" });
  host.resolveExit("term-1", 0);
  await second;
});

test("panel new never reuses an idle terminal", async () => {
  const task = makeTask("build", {
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
  const { host, coordinator } = setup([task]);
  const first = coordinator.run(task);
  await tick();
  host.resolveExit("term-1", 0);
  await first;
  const second = coordinator.run(task);
  await tick();
  assert.deepEqual(host.started[1]!.terminal, { create: true });
  host.resolveExit("term-2", 0);
  await second;
});

test("close presentation removes the terminal from the pool instead of offering it", async () => {
  const task = makeTask("build", {
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
  const { host, coordinator } = setup([task]);
  const first = coordinator.run(task);
  await tick();
  host.resolveExit("term-1", 0);
  const outcome = await first;
  assert.deepEqual(outcome, {
    status: "completed",
    exitCode: 0,
    exitIntent: { reveal: "none", closeTab: true },
    terminalId: "term-1",
  });
  assert.equal(coordinator.idleTerminalCount(task.key), 0);

  const second = coordinator.run(task);
  await tick();
  assert.deepEqual(host.started[1]!.terminal, { create: true });
  host.resolveExit("term-2", 0);
  await second;
});

test("onTerminalClosed releases the instance and skips the idle offer without leaks", async () => {
  const task = makeTask("build");
  const { host, coordinator } = setup([task]);
  const run = coordinator.run(task);
  await tick();
  coordinator.onTerminalClosed("term-1");
  assert.equal(coordinator.activeInstanceCount(task.key), 0);
  host.resolveExit("term-1", 2);
  const outcome = await run;
  assert.deepEqual(outcome, {
    status: "completed",
    exitCode: 2,
    exitIntent: { reveal: "none", closeTab: false },
    terminalId: "term-1",
  });
  assert.equal(coordinator.activeInstanceCount(task.key), 0);
  assert.equal(coordinator.idleTerminalCount(task.key), 0);

  const next = coordinator.run(task);
  await tick();
  assert.deepEqual(host.started[1]!.terminal, { create: true });
  host.resolveExit("term-2", 0);
  await next;
});

test("a missing dependency label returns a defensive error and releases the instance", async () => {
  const a = makeTask("a", { dependsOn: ["ghost"], dependsOrder: "sequence" });
  const { host, coordinator } = setup([a]);
  const outcome = await coordinator.run(a);
  assert.deepEqual(outcome, {
    status: "error",
    message: 'Task dependency "ghost" is not defined.',
  });
  assert.equal(host.started.length, 0);
  assert.equal(coordinator.activeInstanceCount(a.key), 0);
});
