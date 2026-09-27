import type { ResolvedTask } from "@spiritagent/host-internal/tasks";
import {
  TaskRunCoordinator,
  type TaskInvocation,
  type TaskLaunchIntent,
  type TaskProcessHandle,
  type TaskRunHost,
  type TaskTerminalClaim,
} from "@spiritagent/host-internal/tasks-runtime";

import {
  focusTaskTerminal,
  getTaskTerminal,
  setTaskTerminalSessionDisposedHandler,
  updateTaskTerminal,
  waitForTaskTerminal,
} from "@/lib/task-terminal-registry";
import type {
  WorkspaceTaskTerminalSession,
  WorkspaceTaskTerminalStartOptions,
} from "@/lib/workspace-task-terminal";
import {
  addWorkspaceTaskTab,
  closeWorkspaceToolTab,
  type WorkspaceToolTab,
} from "@/lib/workspace-tool-tabs";
import type { DesktopResolveTaskForRunResult } from "@/types";

export type TaskRunServiceDeps = {
  resolveTaskForRun: (key: string) => Promise<DesktopResolveTaskForRunResult>;
  resolveTaskByLabel: (label: string) => Promise<DesktopResolveTaskForRunResult>;
  getTabs: () => readonly WorkspaceToolTab[];
  setTabs: (tabs: WorkspaceToolTab[]) => void;
  getActiveTabId: () => string;
  setActiveTabId: (tabId: string) => void;
  setToolsOpen: (open: boolean) => void;
  getWorkspaceRoot: () => string;
};

type TaskShellPair = { executable: string; args: string[] };

let deps: TaskRunServiceDeps | undefined;
let coordinator: TaskRunCoordinator | undefined;
const resolvedByLabel = new Map<string, ResolvedTask>();

export function initTaskRunService(nextDeps: TaskRunServiceDeps): void {
  deps = nextDeps;
  setTaskTerminalSessionDisposedHandler((tabId) => {
    coordinator?.onTerminalClosed(tabId);
  });
}

/** Test-only escape hatch. */
export function resetTaskRunService(): void {
  deps = undefined;
  coordinator = undefined;
  resolvedByLabel.clear();
}

export async function runTaskByKey(key: string): Promise<void> {
  const currentDeps = deps;
  if (currentDeps === undefined) {
    return;
  }
  const resolved = await currentDeps.resolveTaskForRun(key);
  if (resolved.status !== "ok") {
    // The menu refreshes live, so a stale key (edited/removed file) is a silent no-op.
    return;
  }
  await prewarmDependencies(currentDeps, resolved.task);
  const outcome = await ensureCoordinator(resolved.defaultShell).run(resolved.task);
  if (outcome.status !== "completed") {
    return;
  }
  if (outcome.exitIntent.closeTab) {
    const next = closeWorkspaceToolTab(
      currentDeps.getTabs(),
      currentDeps.getActiveTabId(),
      outcome.terminalId,
    );
    currentDeps.setTabs(next.tabs);
    currentDeps.setActiveTabId(next.activeId);
    return;
  }
  if (outcome.exitIntent.reveal === "expand") {
    currentDeps.setToolsOpen(true);
    currentDeps.setActiveTabId(outcome.terminalId);
  }
}

// The coordinator resolves dependency labels synchronously, so the transitive label set
// is fetched over IPC up front into the map that resolveByLabel reads.
async function prewarmDependencies(
  currentDeps: TaskRunServiceDeps,
  rootTask: ResolvedTask,
): Promise<void> {
  const pending = [...rootTask.dependsOn];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const label = pending.pop()!;
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    const resolved = await currentDeps.resolveTaskByLabel(label);
    if (resolved.status === "ok") {
      resolvedByLabel.set(label, resolved.task);
      pending.push(...resolved.task.dependsOn);
    }
  }
}

/** Display command line for the echo presentation: shell invocations carry it as the trailing arg. */
export function formatTaskDisplayCommandLine(
  task: ResolvedTask,
  invocation: TaskInvocation,
): string {
  if (task.type === "shell") {
    return invocation.args[invocation.args.length - 1] ?? invocation.file;
  }
  return [invocation.file, ...invocation.args].join(" ");
}

