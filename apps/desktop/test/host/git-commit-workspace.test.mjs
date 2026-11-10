import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { promisify } from "node:util";

import { commitWorkspaceChanges } from "../../../../packages/sessions/dist/host/git.js";

const execFileAsync = promisify(execFile);

async function initTempRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-git-commit-"));
  const git = (...args) => execFileAsync("git", args, { cwd: repoRoot, windowsHide: true });
  await git("init");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  return { repoRoot, git };
}

test("commitWorkspaceChanges preserves multi-line commit message format", async () => {
  const { repoRoot, git } = await initTempRepo();

  try {
    await writeFile(path.join(repoRoot, "a.txt"), "hello", "utf8");
    const message = "feat(scope): one-line summary\n\n- first body item\n- second body item";
    await commitWorkspaceChanges(repoRoot, message);

    const { stdout } = await git("log", "-1", "--format=%B");
    assert.equal(stdout.replace(/\n+$/u, ""), message);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("commitWorkspaceChanges rejects empty message", async () => {
  const { repoRoot } = await initTempRepo();

  try {
    await writeFile(path.join(repoRoot, "a.txt"), "hello", "utf8");
    await assert.rejects(() => commitWorkspaceChanges(repoRoot, "  \n \n"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
