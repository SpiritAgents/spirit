import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type {
  AgentRuntimeOptions,
  SubagentWorkspaceBootstrap,
  ToolExecutor,
} from "@spiritagent/agent-core";
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

export function createSubagentWorkspaceBootstrap<
  ToolRequest,
  Config = unknown,
  State = unknown,
>(options: {
  parentWorkspaceRoot: string;
  buildScopedRuntime(workspaceRoot: string): Promise<{
    toolExecutor: ToolExecutor<ToolRequest>;
    runtimeOptions?: AgentRuntimeOptions<Config, State, ToolRequest>;
    dispose?(): Promise<void>;
  }>;
}): SubagentWorkspaceBootstrap<ToolRequest, Config, State> {
  return async (input) => {
    const parentRoot = input.parentWorkspaceRoot.trim() || options.parentWorkspaceRoot;
    input.signal?.throwIfAborted();
    if (!input.worktree) {
      const scoped = await options.buildScopedRuntime(parentRoot);
      return { workspaceRoot: parentRoot, ...scoped };
    }
    const repoRoot = await resolvePrimaryRepoRoot(parentRoot);
    const head = await readHead(parentRoot);
    const suffix = randomBytes(6).toString("hex");
    const worktreePath = buildWorktreeRootPath(repoRoot, `spirit-subagent-${suffix}`);
    const branchName = `spirit/subagent-${suffix}`;
    let started = false;
    let created = false;
    let dispose: (() => Promise<void>) | undefined;
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
      const scoped = await options.buildScopedRuntime(worktreePath);
      dispose = scoped.dispose;
      input.signal?.throwIfAborted();
      return {
        workspaceRoot: worktreePath,
        worktreePath,
        branchName,
        ...scoped,
        markStarted: () => {
          started = true;
        },
        rollback,
      };
    } catch (error) {
      const cleanup = await Promise.allSettled([dispose?.(), rollback()]);
      const failures = cleanup.flatMap((entry) =>
        entry.status === "rejected" ? [entry.reason] : [],
      );
      if (failures.length) {
        throw new AggregateError(
          [error, ...failures],
          `Subagent initialization failed; cleanup was incomplete. Inspect ${worktreePath} and ${branchName}.`,
        );
      }
      throw error;
    }
  };
}
