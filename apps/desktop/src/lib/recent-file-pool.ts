/**
 * Shared MRU pool of recently @-referenced / Files-opened files and directories,
 * consumed by both the Composer @ reference menu and the Mod+P file picker.
 *
 * Entries are stored as absolute paths with a per-entry workspace visibility list:
 * @ references are scoped to the originating workspace, Files-panel opens are visible
 * in every workspace, and an entry hit by multiple sources merges the visibility union.
 */

export const RECENT_FILE_POOL_STORAGE_KEY = "spirit-desktop-recent-file-pool";
export const RECENT_FILE_POOL_LIMIT = 30;

const STORE_VERSION = 1;

export interface RecentFilePoolEntry {
  /** Slash-normalized absolute path; directories carry no trailing slash. */
  path: string;
  isDirectory: boolean;
  /**
   * Slash-normalized workspace roots (no trailing slash) where the entry is visible.
   * An empty list means visible in every workspace.
   */
  workspaces: string[];
  openedAtUnixMs: number;
}

interface RecentFilePoolStoreFile {
  version: number;
  entries: RecentFilePoolEntry[];
}

export interface RecentFilePoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Slash-normalize, trim, and drop trailing directory markers (keeps the path body). */
export function normalizeRecentPoolPath(path: string): string {
  return path.replace(/\0/gu, "").replace(/\\/gu, "/").trim().replace(/\/+$/u, "");
}

function recentPoolEntryKey(normalizedPath: string): string {
  return normalizedPath.toLowerCase();
}

function normalizeRecentPoolScope(workspaceRoot: string): string {
  return normalizeRecentPoolPath(workspaceRoot);
}

function workspaceVisibilityUnion(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  if (existing.length === 0 || incoming.length === 0) {
    return [];
  }
  const seen = new Set(existing.map((root) => root.toLowerCase()));
  const merged = [...existing];
  for (const root of incoming) {
    const key = root.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(root);
    }
  }
  return merged;
}

function isRecentFilePoolEntry(value: unknown): value is RecentFilePoolEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<RecentFilePoolEntry>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.isDirectory === "boolean" &&
    Array.isArray(candidate.workspaces) &&
    candidate.workspaces.every((root) => typeof root === "string") &&
    typeof candidate.openedAtUnixMs === "number" &&
    Number.isFinite(candidate.openedAtUnixMs)
  );
}

