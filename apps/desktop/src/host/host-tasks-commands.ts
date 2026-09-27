import os from "node:os";
import path from "node:path";

import {
  loadTaskFiles,
  resolveWorkspaceTasks,
  type ResolveWorkspaceTasksResult,
  type ResolvedTask,
  type TaskPlatform,
  type TaskVariableContext,
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

export interface TaskRunResolver {
  resolveTaskForRun(
    input: TasksCommandContext & { key: string },
  ): Promise<DesktopResolveTaskForRunResult>;
  resolveTaskByLabel(
    input: TasksCommandContext & { label: string },
  ): Promise<DesktopResolveTaskForRunResult>;
}

export async function listTaskMenuItemsCommand(
  context: TasksCommandContext,
): Promise<DesktopTaskMenuItem[]> {
  const result = await loadAndResolveTasks(context);
  return result.menuItems;
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
  };
}

async function loadAndResolveTasks(
  context: TasksCommandContext,
): Promise<ResolveWorkspaceTasksResult> {
  const files = await loadTaskFiles({
    ...(context.workspaceRoot !== undefined ? { workspaceRoot: context.workspaceRoot } : {}),
    spiritDataDir: spiritDataDir(),
  });
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
function tasksDebugEnabled(): boolean {
  const raw = process.env.SPIRIT_DESKTOP_TASKS_DEBUG?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}
