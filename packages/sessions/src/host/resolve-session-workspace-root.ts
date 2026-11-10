import { existsSync } from "node:fs";
import path from "node:path";

import {
  isSpiritBranchName,
  listGitWorktrees,
  readWorktreeContext,
  resolvePrimaryRepoRoot,
} from "@spiritagent/host-internal";

export async function resolveStoredSessionWorkspaceRoot(input: {
  workspaceRoot: string;
  gitBranch?: string;
}): Promise<string> {
  const trimmed = input.workspaceRoot.trim();
  if (!trimmed) {
    return trimmed;
  }

  const resolved = path.resolve(trimmed);
  // On a non-spirit branch, return resolved as-is regardless of readWorktreeContext;
  // checking the branch first saves two git subprocess spawns per openSession (100ms+ on Windows).
  const branch = input.gitBranch?.trim();
  if (!branch || !isSpiritBranchName(branch)) {
    return resolved;
  }

  const context = await readWorktreeContext(resolved);
  if (context.isWorktree) {
    return resolved;
  }

  try {
    const primaryRepoRoot = await resolvePrimaryRepoRoot(resolved);
    const worktrees = await listGitWorktrees(primaryRepoRoot);
    const match = worktrees.find((entry) => entry.branch === branch && entry.path);
    if (match?.path && existsSync(match.path)) {
      return path.resolve(match.path);
    }
  } catch {
    // keep the stored root when resolution fails
  }

  return resolved;
}
