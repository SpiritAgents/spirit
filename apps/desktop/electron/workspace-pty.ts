import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { WebContents } from "electron";

import {
  defaultShellForPty,
  shellDisplayNameForResolvedShell,
} from "@spiritagent/host-internal/default-terminal-shell";

export {
  defaultShellForPty,
  shellDisplayNameForResolvedShell,
} from "@spiritagent/host-internal/default-terminal-shell";

const require = createRequire(import.meta.url);

type PtySession = {
  webContentsId: number;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
};

function formatPtyProcessTitle(raw: string): string {
  const base = path.basename(raw.trim());
  if (!base) {
    return raw.trim();
  }
  if (process.platform === "win32" && base.toLowerCase().endsWith(".exe")) {
    return base.slice(0, -4);
  }
  return base;
}

function resolveValidatedCwd(raw: string): string {
  const resolved = path.resolve(raw.trim());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("cwd is not a valid directory");
  }
  return resolved;
}

function mergePtyEnv(extra: Record<string, string>): Record<string, string> {
  const merged = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return merged;
}

function loadPtyModule(): typeof import("node-pty") {
  return require("node-pty") as typeof import("node-pty");
}

export class WorkspacePtyManager {
  private readonly sessions = new Map<string, PtySession>();

  createSession(
    webContents: WebContents,
    request: {
      cwd: string;
      cols: number;
      rows: number;
      file?: string;
      args?: string[];
      env?: Record<string, string>;
    },
  ): { ok: true; id: string; shellDisplayName: string } | { ok: false; error: string } {
    const cwd = resolveValidatedCwd(request.cwd);
    const cols = Math.max(2, Math.min(512, Math.floor(request.cols)));
    const rows = Math.max(1, Math.min(256, Math.floor(request.rows)));
    let pty: import("node-pty").IPty;
    let shellFile = "";
    try {
      const mod = loadPtyModule();
      let file: string;
      let args: string[];
      if (request.file !== undefined) {
        file = request.file.trim();
        if (!file) {
          return { ok: false, error: "file must be a non-empty string" };
        }
        args = Array.isArray(request.args)
          ? request.args.filter((arg): arg is string => typeof arg === "string")
          : [];
      } else {
        const defaultShell = defaultShellForPty();
        file = defaultShell.file;
        args = defaultShell.args;
      }
      shellFile = file;
      const spawnOptions = {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: request.env ? mergePtyEnv(request.env) : (process.env as Record<string, string>),
      };
      const preferConpty =
        process.platform === "win32" && process.env.SPIRIT_PTY_USE_WINPTY !== "1";
      try {
        pty = mod.spawn(file, args, {
          ...spawnOptions,
          // ConPTY resize/reflow is clearly better than WinPTY on Windows; fall back to WinPTY on failure.
          useConpty: preferConpty,
        });
      } catch (firstErr) {
        if (!preferConpty) {
          throw firstErr;
        }
        pty = mod.spawn(file, args, {
          ...spawnOptions,
          useConpty: false,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    const id = randomUUID();
    const wcId = webContents.id;

    const forward = (data: string): void => {
      if (!webContents.isDestroyed()) {
        webContents.send("desktop:pty-data", { id, data });
      }
    };

    pty.onData(forward);

    let lastProcessTitle = formatPtyProcessTitle(pty.process);
    const emitProcessTitle = (): void => {
      let raw = "";
      try {
        raw = pty.process;
      } catch {
        return;
      }
      const title = formatPtyProcessTitle(raw);
      if (!title || title === lastProcessTitle) {
        return;
      }
      lastProcessTitle = title;
      if (!webContents.isDestroyed()) {
        webContents.send("desktop:pty-process-title", { id, title });
      }
    };

    emitProcessTitle();
    const processPollTimer = setInterval(emitProcessTitle, 500);

    pty.onExit(({ exitCode, signal }) => {
      clearInterval(processPollTimer);
      this.sessions.delete(id);
      if (!webContents.isDestroyed()) {
        webContents.send("desktop:pty-exit", { id, exitCode, signal });
      }
    });

    this.sessions.set(id, {
      webContentsId: wcId,
      kill: () => {
        clearInterval(processPollTimer);
        try {
          pty.kill();
        } catch {
          /* ignore */
        }
      },
      resize: (c: number, r: number) => {
        try {
          pty.resize(
            Math.max(2, Math.min(512, Math.floor(c))),
            Math.max(1, Math.min(256, Math.floor(r))),
          );
        } catch {
          /* ignore */
        }
      },
      write: (data: string) => {
        try {
          pty.write(data);
        } catch {
          /* ignore */
        }
      },
    });

    return { ok: true, id, shellDisplayName: shellDisplayNameForResolvedShell(shellFile) };
  }

  assertOwner(webContents: WebContents, id: string): PtySession | null {
    const s = this.sessions.get(id);
    if (!s || s.webContentsId !== webContents.id) {
      return null;
    }
    return s;
  }

  write(webContents: WebContents, id: string, data: string): void {
    this.assertOwner(webContents, id)?.write(data);
  }

  resize(webContents: WebContents, id: string, cols: number, rows: number): void {
    this.assertOwner(webContents, id)?.resize(cols, rows);
  }

  kill(webContents: WebContents, id: string): void {
    const s = this.assertOwner(webContents, id);
    if (s) {
      s.kill();
      this.sessions.delete(id);
    }
  }

  disposeAllForWebContents(webContentsId: number): void {
    for (const [id, s] of this.sessions) {
      if (s.webContentsId === webContentsId) {
        s.kill();
        this.sessions.delete(id);
      }
    }
  }
}
