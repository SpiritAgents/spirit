import { existsSync } from "node:fs";
import path from "node:path";

/** Appended to every shell `command` parameter description. */
export const SHELL_COMMAND_HIGH_RISK_CONFIRM_HINT =
  "Confirm with the user before running high-risk commands.";

export function withShellCommandHighRiskConfirmHint(description: string): string {
  return `${description.trim()} ${SHELL_COMMAND_HIGH_RISK_CONFIRM_HINT}`;
}

function firstExistingFile(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed && existsSync(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Host default shell (shared by the integrated terminal, system terminal, and shell tool).
 * Windows: prefer pwsh (PowerShell 7+), then Windows PowerShell, finally cmd.
 * The SPIRIT_TERMINAL_SHELL environment variable can specify a full executable path.
 */
export function defaultShellForPty(): { file: string; args: string[] } {
  const override = process.env.SPIRIT_TERMINAL_SHELL?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`SPIRIT_TERMINAL_SHELL does not exist: ${override}`);
    }
    return { file: override, args: [] };
  }

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const pwsh =
      firstExistingFile([
        process.env.PWSH_PATH || "",
        path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
        path.join(programFiles, "PowerShell", "7-preview", "pwsh.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "pwsh.exe"),
      ]) ||
      firstExistingFile([
        path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ]);
    if (pwsh) {
      return { file: pwsh, args: [] };
    }
    const comspec = process.env.ComSpec || path.join(systemRoot, "System32", "cmd.exe");
    return { file: comspec, args: [] };
  }

  const shellPath = process.env.SHELL || "/bin/bash";
  return { file: shellPath, args: [] };
}

export function shellDisplayNameForResolvedShell(file: string): string {
  const base = path.basename(file).toLowerCase();
  if (base === "pwsh.exe") {
    return "PowerShell 7 (pwsh)";
  }
  if (base === "powershell.exe") {
    return "Windows PowerShell";
  }
  if (base === "cmd.exe") {
    return "Command Prompt (cmd.exe)";
  }
  return path.basename(file);
}

export function isWindowsPowerShellExecutable(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return base === "pwsh.exe" || base === "powershell.exe";
}

export function isWindowsCmdExecutable(file: string): boolean {
  return path.basename(file).toLowerCase() === "cmd.exe";
}

/** Run-command prefix args for a shell executable: the command line itself is appended as one trailing arg. */
export function shellRunCommandArgs(shellFile: string): string[] {
  if (isWindowsPowerShellExecutable(shellFile)) {
    return ["-NoProfile", "-NonInteractive", "-Command"];
  }
  if (isWindowsCmdExecutable(shellFile)) {
    return ["/d", "/s", "/c"];
  }
  return ["-c"];
}

/**
 * Non-interactive subprocesses (shell tool) do not go through ConPTY on Windows by default, so UTF-8 output must be aligned explicitly.
 * PowerShell: set OutputEncoding; cmd: keep the chcp 65001 prefix (output decoding: see {@link decodeShellHostOutput}).
 */
export function prepareShellForHostExecution(shellFile: string, command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  if (isWindowsPowerShellExecutable(shellFile)) {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  }
  if (isWindowsCmdExecutable(shellFile)) {
    return `chcp 65001 >nul & ${command}`;
  }
  return command;
}

/** cmd.exe subprocesses often output GBK on Chinese Windows; PowerShell is decoded as utf8 after the UTF-8 prefix. */
export function decodeShellHostOutput(shellFile: string, chunk: Buffer): string {
  if (chunk.length === 0) {
    return "";
  }
  if (process.platform === "win32" && isWindowsCmdExecutable(shellFile)) {
    return new TextDecoder("gbk").decode(chunk);
  }
  return chunk.toString("utf8");
}

export function shellHostExecUsesBufferOutput(shellFile: string): boolean {
  return process.platform === "win32" && isWindowsCmdExecutable(shellFile);
}

export function commandParameterDescriptionForResolvedShell(file: string): string {
  const base = path.basename(file).toLowerCase();
  if (base === "pwsh.exe" || base === "powershell.exe") {
    return withShellCommandHighRiskConfirmHint(
      "The command to execute in Windows PowerShell. Prefer PowerShell syntax such as Get-ChildItem, Select-String, Get-Content, Set-Location, and Test-Path.",
    );
  }
  if (base === "cmd.exe") {
    return withShellCommandHighRiskConfirmHint(
      "The command to execute in Command Prompt (cmd.exe). Prefer cmd.exe syntax such as dir, type, where, findstr, and cd.",
    );
  }
  const name = path.basename(file);
  return withShellCommandHighRiskConfirmHint(
    `The command to execute in ${name}. Prefer syntax native to that shell.`,
  );
}
