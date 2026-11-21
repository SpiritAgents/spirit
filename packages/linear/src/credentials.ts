import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import {
  LinearOAuthError,
  refreshLinearAccessToken,
  type LinearOAuthTokenResponse,
} from "./oauth.js";

export const LINEAR_CREDENTIAL_SLOT = "oauthCredentials";
export const LINEAR_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;

export interface LinearCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export class InvalidLinearCredentialsError extends Error {
  constructor() {
    super("Stored Linear authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidLinearCredentialsError";
  }
}

type LinearSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

export function linearCredentialsFromTokenResponse(
  response: LinearOAuthTokenResponse,
  now: number,
  fallbackRefreshToken?: string,
): LinearCredentials {
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
    throw new LinearOAuthError(
      "Linear did not return refreshable credentials. Authorize Linear again.",
    );
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt: now + response.expires_in * 1000,
  };
}

export function linearAccessTokenNeedsRefresh(
  credentials: Pick<LinearCredentials, "accessTokenExpiresAt">,
  now: number,
): boolean {
  return now >= credentials.accessTokenExpiresAt - LINEAR_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

export function createLinearCredentialManager(options: {
  secrets: LinearSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<LinearCredentials | undefined> {
    const raw = await options.secrets.get(LINEAR_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidLinearCredentialsError();
    if (!linearAccessTokenNeedsRefresh(stored, now())) return stored;
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidLinearCredentialsError) &&
        !(error instanceof LinearOAuthError && error.status === 401)
      ) {
        return stored;
      }
      throw error;
    }
  }

  /**
   * Runs token refresh inside the atomic Secret update so concurrent extension-host processes
   * never spend the same refresh token. A peer that already refreshed leaves a different access
   * token, which is kept. If Linear omits `refresh_token` in a refresh response, the existing
   * stored refresh token is retained.
   */
  async function refresh(expectedAccessToken: string): Promise<LinearCredentials | undefined> {
    let terminalError: LinearOAuthError | undefined;
    const raw = await options.secrets.update(LINEAR_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidLinearCredentialsError();
      if (stored.accessToken !== expectedAccessToken) return current;
      if (!linearAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshLinearAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(
          linearCredentialsFromTokenResponse(response, now(), stored.refreshToken),
        );
      } catch (error) {
        if (error instanceof LinearOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials) throw new InvalidLinearCredentialsError();
    return credentials;
  }

  return {
    read,
    async store(response: LinearOAuthTokenResponse): Promise<LinearCredentials> {
      const credentials = linearCredentialsFromTokenResponse(response, now());
      await options.secrets.set(LINEAR_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight refresh commits
     * first and the returned credentials are the ones still valid at Linear, ready for revocation.
     */
    async clear(): Promise<LinearCredentials | undefined> {
      let removed: LinearCredentials | undefined;
      await options.secrets.update(LINEAR_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): LinearCredentials | undefined {
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
    record.accessTokenExpiresAt < 0
  ) {
    return undefined;
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
  };
}
