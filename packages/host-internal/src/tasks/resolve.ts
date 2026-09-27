import { taskKey } from "./keys.js";
import { mergeTaskLayers } from "./merge.js";
import {
  normalizeTaskFile,
  type HiddenTaskReason,
  type LoadedTaskFile,
  type MergedTask,
  type ResolveWorkspaceTasksResult,
  type ResolvedTask,
  type TaskArgValue,
  type TaskCommandValue,
  type TaskFileSourceKind,
  type TaskHiddenRule,
  type TaskMenuItem,
  type TaskOptions,
  type TaskPlatform,
} from "./schema.js";
import {
  collectTaskVariableStrings,
  findUnsupportedTaskVariable,
  substituteTaskVariables,
  usesWorkspaceFolderVariable,
  type TaskVariableContext,
} from "./variables.js";

export interface ResolveWorkspaceTasksInput {
  files: LoadedTaskFile[];
  variableContext: TaskVariableContext;
  platform: TaskPlatform;
}

interface NamespaceEntry {
  key: string;
  sourceFile: string;
  task: MergedTask;
}

const SOURCE_PRIORITY: Record<TaskFileSourceKind, number> = {
  workspace: 0,
  user: 1,
  "vscode-compat": 2,
};

export function resolveWorkspaceTasks(
  input: ResolveWorkspaceTasksInput,
): ResolveWorkspaceTasksResult {
  const deduped: NamespaceEntry[] = [];
  const byLabel = new Map<string, NamespaceEntry>();
  const files = input.files
    .slice()
    .sort((left, right) => SOURCE_PRIORITY[left.sourceKind] - SOURCE_PRIORITY[right.sourceKind]);
  for (const file of files) {
    const normalized = normalizeTaskFile(file.json);
    if (normalized === undefined) {
      continue;
    }
    for (const taskEntry of normalized.tasks) {
      if (byLabel.has(taskEntry.label)) {
        continue;
      }
      const entry: NamespaceEntry = {
        key: taskKey(file.path, taskEntry.label),
        sourceFile: file.path,
        task: mergeTaskLayers(normalized, taskEntry, input.platform),
      };
      byLabel.set(taskEntry.label, entry);
      deduped.push(entry);
    }
  }

  const hiddenRules = new Map<string, TaskHiddenRule>();
  const hiddenReasons: HiddenTaskReason[] = [];
  const hideTask = (entry: NamespaceEntry, rule: TaskHiddenRule): void => {
    if (hiddenRules.has(entry.key)) {
      return;
    }
    hiddenRules.set(entry.key, rule);
    hiddenReasons.push({ key: entry.key, label: entry.task.label, rule });
  };

  for (const entry of deduped) {
    const rule = firstPerTaskRule(entry.task, byLabel, input.variableContext);
    if (rule !== undefined) {
      hideTask(entry, rule);
    }
  }
  for (const entry of deduped) {
    if (!hiddenRules.has(entry.key) && isOnDependencyCycle(entry, byLabel)) {
      hideTask(entry, "cyclicDependency");
    }
  }
  // Transitive hiding propagates: a task depending on a hidden or unknown label is hidden too.
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const entry of deduped) {
      if (hiddenRules.has(entry.key)) {
        continue;
      }
      const hasHiddenDependency = entry.task.dependsOn.labels.some((label) => {
        const target = byLabel.get(label);
        return target === undefined || hiddenRules.has(target.key);
      });
      if (hasHiddenDependency) {
        hideTask(entry, "transitiveHiddenDependency");
        propagated = true;
      }
    }
  }

  const tasks: ResolvedTask[] = [];
  const menuItems: TaskMenuItem[] = [];
  for (const entry of deduped) {
    if (hiddenRules.has(entry.key)) {
      continue;
    }
    const resolved = buildResolvedTask(entry, input.variableContext);
    tasks.push(resolved);
    if (!resolved.hide) {
      const item: TaskMenuItem = { key: resolved.key, label: resolved.label };
      if (resolved.detail !== undefined) {
        item.detail = resolved.detail;
      }
      if (resolved.iconId !== undefined) {
        item.iconId = resolved.iconId;
      }
      menuItems.push(item);
    }
  }
  return { tasks, menuItems, hiddenReasons };
}

