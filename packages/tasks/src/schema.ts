export * from "@spiritagent/api/tasks";
import type {
  TaskPlatform,
  TaskQuotingStyle,
  TaskCommandValue,
  TaskArgValue,
  TaskType,
  TaskShellConfiguration,
  TaskOptions,
  TaskPresentation,
  TaskRunOn,
  TaskInstancePolicy,
  TaskRunOptions,
  NormalizedTaskDependsOn,
  NormalizedTaskOsOverride,
  NormalizedTask,
  NormalizedTaskFileDefaults,
  NormalizedTaskFile,
} from "@spiritagent/api/tasks";

export function normalizeTaskFile(json: unknown): NormalizedTaskFile | undefined {
  if (!isPlainObject(json)) {
    return undefined;
  }
  const record = json as Record<string, unknown>;
  const tasks = Array.isArray(record.tasks)
    ? record.tasks
        .map((entry) => normalizeTaskEntry(entry))
        .filter((entry): entry is NormalizedTask => entry !== undefined)
    : [];
  return {
    defaults: normalizeFileDefaults(record),
    osDefaults: normalizeOsBlocks(record),
    tasks,
  };
}

export function normalizeTaskEntry(value: unknown): NormalizedTask | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || !record.label.trim()) {
    return undefined;
  }
  // A non-shell/process type marks an extension-customized entry (npm, grunt, …): drop it
  // silently rather than hiding it, so it neither runs nor displaces same-label tasks.
  if (typeof record.type === "string" && record.type !== "shell" && record.type !== "process") {
    return undefined;
  }
  const task: NormalizedTask = {
    label: record.label,
    quoting: normalizeTaskQuoting(record.quoting) ?? "strong",
    os: normalizeOsBlocks(record),
    dependsOn: normalizeTaskDependsOn(record.dependsOn),
    dependsOrder: record.dependsOrder === "sequence" ? "sequence" : "parallel",
    runOptions: normalizeTaskRunOptions(record.runOptions),
    presentation: normalizeTaskPresentation(record.presentation),
  };
  const type = normalizeTaskType(record.type);
  if (type !== undefined) {
    task.type = type;
  }
  const command = normalizeTaskCommand(record.command);
  if (command !== undefined) {
    task.command = command;
  }
  const args = normalizeTaskArgs(record.args);
  if (args !== undefined) {
    task.args = args;
  }
  const options = normalizeTaskOptions(record.options);
  if (options !== undefined) {
    task.options = options;
  }
  if (typeof record.isBackground === "boolean") {
    task.isBackground = record.isBackground;
  }
  if (typeof record.promptOnClose === "boolean") {
    task.promptOnClose = record.promptOnClose;
  }
  const iconId = normalizeTaskIconId(record.icon);
  if (iconId !== undefined) {
    task.iconId = iconId;
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    task.detail = record.detail;
  }
  if (typeof record.hide === "boolean") {
    task.hide = record.hide;
  }
  return task;
}

function normalizeFileDefaults(record: Record<string, unknown>): NormalizedTaskFileDefaults {
  const defaults: NormalizedTaskFileDefaults = {};
  const type = normalizeTaskType(record.type);
  if (type !== undefined) {
    defaults.type = type;
  }
  const command = normalizeTaskCommand(record.command);
  if (command !== undefined) {
    defaults.command = command;
  }
  const args = normalizeTaskArgs(record.args);
  if (args !== undefined) {
    defaults.args = args;
  }
  const options = normalizeTaskOptions(record.options);
  if (options !== undefined) {
    defaults.options = options;
  }
  if (typeof record.isBackground === "boolean") {
    defaults.isBackground = record.isBackground;
  }
  if (typeof record.promptOnClose === "boolean") {
    defaults.promptOnClose = record.promptOnClose;
  }
  if (isPlainObject(record.presentation)) {
    defaults.presentation = normalizeTaskPresentation(record.presentation);
  }
  return defaults;
}

function normalizeOsBlocks(
  record: Record<string, unknown>,
): Partial<Record<TaskPlatform, NormalizedTaskOsOverride>> {
  const blocks: Partial<Record<TaskPlatform, NormalizedTaskOsOverride>> = {};
  const windows = normalizeOsOverride(record.windows);
  if (windows !== undefined) {
    blocks.win32 = windows;
  }
  const osx = normalizeOsOverride(record.osx);
  if (osx !== undefined) {
    blocks.darwin = osx;
  }
  const linux = normalizeOsOverride(record.linux);
  if (linux !== undefined) {
    blocks.linux = linux;
  }
  return blocks;
}

function normalizeOsOverride(value: unknown): NormalizedTaskOsOverride | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const block: NormalizedTaskOsOverride = {};
  const command = normalizeTaskCommand(record.command);
  if (command !== undefined) {
    block.command = command;
  }
  const args = normalizeTaskArgs(record.args);
  if (args !== undefined) {
    block.args = args;
  }
  const options = normalizeTaskOptions(record.options);
  if (options !== undefined) {
    block.options = options;
  }
  if (block.command === undefined && block.args === undefined && block.options === undefined) {
    return undefined;
  }
  return block;
}

