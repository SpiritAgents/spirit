import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { SubagentWorkspaceBootstrap, ToolExecutor } from "@spiritagent/agent-core";
import {
  addGitWorktree,
  buildWorktreeRootPath,
  removeGitWorktree,
  resolvePrimaryRepoRoot,
} from "./git-workspace.js";

const execFileAsync = promisify(execFile);

async function readHead(workspaceRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: workspaceRoot,
    windowsHide: true,
  });
  return stdout.trim();
}

export function createSubagentWorkspaceBootstrap<ToolRequest>(options: {
  parentWorkspaceRoot: string;
  buildScopedToolExecutor(workspaceRoot: string): Promise<ToolExecutor<ToolRequest>>;
}): SubagentWorkspaceBootstrap<ToolRequest> {
  return async (input) => {
    const parentRoot = input.parentWorkspaceRoot.trim() || options.parentWorkspaceRoot;
    input.signal?.throwIfAborted();
    if (!input.worktree) return { workspaceRoot: parentRoot };
    const repoRoot = await resolvePrimaryRepoRoot(parentRoot);
    const head = await readHead(parentRoot);
    const suffix = randomBytes(6).toString("hex");
    const worktreePath = buildWorktreeRootPath(repoRoot, `spirit-subagent-${suffix}`);
    const branchName = `spirit/subagent-${suffix}`;
    let started = false;
    let created = false;
    const rollback = async (): Promise<void> => {
      if (started) throw new Error(`Subagent worktree is already in use: ${worktreePath}`);
      if (!created) return;
      if ((await readHead(worktreePath)) !== head) {
        throw new Error(`Subagent worktree has new commits and was retained: ${worktreePath}`);
      }
      await removeGitWorktree(repoRoot, worktreePath);
      created = false;
      await execFileAsync("git", ["update-ref", "-d", `refs/heads/${branchName}`, head], {
        cwd: repoRoot,
        windowsHide: true,
      });
    };
    try {
      input.signal?.throwIfAborted();
      await addGitWorktree(repoRoot, { worktreePath, branchName, baseBranch: head });
      created = true;
      input.signal?.throwIfAborted();
      const toolExecutor = await options.buildScopedToolExecutor(worktreePath);
      input.signal?.throwIfAborted();
      return {
        workspaceRoot: worktreePath,
        worktreePath,
        branchName,
        toolExecutor,
        markStarted: () => {
          started = true;
        },
        rollback,
      };
    } catch (error) {
      try {
        await rollback();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Subagent initialization failed; cleanup was incomplete. Inspect ${worktreePath} and ${branchName}.`,
        );
      }
      throw error;
    }
  };
}
