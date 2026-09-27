import type { ResolvedTask } from "../tasks/public.js";
import { TaskInstanceRegistry } from "./instances.js";
import { TaskTerminalPool, type TaskTerminalClaim } from "./pool.js";
import {
  computeExitIntent,
  computeLaunchIntent,
  type TaskExitIntent,
  type TaskLaunchIntent,
} from "./presentation.js";
import { buildTaskInvocation, type TaskInvocation, type TaskShellDefinition } from "./quoting.js";

export interface TaskProcessHandle {
  terminalId: string;
}

export interface TaskRunHost {
  startProcess(req: {
    task: ResolvedTask;
    instanceKey: string;
    invocation: TaskInvocation;
    launchIntent: TaskLaunchIntent;
    terminal: TaskTerminalClaim;
  }): Promise<TaskProcessHandle>;
  waitForExit(handle: TaskProcessHandle): Promise<number>;
  terminate(handle: TaskProcessHandle): Promise<void>;
  promptInstanceLimit(task: ResolvedTask, active: number): Promise<"new" | "replace" | "cancel">;
}

export type TaskRunOutcome =
  | { status: "completed"; exitCode: number; exitIntent: TaskExitIntent; terminalId: string }
  | { status: "cancelled" }
  | { status: "aborted"; exitCode: number; failedTaskKey: string }
  | { status: "error"; message: string };

export interface TaskRunCoordinatorOptions {
  host: TaskRunHost;
  defaultShell: TaskShellDefinition;
  resolveByLabel: (label: string) => ResolvedTask | undefined;
}

type DependencyResult =
  | { status: "finished"; exitCode: number; taskKey: string }
  | { status: "aborted"; exitCode: number; failedTaskKey: string }
  | { status: "error"; message: string };

interface RunningEntry {
  task: ResolvedTask;
  instanceKey: string;
  handle?: TaskProcessHandle;
  abandoned: boolean;
  settle: (exitCode: number) => void;
  exitPromise: Promise<number>;
}

export class TaskRunCoordinator {
  private readonly instances = new TaskInstanceRegistry();
  private readonly pool = new TaskTerminalPool();
  private readonly runningByInstanceKey = new Map<string, RunningEntry>();

  constructor(private readonly options: TaskRunCoordinatorOptions) {}

  async run(task: ResolvedTask): Promise<TaskRunOutcome> {
    const acquired = await this.acquireForMainTask(task);
    if ("outcome" in acquired) {
      return acquired.outcome;
    }
    const entry = this.createRunningEntry(task, acquired.instanceKey);
    const dependencyFailure = await this.runDependencies(task);
    if (dependencyFailure !== undefined) {
      this.finishBeforeStart(entry, dependencyFailure);
      return dependencyFailure;
    }
    return this.startAndAwait(task, entry);
  }

  async terminateInstance(instanceKey: string): Promise<void> {
    const entry = this.runningByInstanceKey.get(instanceKey);
    if (entry === undefined || entry.handle === undefined) {
      return;
    }
    await this.options.host.terminate(entry.handle);
    // The host kills the process, waitForExit resolves, and the exit path releases the
    // instance and settles the entry; awaiting it keeps the bookkeeping serialized.
    await entry.exitPromise;
  }

  // The desktop layer must call this whenever a task tab closes. The host kills the pty
  // itself; the coordinator only stops tracking: the instance is released immediately and
  // the still-pending exit path skips the idle-pool offer, so nothing leaks.
  onTerminalClosed(terminalId: string): void {
    this.pool.remove(terminalId);
    for (const entry of this.runningByInstanceKey.values()) {
      if (entry.handle?.terminalId === terminalId) {
        entry.abandoned = true;
        this.runningByInstanceKey.delete(entry.instanceKey);
        this.instances.release(entry.instanceKey);
      }
    }
  }

  activeInstanceCount(key: string): number {
    return this.instances.activeCount(key);
  }

  idleTerminalCount(key: string): number {
    return this.pool.idleCount(key);
  }

  private async acquireForMainTask(
    task: ResolvedTask,
  ): Promise<{ instanceKey: string } | { outcome: TaskRunOutcome }> {
    let limit = task.runOptions.instanceLimit;
    for (;;) {
      const acquired = this.instances.tryAcquire(task.key, limit);
      if (acquired.status === "acquired") {
        return { instanceKey: acquired.instanceKey };
      }
      const choice = await this.options.host.promptInstanceLimit(task, acquired.active.length);
      if (choice === "cancel") {
        return { outcome: { status: "cancelled" } };
      }
      if (choice === "new") {
        // The user explicitly chose a parallel instance, so the limit no longer applies.
        limit = acquired.active.length + 1;
        continue;
      }
      const oldest = this.instances.oldestActive(task.key);
      if (oldest === undefined) {
        return { outcome: { status: "error", message: `No active instance of "${task.label}".` } };
      }
      await this.terminateInstance(oldest);
    }
  }

