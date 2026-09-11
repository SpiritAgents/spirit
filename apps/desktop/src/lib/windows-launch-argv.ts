import path from "node:path";

export const JUMP_LIST_SESSION_FILE_PATTERN = /^chat-\d+\.json$/;

export type WindowsLaunchAction =
  | { kind: "new-session" }
  | { kind: "open-session"; fileName: string };

export function parseJumpListSessionFileName(value: string): string | null {
  const trimmed = value.trim();
  if (!JUMP_LIST_SESSION_FILE_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function jumpListSessionFileNameFromPath(sessionPath: string): string | null {
  const normalized = sessionPath.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return parseJumpListSessionFileName(base);
}

export function buildJumpListSessionLaunchArgs(fileName: string): string {
  return `--session "${fileName}"`;
}

export function buildJumpListNewSessionLaunchArgs(): string {
  return "--new-session";
}

/** Resolve a Jump List session basename under `chatsDir`. Rejects traversal and absolute values. */
export function resolveJumpListSessionPath(chatsDir: string, fileName: string): string | null {
  const name = parseJumpListSessionFileName(fileName);
  if (!name) {
    return null;
  }
  const chatsRoot = path.resolve(chatsDir);
  const resolved = path.resolve(chatsRoot, name);
  const relative = path.relative(chatsRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative !== name) {
    return null;
  }
  return resolved;
}

export function parseWindowsLaunchArgv(argv: readonly string[]): WindowsLaunchAction | null {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === "--new-session") {
      return { kind: "new-session" };
    }
    if (entry.startsWith("--session=")) {
      return null;
    }
    if (entry !== "--session") {
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return null;
    }
    const fileName = parseJumpListSessionFileName(value);
    if (!fileName) {
      return null;
    }
    return { kind: "open-session", fileName };
  }
  return null;
}
