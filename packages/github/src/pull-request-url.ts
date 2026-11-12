import type { GitHubRepositoryRef } from "./types.js";

export type GitHubPullRequestUrlRef = GitHubRepositoryRef & {
  number: number;
};

export function parseGitHubPullRequestUrl(rawUrl: string): GitHubPullRequestUrlRef | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 4) {
      return null;
    }

    const owner = segments[0]?.trim();
    const repo = segments[1]?.replace(/\.git$/u, "").trim();
    const pullSegment = segments[2]?.trim().toLowerCase();
    const numberRaw = segments[3]?.trim();
    if (!owner || !repo || pullSegment !== "pull" || !numberRaw) {
      return null;
    }

    const number = Number.parseInt(numberRaw, 10);
    if (!Number.isFinite(number) || number <= 0) {
      return null;
    }

    return { owner, repo, number };
  } catch {
    return null;
  }
}
