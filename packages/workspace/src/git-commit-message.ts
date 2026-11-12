import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const FIELD_SEP = "\x1f";

export interface GitCommitMessageSnapshot {
  isRepository: boolean;
  oid: string;
  subject: string;
  author: string;
  authoredAt: string;
  /** Raw commit message from git `%B` (subject line + optional body). */
  fullMessage: string;
}

function renderGitError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }
  const stdout =
    typeof (error as { stdout?: unknown }).stdout === "string"
      ? (error as { stdout: string }).stdout.trim()
      : "";
  const stderr =
    typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
  const message = error instanceof Error ? error.message.trim() : String(error);
  return stderr || stdout || message;
}

async function runGit(
  workspaceRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const message = renderGitError(error);
    throw new Error(`git ${args.join(" ")} failed: ${message}`, { cause: error });
  }
}

export function subjectFromGitFullMessage(fullMessage: string): string {
  const firstLine = fullMessage.split(/\r?\n/u)[0] ?? "";
  return firstLine.trim();
}

export function parseGitCommitMessageOutput(
  raw: string,
): Omit<GitCommitMessageSnapshot, "isRepository"> | undefined {
  const trimmedEnd = raw.replace(/\r?\n$/u, "");
  if (!trimmedEnd.trim()) {
    return undefined;
  }
  const fields = trimmedEnd.split(FIELD_SEP);
  if (fields.length < 4) {
    return undefined;
  }
  const oid = fields[0]?.trim() ?? "";
  const author = fields[1]?.trim() ?? "";
  const authoredAt = fields[2]?.trim() ?? "";
  const fullMessage = fields.slice(3).join(FIELD_SEP);
  if (!oid) {
    return undefined;
  }
  return {
    oid,
    author,
    authoredAt,
    fullMessage,
    subject: subjectFromGitFullMessage(fullMessage),
  };
}

const EMPTY_SNAPSHOT: GitCommitMessageSnapshot = {
  isRepository: false,
  oid: "",
  subject: "",
  author: "",
  authoredAt: "",
  fullMessage: "",
};

export async function readGitCommitMessage(
  repoRoot: string,
  oid: string,
): Promise<GitCommitMessageSnapshot> {
  const trimmedOid = oid.trim();
  if (!trimmedOid) {
    return EMPTY_SNAPSHOT;
  }
  try {
    const { stdout: repoFlag } = await runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (repoFlag.trim() !== "true") {
      return EMPTY_SNAPSHOT;
    }

    const { stdout } = await runGit(repoRoot, [
      "log",
      "-1",
      `--format=format:%H${FIELD_SEP}%an${FIELD_SEP}%ai${FIELD_SEP}%B`,
      trimmedOid,
    ]);

    const parsed = parseGitCommitMessageOutput(stdout);
    if (!parsed) {
      return EMPTY_SNAPSHOT;
    }
    return { isRepository: true, ...parsed };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}
