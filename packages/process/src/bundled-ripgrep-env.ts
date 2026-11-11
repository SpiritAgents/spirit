import { existsSync } from "node:fs";
import path from "node:path";

import { rgPath } from "@vscode/ripgrep";

export const SPIRIT_RG_PATH_ENV = "SPIRIT_RG_PATH";
export const SPIRIT_RG_BIN_DIR_ENV = "SPIRIT_RG_BIN_DIR";
export const SPIRIT_SHELL_USE_BUNDLED_RG_ENV = "SPIRIT_SHELL_USE_BUNDLED_RG";

function isBundledRipgrepInjectionDisabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[SPIRIT_SHELL_USE_BUNDLED_RG_ENV]?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "no" || raw === "off";
}

function resolvePathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32") {
    return "PATH";
  }
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function pathEntries(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const separator = process.platform === "win32" ? ";" : ":";
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function pathsEqual(left: string, right: string): boolean {
  try {
    return path.resolve(left) === path.resolve(right);
  } catch {
    return left === right;
  }
}

export function resolveBundledRipgrepPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env[SPIRIT_RG_PATH_ENV]?.trim();
  if (override && existsSync(override)) {
    return override;
  }

  try {
    if (existsSync(rgPath)) {
      return rgPath;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildAgentShellEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  if (isBundledRipgrepInjectionDisabled(env)) {
    return env;
  }

  const rgExecutable = resolveBundledRipgrepPath(env);
  if (!rgExecutable) {
    return env;
  }

  const binDir = path.dirname(rgExecutable);
  env[SPIRIT_RG_PATH_ENV] = rgExecutable;
  env[SPIRIT_RG_BIN_DIR_ENV] = binDir;

  const pathKey = resolvePathEnvKey(env);
  const existingEntries = pathEntries(env[pathKey]);
  if (existingEntries.length > 0 && pathsEqual(existingEntries[0]!, binDir)) {
    return env;
  }

  const separator = process.platform === "win32" ? ";" : ":";
  const existingPath = env[pathKey] ?? "";
  env[pathKey] = existingPath.length > 0 ? `${binDir}${separator}${existingPath}` : binDir;

  return env;
}
