import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { marketplaceSourceDirPath } from "./registry-store.js";
import type { MarketplaceSourceRecord } from "./types.js";

const execFileAsync = promisify(execFile);

/** Injectable for tests; defaults to the system git executable. */
export type MarketplaceGitRunner = (
  args: readonly string[],
  options: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

const defaultGitRunner: MarketplaceGitRunner = async (args, options) => {
  const result = await execFileAsync("git", [...args], {
    cwd: options.cwd,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

export function gitSourceRepoDir(spiritDataDir: string, sourceId: string): string {
  return path.join(marketplaceSourceDirPath(spiritDataDir, sourceId), "repo");
}

function describeGitError(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as { stderr?: string }).stderr;
    const detail = stderr?.trim() || error.message;
    return detail.split("\n")[0] ?? detail;
  }
  return String(error);
}

/**
 * Ensure the git source clone exists and is reset to the configured ref.
 * Refresh semantics: fetch then reset — branch refs advance with the remote,
 * tag / commit refs stay put; default is the remote default branch.
 * On refresh failure the existing clone is used with a warning; a failed
 * first clone is an error.
 */
export async function ensureGitSourceClone(
  spiritDataDir: string,
  record: MarketplaceSourceRecord,
  options?: { gitRunner?: MarketplaceGitRunner },
): Promise<{ repoDir: string; warning?: string }> {
  const git = options?.gitRunner ?? defaultGitRunner;
  const repoDir = gitSourceRepoDir(spiritDataDir, record.id);

  if (!existsSync(repoDir)) {
    try {
      await git(["clone", "--quiet", record.locator, repoDir], {});
    } catch (error) {
      await rm(repoDir, { recursive: true, force: true });
      throw new Error(
        `Failed to clone marketplace repository ${record.locator}: ${describeGitError(error)}`,
      );
    }
  } else {
    try {
      await git(["fetch", "origin", "--tags", "--prune", "--quiet"], { cwd: repoDir });
    } catch (error) {
      return {
        repoDir,
        warning: `Failed to refresh marketplace "${record.name}" (${record.locator}); using the existing clone. ${describeGitError(error)}`,
      };
    }
  }

  await resetToRef(git, repoDir, record);
  return { repoDir };
}

async function resetToRef(
  git: MarketplaceGitRunner,
  repoDir: string,
  record: MarketplaceSourceRecord,
): Promise<void> {
  const ref = record.ref?.trim();
  if (!ref) {
    // Default branch: origin/HEAD is set at clone time; refresh it so a
    // renamed upstream default branch still advances.
    await git(["remote", "set-head", "origin", "--auto"], { cwd: repoDir }).catch(() => undefined);
    await git(["reset", "--hard", "--quiet", "origin/HEAD"], { cwd: repoDir });
    return;
  }

  if (await refExists(git, repoDir, `refs/remotes/origin/${ref}`)) {
    // Branch ref: advances with the remote on every refresh.
    await git(["reset", "--hard", "--quiet", `origin/${ref}`], { cwd: repoDir });
    return;
  }
  if (await refExists(git, repoDir, `refs/tags/${ref}`)) {
    await git(["reset", "--hard", "--quiet", ref], { cwd: repoDir });
    return;
  }
  if (await refExists(git, repoDir, `${ref}^{commit}`)) {
    await git(["reset", "--hard", "--quiet", ref], { cwd: repoDir });
    return;
  }
  throw new Error(
    `Marketplace "${record.name}" ref not found in ${record.locator}: ${ref} (expected a tag, branch, or commit).`,
  );
}

async function refExists(
  git: MarketplaceGitRunner,
  repoDir: string,
  ref: string,
): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", ref], { cwd: repoDir });
    return true;
  } catch {
    return false;
  }
}
