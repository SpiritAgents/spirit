import os from "node:os";
import path from "node:path";

import {
  evaluateWorkspaceTasksTrustGate,
  loadTaskFiles,
  resolveWorkspaceTasks,
  type LoadedTaskFile,
  type ResolveWorkspaceTasksResult,
  type ResolvedTask,
  type TaskPlatform,
  type TaskVariableContext,
  type WorkspaceTasksTrustGateResult,
} from "@spiritagent/host-internal";
import {
  defaultShellForPty,
  shellRunCommandArgs,
} from "@spiritagent/host-internal/default-terminal-shell";
import type { TaskShellDefinition } from "@spiritagent/host-internal/tasks-runtime";

import type { DesktopResolveTaskForRunResult, DesktopTaskMenuItem } from "../types.js";
import { spiritDataDir } from "./storage.js";

export interface TasksCommandContext {
  workspaceRoot?: string;
}

export interface TaskFilesWithTrust {
  files: LoadedTaskFile[];
  gate: WorkspaceTasksTrustGateResult;
}

export interface TaskRunResolver {
  resolveTaskForRun(
    input: TasksCommandContext & { key: string },
  ): Promise<DesktopResolveTaskForRunResult>;
  resolveTaskByLabel(
    input: TasksCommandContext & { label: string },
  ): Promise<DesktopResolveTaskForRunResult>;
  /** Drops cached resolutions (file content changed or a trust decision was applied). */
  invalidate(): void;
}

export async function listTaskMenuItemsCommand(
  context: TasksCommandContext,
): Promise<DesktopTaskMenuItem[]> {
  const result = await loadAndResolveTasks(context);
  return result.menuItems;
}

// The trust verdict is evaluated on every load (never cached): workspace-controlled
// sources drop out entirely until the workspace content hash is allowed.
export async function evaluateAndFilterTaskFiles(
  context: TasksCommandContext,
): Promise<TaskFilesWithTrust> {
  const files = await loadTaskFiles({
    ...(context.workspaceRoot !== undefined ? { workspaceRoot: context.workspaceRoot } : {}),
    spiritDataDir: spiritDataDir(),
  });
  const gate = await evaluateWorkspaceTasksTrustGate({
    spiritDataDir: spiritDataDir(),
    workspaceRoot: context.workspaceRoot,
    files,
  });
  if (gate.status === "allow") {
    return { files, gate };
  }
  return { files: files.filter((file) => file.sourceKind === "user"), gate };
}

export function resolveTaskMenuItems(
  context: TasksCommandContext,
  files: LoadedTaskFile[],
): DesktopTaskMenuItem[] {
  return resolveTaskFiles(context, files).menuItems;
}

// Tasks with runOptions.reevaluateOnRerun === false resolve once and reuse that first
// resolution for every later rerun; all other tasks resolve fresh per call.
export function createTaskRunResolver(): TaskRunResolver {
  const cachedByKey = new Map<string, { task: ResolvedTask; defaultShell: TaskShellDefinition }>();

  const finish = (task: ResolvedTask): DesktopResolveTaskForRunResult => {
    const cached = cachedByKey.get(task.key);
    if (cached !== undefined) {
      return { status: "ok", task: cached.task, defaultShell: cached.defaultShell };
    }
    const defaultShell = defaultTaskShell();
    if (task.runOptions.reevaluateOnRerun === false) {
      cachedByKey.set(task.key, { task, defaultShell });
    }
    return { status: "ok", task, defaultShell };
  };

  return {
    async resolveTaskForRun(input) {
      const cached = cachedByKey.get(input.key);
      if (cached !== undefined) {
        return { status: "ok", task: cached.task, defaultShell: cached.defaultShell };
      }
      const result = await loadAndResolveTasks(input);
      const task = result.tasks.find((candidate) => candidate.key === input.key);
      if (task === undefined) {
        return { status: "notFound" };
      }
      return finish(task);
    },
    async resolveTaskByLabel(input) {
      const result = await loadAndResolveTasks(input);
      const task = result.tasks.find((candidate) => candidate.label === input.label);
      if (task === undefined) {
        return { status: "notFound" };
      }
      return finish(task);
    },
    invalidate() {
      cachedByKey.clear();
    },
  };
}

async function loadAndResolveTasks(
  context: TasksCommandContext,
): Promise<ResolveWorkspaceTasksResult> {
  const { files } = await evaluateAndFilterTaskFiles(context);
  return resolveTaskFiles(context, files);
}

function resolveTaskFiles(
  context: TasksCommandContext,
  files: LoadedTaskFile[],
): ResolveWorkspaceTasksResult {
  const variableContext: TaskVariableContext = {
    ...(context.workspaceRoot !== undefined ? { workspaceFolder: context.workspaceRoot } : {}),
    cwd: process.cwd(),
    userHome: os.homedir(),
    env: process.env,
    pathSeparator: path.sep,
  };
  const result = resolveWorkspaceTasks({
    files,
    variableContext,
    platform: currentTaskPlatform(),
  });
  if (tasksDebugEnabled()) {
    for (const hidden of result.hiddenReasons) {
      console.warn(`[desktop-host][tasks] hidden ${hidden.key} rule=${hidden.rule}`);
    }
  }
  return result;
}

function defaultTaskShell(): TaskShellDefinition {
  const { file } = defaultShellForPty();
  return { executable: file, args: shellRunCommandArgs(file) };
}

function currentTaskPlatform(): TaskPlatform {
  if (process.platform === "win32") {
    return "win32";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

/** Env var `SPIRIT_DESKTOP_TASKS_DEBUG`: logs per-task hidden reasons (rule ids) on every resolve. */
export function tasksDebugEnabled(): boolean {
  const raw = process.env.SPIRIT_DESKTOP_TASKS_DEBUG?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}
