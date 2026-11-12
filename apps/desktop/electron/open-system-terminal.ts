import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { shell } from "electron";

import { defaultShellForPty } from "@spiritagent/process/default-terminal-shell";

function assertDirectory(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (!existsSync(resolved)) {
    throw new Error("Workspace directory does not exist");
  }
  return resolved;
}

/**
 * Open a directory in the system terminal (separate window, not embedded).
 * Windows: prefer `wt -d` (common install paths or PATH), using the same shell as the
 * integrated terminal (pwsh → powershell → cmd); on failure fall back to `cmd /c start`
 * to open the same shell in a new console.
 * macOS: `Terminal.app`, with the child process working directory set to the workspace.
 * Linux: gnome-terminal, konsole, `x-terminal-emulator` (cwd); if none are available, open the folder instead.
 */
export function openSystemTerminalInDirectory(cwd: string): void {
  const dir = assertDirectory(cwd);

  if (process.platform === "win32") {
    const { file: shellFile } = defaultShellForPty();
    const wtCandidates = [
      path.join(process.env.LocalAppData || "", "Microsoft", "Windows Apps", "wt.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Windows Terminal", "wt.exe"),
    ];
    const wtFromDisk = wtCandidates.find((p) => p.length > 0 && existsSync(p));
    const comspec =
      process.env.ComSpec ||
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");

    const fallback = (): void => {
      spawn(comspec, ["/c", "start", "", "/D", dir, shellFile], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    };

    const exe = wtFromDisk ?? "wt.exe";
    const child = spawn(exe, ["-d", dir, shellFile], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", fallback);
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", "."], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  if (existsSync("/usr/bin/gnome-terminal")) {
    spawn("/usr/bin/gnome-terminal", [`--working-directory=${dir}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  if (existsSync("/usr/bin/konsole")) {
    spawn("/usr/bin/konsole", ["--workdir", dir], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  try {
    spawn("x-terminal-emulator", [], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    void shell.openPath(dir);
  }
}
