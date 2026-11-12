import { GITHUB_API_BASE_URL } from "./oauth-config.js";
import { GitHubOAuthError } from "./oauth.js";

export { GITHUB_API_BASE_URL };
export { githubFetch, setGitHubFetchImplementation } from "./github-fetch.js";

export function githubApiHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function readGitHubJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let detail = `HTTP ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message?.trim()) {
      detail = payload.message.trim();
    }
  } catch {
    /* ignore malformed error body */
  }

  throw new GitHubOAuthError(`GitHub API request failed: ${detail}`, response.status);
}

export function githubHasNextPage(response: Response): boolean {
  const link = response.headers.get("link");
  if (!link) {
    return false;
  }
  return link.split(",").some((part) => part.includes('rel="next"'));
}
