import { normalizeWorkspaceEntryRel } from "./workspace-entry-path-sync.js";
import type {
  DesktopGitSnapshot,
  WorkspaceContentInvalidation,
  WorkspaceContentInvalidationReason,
} from "../types.js";

export function toWorkspaceRelativePosixPath(
  workspaceRoot: string,
  resolvedPath: string,
): string | null {
  const root = workspaceRoot.replace(/[/\\]+$/, "").replace(/\\/g, "/");
  const resolved = resolvedPath.replace(/\\/g, "/");
  if (!root || !resolved) {
    return null;
  }
  if (resolved === root) {
    return "";
  }
  const prefix = `${root}/`;
  if (!resolved.startsWith(prefix)) {
    return null;
  }
  return resolved.slice(prefix.length);
}

export function gitWorkingTreeFingerprint(
  git: Pick<
    DesktopGitSnapshot,
    "hasChanges" | "workingTreeLineDelta" | "branch" | "aheadCount" | "behindCount"
  >,
): string {
  return JSON.stringify({
    hasChanges: git.hasChanges,
    workingTreeLineDelta: git.workingTreeLineDelta ?? null,
    branch: git.branch ?? "",
    aheadCount: git.aheadCount,
    behindCount: git.behindCount,
  });
}

export function workspaceContentInvalidationTouchesPath(
  invalidation: Pick<WorkspaceContentInvalidation, "paths" | "reason">,
  relativePath: string,
): boolean {
  if (invalidation.paths.length === 0) {
    return invalidation.reason === "git-working-tree";
  }
  const rel = normalizeWorkspaceEntryRel(relativePath);
  return invalidation.paths.some((entry) => normalizeWorkspaceEntryRel(entry) === rel);
}

export function nextWorkspaceContentInvalidation(
  current: WorkspaceContentInvalidation | undefined,
  paths: readonly string[],
  reason: WorkspaceContentInvalidationReason,
): WorkspaceContentInvalidation {
  return {
    revision: (current?.revision ?? 0) + 1,
    paths: [...paths],
    reason,
  };
}