export function readRecentFilePool(storage: RecentFilePoolStorage): RecentFilePoolEntry[] {
  let raw: string | null;
  try {
    raw = storage.getItem(RECENT_FILE_POOL_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const file = parsed as Partial<RecentFilePoolStoreFile>;
    if (file.version !== STORE_VERSION || !Array.isArray(file.entries)) {
      return [];
    }
    const seen = new Set<string>();
    const entries: RecentFilePoolEntry[] = [];
    for (const value of file.entries) {
      if (!isRecentFilePoolEntry(value)) {
        continue;
      }
      const path = normalizeRecentPoolPath(value.path);
      const key = recentPoolEntryKey(path);
      if (!path || seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        path,
        isDirectory: value.isDirectory,
        workspaces: value.workspaces
          .map(normalizeRecentPoolScope)
          .filter((root, index, roots) => root && roots.indexOf(root) === index),
        openedAtUnixMs: value.openedAtUnixMs,
      });
    }
    entries.sort((left, right) => right.openedAtUnixMs - left.openedAtUnixMs);
    return entries.slice(0, RECENT_FILE_POOL_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentFilePool(
  storage: RecentFilePoolStorage,
  entries: readonly RecentFilePoolEntry[],
): void {
  const file: RecentFilePoolStoreFile = { version: STORE_VERSION, entries: [...entries] };
  storage.setItem(RECENT_FILE_POOL_STORAGE_KEY, JSON.stringify(file));
}

export type RecordRecentPoolEntryInput = {
  path: string;
  isDirectory: boolean;
  /** Originating workspace root, or null when the entry is visible in every workspace. */
  workspaceRoot: string | null;
};

/** Upsert an entry: refresh its timestamp, move it to the front, merge visibility, cap the pool. */
export function recordRecentFilePoolEntry(
  entries: readonly RecentFilePoolEntry[],
  input: RecordRecentPoolEntryInput,
  nowUnixMs: number,
): RecentFilePoolEntry[] {
  const path = normalizeRecentPoolPath(input.path);
  if (!path) {
    return [...entries];
  }
  const scope = input.workspaceRoot === null ? "" : normalizeRecentPoolScope(input.workspaceRoot);
  const incomingWorkspaces = scope ? [scope] : [];
  const key = recentPoolEntryKey(path);
  const existing = entries.find((entry) => recentPoolEntryKey(entry.path) === key);
  const merged: RecentFilePoolEntry = {
    path,
    isDirectory: input.isDirectory,
    workspaces: existing
      ? workspaceVisibilityUnion(existing.workspaces, incomingWorkspaces)
      : incomingWorkspaces,
    openedAtUnixMs: nowUnixMs,
  };
  return [merged, ...entries.filter((entry) => recentPoolEntryKey(entry.path) !== key)].slice(
    0,
    RECENT_FILE_POOL_LIMIT,
  );
}

/** Drop entries by path (lazy eviction after the target turned out to be gone). */
export function removeRecentFilePoolEntries(
  entries: readonly RecentFilePoolEntry[],
  paths: readonly string[],
): RecentFilePoolEntry[] {
  if (paths.length === 0) {
    return [...entries];
  }
  const keys = new Set(
    paths
      .map((path) => recentPoolEntryKey(normalizeRecentPoolPath(path)))
      .filter((key) => key.length > 0),
  );
  return entries.filter((entry) => !keys.has(recentPoolEntryKey(entry.path)));
}

/** Entries visible in the given workspace: global entries plus entries scoped to this root. */
export function visibleRecentPoolEntries(
  entries: readonly RecentFilePoolEntry[],
  workspaceRoot: string,
): RecentFilePoolEntry[] {
  const rootKey = normalizeRecentPoolScope(workspaceRoot).toLowerCase();
  return entries.filter(
    (entry) =>
      entry.workspaces.length === 0 ||
      (rootKey !== "" && entry.workspaces.some((root) => root.toLowerCase() === rootKey)),
  );
}

/**
 * Project an entry into the menu display form: workspace-relative (with the trailing
 * directory marker) when the path lives under the given root, absolute otherwise.
 */
export function recentPoolEntryDisplayPath(
  entry: RecentFilePoolEntry,
  workspaceRoot: string,
): string {
  const suffix = entry.isDirectory ? "/" : "";
  const root = normalizeRecentPoolScope(workspaceRoot);
  if (root) {
    const rootPrefix = `${root.toLowerCase()}/`;
    if (entry.path.toLowerCase().startsWith(rootPrefix)) {
      return `${entry.path.slice(root.length + 1)}${suffix}`;
    }
  }
  return `${entry.path}${suffix}`;
}

// Renderer store wrapper: a single localStorage-backed snapshot shared across hook
// instances (Composer controller, workspace tools controller) via subscription.

let cachedEntries: RecentFilePoolEntry[] | null = null;
const listeners = new Set<() => void>();

function defaultRecentPoolStorage(): RecentFilePoolStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function getRecentFilePoolEntries(): RecentFilePoolEntry[] {
  if (cachedEntries === null) {
    const storage = defaultRecentPoolStorage();
    cachedEntries = storage ? readRecentFilePool(storage) : [];
  }
  return cachedEntries;
}

function commitRecentFilePoolEntries(entries: RecentFilePoolEntry[]): void {
  cachedEntries = entries;
  const storage = defaultRecentPoolStorage();
  if (storage) {
    try {
      writeRecentFilePool(storage, entries);
    } catch {
      // Quota / private-mode failures must not break the menus.
    }
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeRecentFilePool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordRecentPoolPath(input: RecordRecentPoolEntryInput): void {
  commitRecentFilePoolEntries(
    recordRecentFilePoolEntry(getRecentFilePoolEntries(), input, Date.now()),
  );
}

export function evictRecentPoolPaths(paths: readonly string[]): void {
  if (paths.length === 0) {
    return;
  }
  commitRecentFilePoolEntries(removeRecentFilePoolEntries(getRecentFilePoolEntries(), paths));
}
