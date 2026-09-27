import type {
  MergedTask,
  NormalizedTask,
  NormalizedTaskFile,
  NormalizedTaskPresentation,
  TaskOptions,
  TaskPlatform,
  TaskShellConfiguration,
} from "./schema.js";

// Merge chain (low to high): file-level defaults < file-level OS block < task < task-level OS
// block. Hide rules and variable scanning always evaluate the merged result.
export function mergeTaskLayers(
  file: NormalizedTaskFile,
  task: NormalizedTask,
  platform: TaskPlatform,
): MergedTask {
  const fileOs = file.osDefaults[platform];
  const taskOs = task.os[platform];
  const merged: MergedTask = {
    label: task.label,
    type: task.type ?? file.defaults.type ?? "shell",
    quoting: task.quoting,
    dependsOn: task.dependsOn,
    dependsOrder: task.dependsOrder,
    runOptions: task.runOptions,
    presentation: mergeTaskPresentation(file.defaults.presentation, task.presentation),
    hasProblemMatcher:
      file.defaults.hasProblemMatcher ||
      fileOs?.hasProblemMatcher === true ||
      task.hasProblemMatcher ||
      taskOs?.hasProblemMatcher === true,
  };
  const command = taskOs?.command ?? task.command ?? fileOs?.command ?? file.defaults.command;
  if (command !== undefined) {
    merged.command = command;
  }
  const args = taskOs?.args ?? task.args ?? fileOs?.args ?? file.defaults.args;
  if (args !== undefined) {
    merged.args = args;
  }
  const options = mergeTaskOptions(
    file.defaults.options,
    fileOs?.options,
    task.options,
    taskOs?.options,
  );
  if (options !== undefined) {
    merged.options = options;
  }
  const isBackground = task.isBackground ?? file.defaults.isBackground;
  if (isBackground !== undefined) {
    merged.isBackground = isBackground;
  }
  const promptOnClose = task.promptOnClose ?? file.defaults.promptOnClose;
  if (promptOnClose !== undefined) {
    merged.promptOnClose = promptOnClose;
  }
  if (task.iconId !== undefined) {
    merged.iconId = task.iconId;
  }
  if (task.detail !== undefined) {
    merged.detail = task.detail;
  }
  if (task.hide !== undefined) {
    merged.hide = task.hide;
  }
  return merged;
}

function mergeTaskOptions(...layers: (TaskOptions | undefined)[]): TaskOptions | undefined {
  let cwd: string | undefined;
  let env: Record<string, string> | undefined;
  let shellExecutable: string | undefined;
  let shellArgs: string[] | undefined;
  for (const layer of layers) {
    if (layer === undefined) {
      continue;
    }
    if (layer.cwd !== undefined) {
      cwd = layer.cwd;
    }
    if (layer.env !== undefined) {
      env = { ...env, ...layer.env };
    }
    if (layer.shell?.executable !== undefined) {
      shellExecutable = layer.shell.executable;
    }
    if (layer.shell?.args !== undefined) {
      shellArgs = layer.shell.args;
    }
  }
  if (
    cwd === undefined &&
    env === undefined &&
    shellExecutable === undefined &&
    shellArgs === undefined
  ) {
    return undefined;
  }
  const options: TaskOptions = {};
  if (cwd !== undefined) {
    options.cwd = cwd;
  }
  if (env !== undefined) {
    options.env = env;
  }
  if (shellExecutable !== undefined || shellArgs !== undefined) {
    const shell: TaskShellConfiguration = {};
    if (shellExecutable !== undefined) {
      shell.executable = shellExecutable;
    }
    if (shellArgs !== undefined) {
      shell.args = shellArgs;
    }
    options.shell = shell;
  }
  return options;
}

function mergeTaskPresentation(
  filePresentation: NormalizedTaskPresentation | undefined,
  taskPresentation: NormalizedTaskPresentation,
): NormalizedTaskPresentation {
  const merged: NormalizedTaskPresentation = {
    hasRevealProblems:
      (filePresentation?.hasRevealProblems ?? false) || taskPresentation.hasRevealProblems,
  };
  const echo = taskPresentation.echo ?? filePresentation?.echo;
  if (echo !== undefined) {
    merged.echo = echo;
  }
  const reveal = taskPresentation.reveal ?? filePresentation?.reveal;
  if (reveal !== undefined) {
    merged.reveal = reveal;
  }
  const focus = taskPresentation.focus ?? filePresentation?.focus;
  if (focus !== undefined) {
    merged.focus = focus;
  }
  const panel = taskPresentation.panel ?? filePresentation?.panel;
  if (panel !== undefined) {
    merged.panel = panel;
  }
  const clear = taskPresentation.clear ?? filePresentation?.clear;
  if (clear !== undefined) {
    merged.clear = clear;
  }
  const close = taskPresentation.close ?? filePresentation?.close;
  if (close !== undefined) {
    merged.close = close;
  }
  const preserveTerminalName =
    taskPresentation.preserveTerminalName ?? filePresentation?.preserveTerminalName;
  if (preserveTerminalName !== undefined) {
    merged.preserveTerminalName = preserveTerminalName;
  }
  return merged;
}
