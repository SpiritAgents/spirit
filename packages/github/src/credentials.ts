import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import { GITHUB_OAUTH_ACCESS_TOKEN_URL } from "./oauth-config.js";
import { githubFetchDetached } from "./github-fetch.js";
import { GitHubOAuthError } from "./oauth.js";
import { isGitHubFetchAbortError, isRetriableGitHubHttpStatus } from "./oauth-fetch-retry.js";
import type { GitHubOAuthTokenResponse } from "./types.js";

export const GITHUB_CREDENTIAL_SLOT = "oauthCredentials";
export const GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;
const GITHUB_REFRESH_REQUEST_TIMEOUT_MS = 30_000;

export interface GitHubCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  login: string;
}

export class InvalidGitHubCredentialsError extends Error {
  constructor() {
    super("Stored GitHub authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidGitHubCredentialsError";
  }
}

type StoredGitHubCredentials =
  | { kind: "valid"; value: GitHubCredentials }
  | { kind: "legacy" }
  | { kind: "invalid" };

type GitHubSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

export function gitHubCredentialsFromTokenResponse(
  response: GitHubOAuthTokenResponse,
  login: string,
  now: number,
): GitHubCredentials {
  if (
    !response.access_token.trim() ||
    !response.refresh_token?.trim() ||
    !isPositiveFiniteNumber(response.expires_in) ||
    !isPositiveFiniteNumber(response.refresh_token_expires_in) ||
    !login.trim()
  ) {
    throw new GitHubOAuthError(
      "GitHub did not return complete refreshable credentials. Authorize GitHub again.",
    );
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    accessTokenExpiresAt: now + response.expires_in * 1000,
    refreshTokenExpiresAt: now + response.refresh_token_expires_in * 1000,
    login,
  };
}

export function createGitHubCredentialManager(options: {
  secrets: GitHubSecrets;
  clientId: string;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function readStored(): Promise<StoredGitHubCredentials | undefined> {
    const raw = await options.secrets.get(GITHUB_CREDENTIAL_SLOT);
    return raw === undefined ? undefined : parseStoredCredentials(raw);
  }

  async function read(
    options: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<GitHubCredentials | undefined> {
    const stored = await readStored();
    if (!stored) return undefined;
    if (stored.kind === "invalid") throw new InvalidGitHubCredentialsError();
    if (stored.kind === "legacy") return refresh({ force: false });
    if (!gitHubAccessTokenNeedsRefresh(stored.value, now())) return stored.value;
    try {
      return await refresh({ expectedAccessToken: stored.value.accessToken, force: false });
    } catch (error) {
      if (
        options.allowValidTokenOnRefreshFailure !== false &&
        stored.value.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidGitHubCredentialsError) &&
        !(error instanceof GitHubOAuthError && error.status === 401)
      ) {
        return stored.value;
      }
      throw error;
    }
  }

  async function refresh(input: {
    expectedAccessToken?: string;
    force: boolean;
  }): Promise<GitHubCredentials | undefined> {
    let terminalError: GitHubOAuthError | undefined;
    const raw = await options.secrets.update(GITHUB_CREDENTIAL_SLOT, async (stored) => {
      if (stored === undefined) return undefined;
      const parsed = parseStoredCredentials(stored);
      if (parsed.kind === "invalid") throw new InvalidGitHubCredentialsError();
      if (parsed.kind === "legacy") return undefined;
      const current = parsed.value;
      if (
        input.expectedAccessToken !== undefined &&
        current.accessToken !== input.expectedAccessToken
      ) {
        return stored;
      }
      if (!input.force && !gitHubAccessTokenNeedsRefresh(current, now())) return stored;
      if (current.refreshTokenExpiresAt <= now()) {
        terminalError = new GitHubOAuthError(
          "GitHub authorization expired. Authorize GitHub again.",
          401,
        );
        return undefined;
      }
      try {
        const response = await refreshGitHubAccessToken({
          clientId: options.clientId,
          refreshToken: current.refreshToken,
        });
        return JSON.stringify(gitHubCredentialsFromTokenResponse(response, current.login, now()));
      } catch (error) {
        if (error instanceof GitHubOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const parsed = parseStoredCredentials(raw);
    if (parsed.kind === "invalid") throw new InvalidGitHubCredentialsError();
    return parsed.kind === "valid" ? parsed.value : undefined;
  }

  return {
    read,
    async token(): Promise<string | undefined> {
      return (await read())?.accessToken;
    },
    async status() {
      try {
        const credentials = await read();
        return credentials
          ? { connected: true as const, login: credentials.login }
          : { connected: false as const };
      } catch (error) {
        if (error instanceof GitHubOAuthError && error.status === 401) {
          return { connected: false as const };
        }
        throw error;
      }
    },
    refreshAfterRejected(rejectedAccessToken: string): Promise<string | undefined> {
      return refresh({ expectedAccessToken: rejectedAccessToken, force: true }).then(
        (credentials) => credentials?.accessToken,
      );
    },
    async store(response: GitHubOAuthTokenResponse, login: string): Promise<GitHubCredentials> {
      const credentials = gitHubCredentialsFromTokenResponse(response, login, now());
      await options.secrets.set(GITHUB_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    clear(): Promise<void> {
      return options.secrets.delete(GITHUB_CREDENTIAL_SLOT);
    },
  };
}

export function gitHubAccessTokenNeedsRefresh(
  credentials: Pick<GitHubCredentials, "accessTokenExpiresAt">,
  now: number,
): boolean {
  return now >= credentials.accessTokenExpiresAt - GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

async function refreshGitHubAccessToken(input: {
  clientId: string;
  refreshToken: string;
}): Promise<GitHubOAuthTokenResponse> {
  let response: Response;
  try {
    response = await githubFetchDetached(GITHUB_OAUTH_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: input.clientId,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }),
      signal: AbortSignal.timeout(GITHUB_REFRESH_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof GitHubOAuthError || isGitHubFetchAbortError(error)) throw error;
    throw new GitHubOAuthError("GitHub token refresh could not reach GitHub. Try again.");
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (GitHubOAuthTokenResponse & { error?: string })
    | undefined;
  const error = payload?.error?.trim();
  if (error === "invalid_grant" || error === "expired_token" || error === "bad_refresh_token") {
    throw new GitHubOAuthError("GitHub authorization expired. Authorize GitHub again.", 401);
  }
  if (isRetriableGitHubHttpStatus(response.status)) {
    throw new GitHubOAuthError("GitHub token refresh is temporarily unavailable.", response.status);
  }
  if (!response.ok || error || !payload?.access_token) {
    throw new GitHubOAuthError(
      `GitHub token refresh failed: HTTP ${response.status}`,
      response.status,
    );
  }
  return payload;
}

function parseStoredCredentials(raw: string): StoredGitHubCredentials {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (!value || typeof value !== "object") return { kind: "invalid" };
  const record = value as Record<string, unknown>;
  if (
    typeof record.accessToken !== "string" ||
    !record.accessToken.trim() ||
    typeof record.login !== "string" ||
    !record.login.trim()
  ) {
    return { kind: "invalid" };
  }
  const hasRefreshMetadata =
    "refreshToken" in record ||
    "accessTokenExpiresAt" in record ||
    "refreshTokenExpiresAt" in record;
  if (!hasRefreshMetadata) return { kind: "legacy" };
  if (
    typeof record.refreshToken !== "string" ||
    !record.refreshToken.trim() ||
    !isNonNegativeFiniteNumber(record.accessTokenExpiresAt) ||
    !isNonNegativeFiniteNumber(record.refreshTokenExpiresAt)
  ) {
    return { kind: "invalid" };
  }
  return {
    kind: "valid",
    value: {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      accessTokenExpiresAt: record.accessTokenExpiresAt,
      refreshTokenExpiresAt: record.refreshTokenExpiresAt,
      login: record.login,
    },
  };
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