  private async runDependencies(
    task: ResolvedTask,
  ): Promise<
    | { status: "aborted"; exitCode: number; failedTaskKey: string }
    | { status: "error"; message: string }
    | undefined
  > {
    if (task.dependsOn.length === 0) {
      return undefined;
    }
    if (task.dependsOrder === "sequence") {
      for (const label of task.dependsOn) {
        const failure = dependencyFailure(await this.runDependency(label));
        if (failure !== undefined) {
          return failure;
        }
      }
      return undefined;
    }
    const results = await Promise.all(task.dependsOn.map((label) => this.runDependency(label)));
    // The first failure in dependsOn order wins, after every dependency has exited.
    for (const result of results) {
      const failure = dependencyFailure(result);
      if (failure !== undefined) {
        return failure;
      }
    }
    return undefined;
  }

  private async runDependency(label: string): Promise<DependencyResult> {
    const dependency = this.options.resolveByLabel(label);
    if (dependency === undefined) {
      // Phase 1 hides tasks with unresolved dependencies, so this indicates a host bug.
      return { status: "error", message: `Task dependency "${label}" is not defined.` };
    }
    // An already-active dependency is not restarted; its in-flight exit is awaited instead.
    if (this.instances.activeCount(dependency.key) > 0) {
      const exitCode = await this.awaitActiveInstances(dependency.key);
      return { status: "finished", exitCode, taskKey: dependency.key };
    }
    return this.runDependencyFlow(dependency);
  }

  private async runDependencyFlow(task: ResolvedTask): Promise<DependencyResult> {
    const acquired = this.instances.tryAcquire(task.key, task.runOptions.instanceLimit);
    if (acquired.status !== "acquired") {
      // Unreachable: the caller checked activeCount synchronously before this acquire.
      return { status: "error", message: `Could not start an instance of "${task.label}".` };
    }
    const entry = this.createRunningEntry(task, acquired.instanceKey);
    const dependencyFailure = await this.runDependencies(task);
    if (dependencyFailure !== undefined) {
      this.finishBeforeStart(entry, dependencyFailure);
      return dependencyFailure;
    }
    const outcome = await this.startAndAwait(task, entry);
    return { status: "finished", exitCode: outcome.exitCode, taskKey: task.key };
  }

  private async startAndAwait(
    task: ResolvedTask,
    entry: RunningEntry,
  ): Promise<{
    status: "completed";
    exitCode: number;
    exitIntent: TaskExitIntent;
    terminalId: string;
  }> {
    const terminal = this.pool.claim(task.key, task.presentation.panel);
    const invocation = buildTaskInvocation(task, this.options.defaultShell);
    const handle = await this.options.host.startProcess({
      task,
      instanceKey: entry.instanceKey,
      invocation,
      launchIntent: computeLaunchIntent(task.presentation),
      terminal,
    });
    entry.handle = handle;
    const exitCode = await this.options.host.waitForExit(handle);
    this.runningByInstanceKey.delete(entry.instanceKey);
    this.instances.release(entry.instanceKey);
    const exitIntent = computeExitIntent(task.presentation, exitCode, task.isBackground);
    if (!entry.abandoned) {
      // The host owns closing the tab; the coordinator only keeps the pool consistent.
      if (exitIntent.closeTab) {
        this.pool.remove(handle.terminalId);
      } else {
        this.pool.offerIdle(task.key, handle.terminalId);
      }
    }
    entry.settle(exitCode);
    return { status: "completed", exitCode, exitIntent, terminalId: handle.terminalId };
  }

  private async awaitActiveInstances(taskKey: string): Promise<number> {
    let exitCode = 0;
    for (;;) {
      const oldest = this.instances.oldestActive(taskKey);
      if (oldest === undefined) {
        return exitCode;
      }
      const entry = this.runningByInstanceKey.get(oldest);
      if (entry === undefined) {
        return exitCode;
      }
      const code = await entry.exitPromise;
      if (code !== 0 && exitCode === 0) {
        exitCode = code;
      }
    }
  }

  private createRunningEntry(task: ResolvedTask, instanceKey: string): RunningEntry {
    let settle!: (exitCode: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      settle = resolve;
    });
    const entry: RunningEntry = { task, instanceKey, abandoned: false, settle, exitPromise };
    this.runningByInstanceKey.set(instanceKey, entry);
    return entry;
  }

  private finishBeforeStart(
    entry: RunningEntry,
    failure: { status: "aborted"; exitCode: number } | { status: "error" },
  ): void {
    this.runningByInstanceKey.delete(entry.instanceKey);
    this.instances.release(entry.instanceKey);
    entry.settle(failure.status === "aborted" ? failure.exitCode : 1);
  }
}

function dependencyFailure(
  result: DependencyResult,
):
  | { status: "aborted"; exitCode: number; failedTaskKey: string }
  | { status: "error"; message: string }
  | undefined {
  if (result.status === "error" || result.status === "aborted") {
    return result;
  }
  if (result.exitCode !== 0) {
    return { status: "aborted", exitCode: result.exitCode, failedTaskKey: result.taskKey };
  }
  return undefined;
}
