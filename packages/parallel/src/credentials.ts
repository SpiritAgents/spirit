import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import {
  ParallelOAuthError,
  refreshParallelAccessToken,
  type ParallelOAuthTokenResponse,
} from "./oauth.js";

export const PARALLEL_CREDENTIAL_SLOT = "oauthCredentials";
export const PARALLEL_MAX_REFRESH_LEAD_MS = 2 * 60 * 1000;
export const PARALLEL_REFRESH_LEAD_RATIO = 0.2;

export interface ParallelCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  accessTokenRefreshAt: number;
}

export interface StoredParallelCredentials {
  accessToken?: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  accessTokenRefreshAt: number;
}

export class InvalidParallelCredentialsError extends Error {
  constructor() {
    super("Stored Parallel authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidParallelCredentialsError";
  }
}

type ParallelSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

/**
 * Parallel access tokens expire after 10 minutes (600s) and rotate refresh tokens on use, so a
 * fixed 10-minute lead window would trigger an immediate refresh loop. Scale the lead window with
 * the issued TTL and cap it at 2 minutes (refreshing a 600s token at minute 8).
 */
export function parallelRefreshLeadMs(ttlMs: number): number {
  return Math.min(PARALLEL_MAX_REFRESH_LEAD_MS, Math.floor(ttlMs * PARALLEL_REFRESH_LEAD_RATIO));
}

export function parallelCredentialsFromTokenResponse(
  response: ParallelOAuthTokenResponse,
  now: number,
  fallbackRefreshToken?: string,
): ParallelCredentials {
  const refreshToken = response.refresh_token?.trim()
    ? response.refresh_token
    : fallbackRefreshToken?.trim()
      ? fallbackRefreshToken
      : undefined;
  if (
    !response.access_token.trim() ||
    !refreshToken ||
    typeof response.expires_in !== "number" ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new ParallelOAuthError(
      "Parallel did not return refreshable credentials. Authorize Parallel again.",
    );
  }
  const ttlMs = response.expires_in * 1000;
  const leadMs = parallelRefreshLeadMs(ttlMs);
  return {
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt: now + ttlMs,
    accessTokenRefreshAt: now + Math.max(0, ttlMs - leadMs),
  };
}

export function parallelAccessTokenNeedsRefresh(
  credentials: Pick<StoredParallelCredentials, "accessToken" | "accessTokenRefreshAt">,
  now: number,
): boolean {
  return !credentials.accessToken || now >= credentials.accessTokenRefreshAt;
}

export function createParallelCredentialManager(options: {
  secrets: ParallelSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<ParallelCredentials | undefined> {
    const raw = await options.secrets.get(PARALLEL_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidParallelCredentialsError();
    if (!parallelAccessTokenNeedsRefresh(stored, now())) {
      return stored as ParallelCredentials;
    }
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessToken !== undefined &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidParallelCredentialsError) &&
        !(error instanceof ParallelOAuthError && error.status === 401)
      ) {
        return stored as ParallelCredentials;
      }
      throw error;
    }
  }

  /**
   * Runs token refresh inside the atomic Secret update so concurrent extension-host processes
   * never spend the same rotating refresh token. A peer that already refreshed leaves a different
   * access token, which is kept. If Parallel omits `refresh_token` in a refresh response, the
   * existing stored refresh token is retained. When refresh fails after the access token has
   * already expired, the expired `accessToken` is stripped while retaining `refreshToken` so the
   * optional MCP Bearer header omits itself and falls back to keyless access until refresh
   * recovers.
   */
  async function refresh(
    expectedAccessToken: string | undefined,
  ): Promise<ParallelCredentials | undefined> {
    let refreshError: unknown;
    let hasRefreshError = false;
    const raw = await options.secrets.update(PARALLEL_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidParallelCredentialsError();
      if (stored.accessToken !== undefined && stored.accessToken !== expectedAccessToken) {
        return current;
      }
      if (!parallelAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshParallelAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(
          parallelCredentialsFromTokenResponse(response, now(), stored.refreshToken),
        );
      } catch (error) {
        if (error instanceof ParallelOAuthError && error.status === 401) {
          refreshError = error;
          hasRefreshError = true;
          return undefined;
        }
        if (stored.accessToken !== undefined && stored.accessTokenExpiresAt <= now()) {
          refreshError = error;
          hasRefreshError = true;
          return JSON.stringify({
            refreshToken: stored.refreshToken,
            accessTokenExpiresAt: stored.accessTokenExpiresAt,
            accessTokenRefreshAt: stored.accessTokenRefreshAt,
          } satisfies StoredParallelCredentials);
        }
        throw error;
      }
    });
    if (hasRefreshError) throw refreshError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials?.accessToken) throw new InvalidParallelCredentialsError();
    return credentials as ParallelCredentials;
  }

  return {
    read,
    async readAccessTokenExpiresAt(): Promise<number | undefined> {
      const raw = await options.secrets.get(PARALLEL_CREDENTIAL_SLOT);
      if (raw === undefined) return undefined;
      const stored = parseStoredCredentials(raw);
      return stored?.accessToken ? stored.accessTokenExpiresAt : undefined;
    },
    async store(response: ParallelOAuthTokenResponse): Promise<ParallelCredentials> {
      const credentials = parallelCredentialsFromTokenResponse(response, now());
      await options.secrets.set(PARALLEL_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight rotation commits
     * first and the returned credentials are the ones still valid at Parallel, ready for revocation.
     */
    async clear(): Promise<StoredParallelCredentials | undefined> {
      let removed: StoredParallelCredentials | undefined;
      await options.secrets.update(PARALLEL_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): StoredParallelCredentials | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const hasAccessToken = record.accessToken !== undefined;
  if (
    (hasAccessToken && (typeof record.accessToken !== "string" || !record.accessToken.trim())) ||
    typeof record.refreshToken !== "string" ||
    !record.refreshToken.trim() ||
    typeof record.accessTokenExpiresAt !== "number" ||
    !Number.isFinite(record.accessTokenExpiresAt) ||
    record.accessTokenExpiresAt < 0 ||
    typeof record.accessTokenRefreshAt !== "number" ||
    !Number.isFinite(record.accessTokenRefreshAt) ||
    record.accessTokenRefreshAt < 0 ||
    record.accessTokenRefreshAt > record.accessTokenExpiresAt
  ) {
    return undefined;
  }
  return {
    ...(hasAccessToken ? { accessToken: record.accessToken as string } : {}),
    refreshToken: record.refreshToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
    accessTokenRefreshAt: record.accessTokenRefreshAt,
  };
}
