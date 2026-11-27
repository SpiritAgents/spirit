import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import { ExaOAuthError, refreshExaAccessToken, type ExaOAuthTokenResponse } from "./oauth.js";

export const EXA_CREDENTIAL_SLOT = "oauthCredentials";
export const EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;
export const EXA_MIN_ACCESS_TOKEN_REFRESH_WINDOW_MS = 1_000;

export interface ExaCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshLeadMs?: number;
}

export class InvalidExaCredentialsError extends Error {
  constructor() {
    super("Stored Exa authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidExaCredentialsError";
  }
}

type ExaSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

/**
 * Computes a bounded refresh lead window from a token's `expires_in` seconds so short-lived
 * access tokens never trigger an immediate refresh loop while long-lived tokens refresh up to
 * ten minutes ahead of expiry.
 */
export function exaRefreshLeadMs(expiresInSeconds: number): number {
  const lifetimeMs = expiresInSeconds * 1000;
  const proportional = Math.floor(lifetimeMs / 5);
  const bounded = Math.min(EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS, proportional);
  return Math.min(
    Math.floor(lifetimeMs / 2),
    Math.max(EXA_MIN_ACCESS_TOKEN_REFRESH_WINDOW_MS, bounded),
  );
}

export function exaCredentialRefreshLeadMs(
  credentials: Pick<ExaCredentials, "refreshLeadMs">,
): number {
  return credentials.refreshLeadMs ?? EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

export function exaCredentialsFromTokenResponse(
  response: ExaOAuthTokenResponse,
  now: number,
  fallbackRefreshToken?: string,
): ExaCredentials {
  const refreshToken = response.refresh_token?.trim()
    ? response.refresh_token
    : fallbackRefreshToken;
  if (
    !response.access_token.trim() ||
    !refreshToken?.trim() ||
    typeof response.expires_in !== "number" ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new ExaOAuthError("Exa did not return refreshable credentials. Authorize Exa again.");
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt: now + response.expires_in * 1000,
    refreshLeadMs: exaRefreshLeadMs(response.expires_in),
  };
}

export function exaAccessTokenNeedsRefresh(
  credentials: Pick<ExaCredentials, "accessTokenExpiresAt" | "refreshLeadMs">,
  now: number,
): boolean {
  return now >= credentials.accessTokenExpiresAt - exaCredentialRefreshLeadMs(credentials);
}

export function createExaCredentialManager(options: {
  secrets: ExaSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<ExaCredentials | undefined> {
    const raw = await options.secrets.get(EXA_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidExaCredentialsError();
    if (!exaAccessTokenNeedsRefresh(stored, now())) return stored;
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidExaCredentialsError) &&
        !(error instanceof ExaOAuthError && error.status === 401)
      ) {
        return stored;
      }
      throw error;
    }
  }

  /**
   * Runs token refresh inside the atomic Secret update so concurrent extension-host processes
   * never spend the same refresh token. A peer that already refreshed leaves a different access
   * token, which is kept. If Exa omits `refresh_token` in a refresh response, the existing
   * stored refresh token is retained.
   */
  async function refresh(expectedAccessToken: string): Promise<ExaCredentials | undefined> {
    let terminalError: ExaOAuthError | undefined;
    const raw = await options.secrets.update(EXA_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidExaCredentialsError();
      if (stored.accessToken !== expectedAccessToken) return current;
      if (!exaAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshExaAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(
          exaCredentialsFromTokenResponse(response, now(), stored.refreshToken),
        );
      } catch (error) {
        if (error instanceof ExaOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials) throw new InvalidExaCredentialsError();
    return credentials;
  }

  return {
    read,
    async store(response: ExaOAuthTokenResponse): Promise<ExaCredentials> {
      const credentials = exaCredentialsFromTokenResponse(response, now());
      await options.secrets.set(EXA_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight refresh commits
     * first and the returned credentials are the ones still valid at Exa, ready for revocation.
     */
    async clear(): Promise<ExaCredentials | undefined> {
      let removed: ExaCredentials | undefined;
      await options.secrets.update(EXA_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): ExaCredentials | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.accessToken !== "string" ||
    !record.accessToken.trim() ||
    typeof record.refreshToken !== "string" ||
    !record.refreshToken.trim() ||
    typeof record.accessTokenExpiresAt !== "number" ||
    !Number.isFinite(record.accessTokenExpiresAt) ||
    record.accessTokenExpiresAt < 0 ||
    (record.refreshLeadMs !== undefined &&
      (typeof record.refreshLeadMs !== "number" ||
        !Number.isFinite(record.refreshLeadMs) ||
        record.refreshLeadMs < 0))
  ) {
    return undefined;
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
    ...(typeof record.refreshLeadMs === "number" ? { refreshLeadMs: record.refreshLeadMs } : {}),
  };
}
