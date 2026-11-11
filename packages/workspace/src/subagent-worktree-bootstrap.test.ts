import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { HostExecutor } from "../../agent-core/dist/smoke/cases/runtime/parity/harness.js";
import { createSubagentWorkspaceBootstrap } from "./subagent-worktree-bootstrap.js";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "worktree-"));
  directories.push(directory);
  const repo = path.join(directory, "repo");
  await mkdir(repo);
  await git(repo, "init", "-b", "main");
  await writeFile(path.join(repo, "tracked.txt"), "base\n");
  await git(repo, "add", "tracked.txt");
  await git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "initial",
  );
  const executor = new HostExecutor();
  const bootstrap = createSubagentWorkspaceBootstrap({
    parentWorkspaceRoot: repo,
    buildScopedRuntime: async () => ({ toolExecutor: executor }),
  });
  const input = {
    subagentSessionId: "child",
    task: "Inspect",
    worktree: true,
    parentWorkspaceRoot: repo,
  };
  return { repo, bootstrap, input, executor };
}

it("starts from the parent's exact HEAD without copying dirty files or switching the parent branch", async () => {
  const { repo, bootstrap, input } = await fixture();
  await writeFile(path.join(repo, "tracked.txt"), "dirty\n");
  await writeFile(path.join(repo, "untracked.txt"), "local\n");
  const before = await git(repo, "status", "--porcelain");
  const result = await bootstrap(input);
  if ("error" in result) throw new Error(result.error);
  expect(await git(result.workspaceRoot, "rev-parse", "HEAD")).toBe(
    await git(repo, "rev-parse", "HEAD"),
  );
  expect(await readFile(path.join(result.workspaceRoot, "tracked.txt"), "utf8")).toBe("base\n");
  await expect(readFile(path.join(result.workspaceRoot, "untracked.txt"))).rejects.toThrow();
  expect(await git(repo, "status", "--porcelain")).toBe(before);
  expect(await git(repo, "branch", "--show-current")).toBe("main");
  await result.rollback?.();
  expect(await git(repo, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe(
    "refs/heads/main",
  );
});

it("supports a linked worktree parent and retains a started workspace", async () => {
  const { repo, bootstrap, input } = await fixture();
  const first = await bootstrap(input);
  if ("error" in first) throw new Error(first.error);
  await git(first.workspaceRoot, "checkout", "--detach");
  const second = await bootstrap({
    ...input,
    parentWorkspaceRoot: first.workspaceRoot,
    subagentSessionId: "second",
  });
  if ("error" in second) throw new Error(second.error);
  expect(second.workspaceRoot).not.toBe(first.workspaceRoot);
  expect(await git(second.workspaceRoot, "rev-parse", "HEAD")).toBe(
    await git(repo, "rev-parse", "HEAD"),
  );
  second.markStarted?.();
  await expect(second.rollback?.()).rejects.toThrow("already in use");
  expect(await readFile(path.join(second.workspaceRoot, "tracked.txt"), "utf8")).toBe("base\n");
});

it("rolls back initialization failures but preserves a concurrently modified workspace", async () => {
  const { repo, input } = await fixture();
  const bootstrap = createSubagentWorkspaceBootstrap({
    parentWorkspaceRoot: repo,
    buildScopedRuntime: async () => {
      throw new Error("service initialization failed");
    },
  });
  await expect(bootstrap(input)).rejects.toThrow("service initialization failed");
  expect(await git(repo, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe(
    "refs/heads/main",
  );
  let modified = "";
  const retained = createSubagentWorkspaceBootstrap({
    parentWorkspaceRoot: repo,
    buildScopedRuntime: async (workspaceRoot) => {
      modified = workspaceRoot;
      await writeFile(path.join(workspaceRoot, "untracked.txt"), "keep\n");
      throw new Error("initialization failed after modification");
    },
  });
  await expect(retained(input)).rejects.toThrow("cleanup was incomplete");
  expect(await readFile(path.join(modified, "untracked.txt"), "utf8")).toBe("keep\n");
});