function ensureCoordinator(defaultShell: TaskShellPair): TaskRunCoordinator {
  if (coordinator === undefined) {
    coordinator = new TaskRunCoordinator({
      host: new DesktopTaskRunHost(),
      defaultShell,
      resolveByLabel: (label) => resolvedByLabel.get(label),
    });
  }
  return coordinator;
}

function requireDeps(): TaskRunServiceDeps {
  if (deps === undefined) {
    throw new Error("task run service is not initialized");
  }
  return deps;
}

function createTaskTab(currentDeps: TaskRunServiceDeps, task: ResolvedTask): string {
  const next = addWorkspaceTaskTab(currentDeps.getTabs(), {
    taskKey: task.key,
    label: task.label,
    pinnedTitle: task.presentation.preserveTerminalName === true,
  });
  currentDeps.setTabs(next.tabs);
  currentDeps.setActiveTabId(next.activeId);
  return next.activeId;
}

class DesktopTaskRunHost implements TaskRunHost {
  private readonly exitByTerminal = new Map<string, Promise<number>>();

  async startProcess(request: {
    task: ResolvedTask;
    instanceKey: string;
    invocation: TaskInvocation;
    launchIntent: TaskLaunchIntent;
    terminal: TaskTerminalClaim;
  }): Promise<TaskProcessHandle> {
    const currentDeps = requireDeps();
    const { task, instanceKey, invocation, launchIntent, terminal } = request;
    let tabId: string;
    let reused = false;
    if ("reuse" in terminal && getTaskTerminal(terminal.reuse) !== undefined) {
      tabId = terminal.reuse;
      reused = true;
    } else {
      // Covers {create} as well as a pool entry that outlived its tab.
      tabId = createTaskTab(currentDeps, task);
    }

    const registration = await waitForTaskTerminal(tabId);
    if (registration === undefined) {
      // The tab never mounted a session (closed instantly, or no pty bridge): settle
      // immediately so the coordinator's bookkeeping still runs.
      this.exitByTerminal.set(tabId, Promise.resolve(1));
      return { terminalId: tabId };
    }

    updateTaskTerminal(tabId, { running: true, instanceKey });

    const startOptions: WorkspaceTaskTerminalStartOptions = {
      cwd: task.options.cwd ?? currentDeps.getWorkspaceRoot(),
      ...(task.options.env !== undefined ? { env: task.options.env } : {}),
      ...(task.presentation.echo
        ? { echoLine: formatTaskDisplayCommandLine(task, invocation) }
        : {}),
    };

    const exitPromise = reused
      ? respawnOnSession(registration.session, task, invocation, startOptions)
      : registration.session.start(invocation, startOptions);
    this.exitByTerminal.set(tabId, exitPromise);

    if (launchIntent.reveal === "expand") {
      currentDeps.setToolsOpen(true);
      currentDeps.setActiveTabId(tabId);
    }
    if (launchIntent.focus) {
      focusTaskTerminal(tabId);
    }
    return { terminalId: tabId };
  }

  async waitForExit(handle: TaskProcessHandle): Promise<number> {
    const exitPromise = this.exitByTerminal.get(handle.terminalId);
    if (exitPromise === undefined) {
      return 1;
    }
    const exitCode = await exitPromise;
    this.exitByTerminal.delete(handle.terminalId);
    updateTaskTerminal(handle.terminalId, { running: false });
    return exitCode;
  }

  async terminate(handle: TaskProcessHandle): Promise<void> {
    getTaskTerminal(handle.terminalId)?.session.kill();
  }

  async promptInstanceLimit(): Promise<"cancel"> {
    return "cancel";
  }
}

function respawnOnSession(
  session: WorkspaceTaskTerminalSession,
  task: ResolvedTask,
  invocation: TaskInvocation,
  startOptions: WorkspaceTaskTerminalStartOptions,
): Promise<number> {
  if (task.presentation.clear) {
    session.clear();
  }
  return session.respawn(invocation, startOptions);
}
