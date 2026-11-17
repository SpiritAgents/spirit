import { GitHubOAuthError } from "./oauth.js";

export async function explainGitHubApiError(
  error: unknown,
  clearAuthorization: () => Promise<void>,
): Promise<Error> {
  if (!(error instanceof GitHubOAuthError))
    return error instanceof Error ? error : new Error(String(error));
  if (error.status === 401) {
    await clearAuthorization();
    return new Error("GitHub authentication expired or is invalid. Authorize GitHub again.");
  }
  if (error.status === 403)
    return new Error(
      "GitHub denied access. If this repository belongs to an organization with SSO, authorize the token for that organization on GitHub.",
    );
  return error;
}
