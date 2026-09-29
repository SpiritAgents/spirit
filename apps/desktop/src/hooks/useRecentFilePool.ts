import { useCallback, useMemo, useSyncExternalStore } from "react";

import { isWorkspaceReferenceDirectoryPath } from "@spiritagent/host-internal/workspace-file-reference-query";

import {
  evictRecentPoolPaths,
  getRecentFilePoolEntries,
  normalizeRecentPoolPath,
  recentPoolEntryDisplayPath,
  recordRecentPoolPath,
  subscribeRecentFilePool,
  visibleRecentPoolEntries,
  type RecentFilePoolEntry,
} from "@/lib/recent-file-pool";
import { looksLikeAbsolutePath } from "@/lib/file-picker-path";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";

const VALIDATE_INTERVAL_MS = 30_000;
let lastValidationAtUnixMs = 0;

type StatHostTextFileFn = (absolutePath: string) => Promise<{ exists: boolean; isFile: boolean }>;

export type UseRecentFilePoolOptions = {
  workspaceRoot: string;
  statHostTextFile: StatHostTextFileFn;
};

export type RecentFilePoolController = {
  /** Pool entries visible in the current workspace, MRU-first. */
  entries: RecentFilePoolEntry[];
  /** Display-form paths (files and directories) for the current workspace, MRU-first. */
  displayPaths: string[];
  /** Display-form file-only paths for the current workspace, MRU-first. */
  fileDisplayPaths: string[];
  /** Record a Composer @ reference chip (workspace-scoped visibility). */
  recordAtReference(chipPath: string): void;
  /** Record a Files-panel file open (visible in every workspace). */
  recordOpenedFile(target: EditorFileTarget): void;
  /** Lazily evict entries whose target no longer exists (throttled). */
  validateEntries(): void;
};

export function useRecentFilePool({
  workspaceRoot,
  statHostTextFile,
}: UseRecentFilePoolOptions): RecentFilePoolController {
  const entries = useSyncExternalStore(subscribeRecentFilePool, getRecentFilePoolEntries);

  const visibleEntries = useMemo(
    () => visibleRecentPoolEntries(entries, workspaceRoot),
    [entries, workspaceRoot],
  );

  const displayPaths = useMemo(
    () => visibleEntries.map((entry) => recentPoolEntryDisplayPath(entry, workspaceRoot)),
    [visibleEntries, workspaceRoot],
  );

  const fileDisplayPaths = useMemo(
    () =>
      visibleEntries
        .filter((entry) => !entry.isDirectory)
        .map((entry) => recentPoolEntryDisplayPath(entry, workspaceRoot)),
    [visibleEntries, workspaceRoot],
  );

  const recordAtReference = useCallback(
    (chipPath: string) => {
      const isDirectory = isWorkspaceReferenceDirectoryPath(chipPath);
      const normalized = normalizeRecentPoolPath(chipPath);
      if (!normalized) {
        return;
      }
      const root = normalizeRecentPoolPath(workspaceRoot);
      const absolutePath = looksLikeAbsolutePath(normalized)
        ? normalized
        : root
          ? `${root}/${normalized}`
          : "";
      if (!absolutePath) {
        return;
      }
      recordRecentPoolPath({
        path: absolutePath,
        isDirectory,
        workspaceRoot: root || null,
      });
    },
    [workspaceRoot],
  );

  const recordOpenedFile = useCallback(
    (target: EditorFileTarget) => {
      const absolutePath =
        target.scope === "workspace"
          ? (() => {
              const root = normalizeRecentPoolPath(workspaceRoot);
              const relativePath = normalizeRecentPoolPath(target.relativePath);
              return root && relativePath ? `${root}/${relativePath}` : "";
            })()
          : normalizeRecentPoolPath(target.absolutePath);
      if (!absolutePath) {
        return;
      }
      recordRecentPoolPath({ path: absolutePath, isDirectory: false, workspaceRoot: null });
    },
    [workspaceRoot],
  );

  const validateEntries = useCallback(() => {
    const now = Date.now();
    if (now - lastValidationAtUnixMs < VALIDATE_INTERVAL_MS) {
      return;
    }
    lastValidationAtUnixMs = now;

    const candidates = getRecentFilePoolEntries();
    if (candidates.length === 0) {
      return;
    }
    void Promise.all(
      candidates.map(async (entry) => {
        try {
          const result = await statHostTextFile(entry.path);
          return result.exists && result.isFile !== entry.isDirectory ? null : entry.path;
        } catch {
          return entry.path;
        }
      }),
    ).then((stalePaths) => {
      evictRecentPoolPaths(stalePaths.filter((path): path is string => path !== null));
    });
  }, [statHostTextFile]);

  return {
    entries: visibleEntries,
    displayPaths,
    fileDisplayPaths,
    recordAtReference,
    recordOpenedFile,
    validateEntries,
  };
}
