import type { TaskArgValue, TaskCommandValue, TaskOptions } from "./schema.js";

export interface TaskVariableContext {
  workspaceFolder?: string;
  cwd: string;
  userHome: string;
  env: Record<string, string | undefined>;
  pathSeparator: string;
}

const VARIABLE_PATTERN = /\$\{([^}]*)\}/g;

export function isSupportedTaskVariable(name: string): boolean {
  return (
    name === "workspaceFolder" ||
    name === "workspaceFolderBasename" ||
    name === "cwd" ||
    name === "userHome" ||
    name === "pathSeparator" ||
    name === "/" ||
    name.startsWith("env:")
  );
}

export function findUnsupportedTaskVariable(values: Iterable<string>): string | undefined {
  for (const value of values) {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      const name = match[1] ?? "";
      if (!isSupportedTaskVariable(name)) {
        return name;
      }
    }
  }
  return undefined;
}

export function usesWorkspaceFolderVariable(values: Iterable<string>): boolean {
  for (const value of values) {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      if (match[1] === "workspaceFolder" || match[1] === "workspaceFolderBasename") {
        return true;
      }
    }
  }
  return false;
}

export function substituteTaskVariables(value: string, context: TaskVariableContext): string {
  return value.replace(VARIABLE_PATTERN, (token, name: string) => {
    switch (name) {
      case "workspaceFolder":
        return context.workspaceFolder ?? token;
      case "workspaceFolderBasename": {
        const folder = context.workspaceFolder;
        return folder === undefined ? token : workspaceFolderBasename(folder);
      }
      case "cwd":
        return context.cwd;
      case "userHome":
        return context.userHome;
      case "pathSeparator":
      case "/":
        return context.pathSeparator;
      default:
        if (name.startsWith("env:")) {
          return context.env[name.slice("env:".length)] ?? "";
        }
        return token;
    }
  });
}

export function collectTaskVariableStrings(
  command: TaskCommandValue | undefined,
  args: TaskArgValue[] | undefined,
  options: TaskOptions | undefined,
): string[] {
  const values: string[] = [];
  if (typeof command === "string") {
    values.push(command);
  } else if (Array.isArray(command)) {
    values.push(...command);
  } else if (command !== undefined) {
    values.push(command.value);
  }
  for (const arg of args ?? []) {
    values.push(typeof arg === "string" ? arg : arg.value);
  }
  if (options?.cwd !== undefined) {
    values.push(options.cwd);
  }
  for (const envValue of Object.values(options?.env ?? {})) {
    values.push(envValue);
  }
  if (options?.shell?.executable !== undefined) {
    values.push(options.shell.executable);
  }
  for (const shellArg of options?.shell?.args ?? []) {
    values.push(shellArg);
  }
  return values;
}

function workspaceFolderBasename(folder: string): string {
  const segments = folder.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? folder;
}