function firstPerTaskRule(
  task: MergedTask,
  byLabel: Map<string, NamespaceEntry>,
  context: TaskVariableContext,
): TaskHiddenRule | undefined {
  if (task.command === undefined) {
    return "invalidTask";
  }
  const strings = collectTaskVariableStrings(task.command, task.args, task.options);
  if (findUnsupportedTaskVariable(strings) !== undefined) {
    return "unsupportedVariable";
  }
  if (context.workspaceFolder === undefined && usesWorkspaceFolderVariable(strings)) {
    return "unresolvableWorkspaceVariable";
  }
  if (task.runOptions.runOn !== "default") {
    return "runOn";
  }
  if (task.dependsOn.hasObjectForm) {
    return "dependsOnObjectForm";
  }
  if (task.dependsOn.labels.some((label) => byLabel.get(label)?.task.isBackground === true)) {
    return "dependsOnBackground";
  }
  if (task.runOptions.instancePolicy !== "prompt") {
    return "instancePolicy";
  }
  return undefined;
}

function isOnDependencyCycle(start: NamespaceEntry, byLabel: Map<string, NamespaceEntry>): boolean {
  const visited = new Set<string>();
  const pending = [...start.task.dependsOn.labels];
  while (pending.length > 0) {
    const label = pending.pop()!;
    if (label === start.task.label) {
      return true;
    }
    if (visited.has(label)) {
      continue;
    }
    visited.add(label);
    const target = byLabel.get(label);
    if (target !== undefined) {
      pending.push(...target.task.dependsOn.labels);
    }
  }
  return false;
}

function buildResolvedTask(entry: NamespaceEntry, context: TaskVariableContext): ResolvedTask {
  const { task } = entry;
  const resolved: ResolvedTask = {
    key: entry.key,
    sourceFile: entry.sourceFile,
    label: task.label,
    hide: task.hide ?? false,
    type: task.type,
    command: substituteCommand(task.command!, context),
    args: (task.args ?? []).map((arg) => substituteArg(arg, context)),
    quoting: task.quoting,
    options: substituteOptions(task.options, context),
    isBackground: task.isBackground ?? false,
    promptOnClose: task.promptOnClose ?? false,
    dependsOn: [...task.dependsOn.labels],
    dependsOrder: task.dependsOrder,
    runOptions: {
      reevaluateOnRerun: task.runOptions.reevaluateOnRerun,
      instanceLimit: task.runOptions.instanceLimit,
    },
    presentation: {
      echo: task.presentation.echo ?? true,
      reveal: task.presentation.reveal ?? "always",
      focus: task.presentation.focus ?? false,
      panel: task.presentation.panel ?? "shared",
      clear: task.presentation.clear ?? false,
      close: task.presentation.close ?? false,
      preserveTerminalName: task.presentation.preserveTerminalName ?? false,
    },
  };
  if (task.detail !== undefined) {
    resolved.detail = task.detail;
  }
  if (task.iconId !== undefined) {
    resolved.iconId = task.iconId;
  }
  return resolved;
}

function substituteCommand(
  command: TaskCommandValue,
  context: TaskVariableContext,
): TaskCommandValue {
  if (typeof command === "string") {
    return substituteTaskVariables(command, context);
  }
  if (Array.isArray(command)) {
    return command.map((part) => substituteTaskVariables(part, context));
  }
  return { value: substituteTaskVariables(command.value, context), quoting: command.quoting };
}

function substituteArg(arg: TaskArgValue, context: TaskVariableContext): TaskArgValue {
  if (typeof arg === "string") {
    return substituteTaskVariables(arg, context);
  }
  return { value: substituteTaskVariables(arg.value, context), quoting: arg.quoting };
}

function substituteOptions(
  options: TaskOptions | undefined,
  context: TaskVariableContext,
): TaskOptions {
  const substituted: TaskOptions = {};
  if (options?.cwd !== undefined) {
    substituted.cwd = substituteTaskVariables(options.cwd, context);
  }
  if (options?.env !== undefined) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env)) {
      env[key] = substituteTaskVariables(value, context);
    }
    substituted.env = env;
  }
  if (options?.shell !== undefined) {
    const shell: { executable?: string; args?: string[] } = {};
    if (options.shell.executable !== undefined) {
      shell.executable = substituteTaskVariables(options.shell.executable, context);
    }
    if (options.shell.args !== undefined) {
      shell.args = options.shell.args.map((arg) => substituteTaskVariables(arg, context));
    }
    substituted.shell = shell;
  }
  return substituted;
}
