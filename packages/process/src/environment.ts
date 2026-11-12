import { release as osRelease } from "node:os";
import path from "node:path";

import {
  commandParameterDescriptionForResolvedShell,
  defaultShellForPty,
  shellDisplayNameForResolvedShell,
  withShellCommandHighRiskConfirmHint,
} from "./default-terminal-shell.js";
import type {
  HostBuiltinToolDefinitionEnvironment,
  HostOperatingSystemInfo,
} from "@spiritagent/api/tools";

export type { HostBuiltinToolDefinitionEnvironment, HostOperatingSystemInfo };

export function detectShellForTools(): HostBuiltinToolDefinitionEnvironment {
  if (process.platform !== "win32") {
    const shell = process.env.SHELL ?? "/bin/sh";
    const name = path.basename(shell);
    return {
      shellDisplayName: `POSIX shell (${name})`,
      commandParameterDescription: withShellCommandHighRiskConfirmHint(
        `The command to execute in POSIX shell (${name}). Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.`,
      ),
    };
  }

  const { file } = defaultShellForPty();
  return {
    shellDisplayName: shellDisplayNameForResolvedShell(file),
    commandParameterDescription: commandParameterDescriptionForResolvedShell(file),
  };
}

export function detectOperatingSystemInfo(): HostOperatingSystemInfo {
  const name =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : process.platform === "linux"
          ? "Linux"
          : process.platform;
  return { name, version: osRelease() };
}
