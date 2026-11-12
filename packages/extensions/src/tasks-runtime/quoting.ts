import type {
  ResolvedTask,
  TaskArgValue,
  TaskCommandValue,
  TaskQuotingStyle,
} from "../tasks/public.js";

export interface TaskShellDefinition {
  executable: string;
  args: string[];
}

export interface TaskInvocation {
  file: string;
  args: string[];
}

export function buildShellCommandLine(command: TaskCommandValue, args: TaskArgValue[]): string {
  const parts: string[] = [];
  if (typeof command === "string") {
    // VS Code semantics: a plain-string command IS already the command line (raw shell
    // syntax allowed) and passes to the shell verbatim; quoting applies to args and to
    // the {value, quoting} object form — use that form to control command quoting.
    parts.push(command);
  } else if (Array.isArray(command)) {
    parts.push(...command);
  } else {
    parts.push(quoteValue(command.value, command.quoting));
  }
  for (const arg of args) {
    parts.push(typeof arg === "string" ? quoteStrong(arg) : quoteValue(arg.value, arg.quoting));
  }
  return parts.join(" ");
}

export function buildTaskInvocation(
  task: ResolvedTask,
  defaultShell: TaskShellDefinition,
): TaskInvocation {
  if (task.type === "process") {
    return buildProcessInvocation(task.command, task.args);
  }
  const executable = task.options.shell?.executable ?? defaultShell.executable;
  const shellArgs = task.options.shell?.args ?? defaultShell.args;
  return {
    file: executable,
    args: [...shellArgs, buildShellCommandLine(task.command, task.args)],
  };
}

function buildProcessInvocation(command: TaskCommandValue, args: TaskArgValue[]): TaskInvocation {
  const rawArgs = args.map((arg) => (typeof arg === "string" ? arg : arg.value));
  if (typeof command === "string") {
    return { file: command, args: rawArgs };
  }
  if (Array.isArray(command)) {
    const [file = "", ...commandArgs] = command;
    return { file, args: [...commandArgs, ...rawArgs] };
  }
  return { file: command.value, args: rawArgs };
}

function quoteValue(value: string, quoting: TaskQuotingStyle): string {
  switch (quoting) {
    case "weak":
      return quoteWeak(value);
    case "escape":
      return quoteEscape(value);
    case "strong":
      return quoteStrong(value);
  }
}

function quoteStrong(value: string): string {
  if (!needsQuoting(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quoteWeak(value: string): string {
  if (!needsQuoting(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteEscape(value: string): string {
  // An empty value has nothing to escape; emit quotes so the argument is not lost.
  if (value === "") {
    return '""';
  }
  return value.replace(/[\s"']/g, (ch) => `\\${ch}`);
}

function needsQuoting(value: string): boolean {
  return value === "" || /[\s"']/.test(value);
}