export function normalizeTaskType(value: unknown): TaskType | undefined {
  if (value === "shell" || value === "process") {
    return value;
  }
  return undefined;
}

export function normalizeTaskQuoting(value: unknown): TaskQuotingStyle | undefined {
  if (value === "escape" || value === "strong" || value === "weak") {
    return value;
  }
  return undefined;
}

export function normalizeTaskCommand(value: unknown): TaskCommandValue | undefined {
  if (typeof value === "string") {
    return value.trim() ? value : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts : undefined;
  }
  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string" && record.value.trim()) {
      return { value: record.value, quoting: normalizeTaskQuoting(record.quoting) ?? "strong" };
    }
  }
  return undefined;
}

export function normalizeTaskArgs(value: unknown): TaskArgValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const args: TaskArgValue[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      args.push(entry);
    } else if (isPlainObject(entry)) {
      const record = entry as Record<string, unknown>;
      if (typeof record.value === "string") {
        args.push({
          value: record.value,
          quoting: normalizeTaskQuoting(record.quoting) ?? "strong",
        });
      }
    }
  }
  return args;
}

export function normalizeTaskOptions(value: unknown): TaskOptions | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const options: TaskOptions = {};
  if (typeof record.cwd === "string" && record.cwd.trim()) {
    options.cwd = record.cwd;
  }
  if (isPlainObject(record.env)) {
    const env: Record<string, string> = {};
    for (const [key, envValue] of Object.entries(record.env as Record<string, unknown>)) {
      if (typeof envValue === "string") {
        env[key] = envValue;
      }
    }
    if (Object.keys(env).length > 0) {
      options.env = env;
    }
  }
  if (isPlainObject(record.shell)) {
    const shellRecord = record.shell as Record<string, unknown>;
    const shell: TaskShellConfiguration = {};
    if (typeof shellRecord.executable === "string" && shellRecord.executable.trim()) {
      shell.executable = shellRecord.executable;
    }
    if (Array.isArray(shellRecord.args)) {
      shell.args = shellRecord.args.filter((arg): arg is string => typeof arg === "string");
    }
    if (shell.executable !== undefined || shell.args !== undefined) {
      options.shell = shell;
    }
  }
  if (options.cwd === undefined && options.env === undefined && options.shell === undefined) {
    return undefined;
  }
  return options;
}

export function normalizeTaskPresentation(value: unknown): TaskPresentation {
  const presentation: TaskPresentation = {};
  if (!isPlainObject(value)) {
    return presentation;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.echo === "boolean") {
    presentation.echo = record.echo;
  }
  if (record.reveal === "always" || record.reveal === "silent" || record.reveal === "never") {
    presentation.reveal = record.reveal;
  }
  if (typeof record.focus === "boolean") {
    presentation.focus = record.focus;
  }
  if (record.panel === "shared" || record.panel === "dedicated" || record.panel === "new") {
    presentation.panel = record.panel;
  }
  if (typeof record.clear === "boolean") {
    presentation.clear = record.clear;
  }
  if (typeof record.close === "boolean") {
    presentation.close = record.close;
  }
  if (typeof record.preserveTerminalName === "boolean") {
    presentation.preserveTerminalName = record.preserveTerminalName;
  }
  return presentation;
}

export function normalizeTaskDependsOn(value: unknown): NormalizedTaskDependsOn {
  const labels: string[] = [];
  let hasObjectForm = false;
  const read = (entry: unknown): void => {
    if (typeof entry === "string") {
      if (entry.trim()) {
        labels.push(entry);
      }
    } else if (isPlainObject(entry)) {
      hasObjectForm = true;
    }
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      read(entry);
    }
  } else if (value !== undefined) {
    read(value);
  }
  return { labels, hasObjectForm };
}

export function normalizeTaskRunOptions(value: unknown): TaskRunOptions {
  const record = isPlainObject(value) ? (value as Record<string, unknown>) : {};
  return {
    reevaluateOnRerun:
      typeof record.reevaluateOnRerun === "boolean" ? record.reevaluateOnRerun : true,
    runOn: normalizeTaskRunOn(record.runOn),
    instanceLimit:
      typeof record.instanceLimit === "number" &&
      Number.isInteger(record.instanceLimit) &&
      record.instanceLimit >= 1
        ? record.instanceLimit
        : 1,
    instancePolicy: normalizeTaskInstancePolicy(record.instancePolicy) ?? "prompt",
  };
}

// Unknown strings stay distinguishable (they hide the task); absent or non-string values
// mean the default.
function normalizeTaskRunOn(value: unknown): TaskRunOn | "unknown" {
  if (value === "folderOpen" || value === "worktreeCreated") {
    return value;
  }
  if (typeof value === "string" && value !== "default") {
    return "unknown";
  }
  return "default";
}

function normalizeTaskInstancePolicy(value: unknown): TaskInstancePolicy | undefined {
  if (
    value === "prompt" ||
    value === "terminateNewest" ||
    value === "terminateOldest" ||
    value === "warn" ||
    value === "silent"
  ) {
    return value;
  }
  return undefined;
}

function normalizeTaskIconId(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
