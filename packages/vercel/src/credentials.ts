import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import {
  refreshVercelAccessToken,
  VercelOAuthError,
  type VercelOAuthTokenResponse,
} from "./oauth.js";

export const VERCEL_CREDENTIAL_SLOT = "oauthCredentials";
export const VERCEL_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;

export interface VercelCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export class InvalidVercelCredentialsError extends Error {
  constructor() {
    super("Stored Vercel authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidVercelCredentialsError";
  }
}

type VercelSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

export function vercelCredentialsFromTokenResponse(
  response: VercelOAuthTokenResponse,
  now: number,
): VercelCredentials {
  if (
    !response.access_token.trim() ||
    !response.refresh_token?.trim() ||
    typeof response.expires_in !== "number" ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new VercelOAuthError(
      "Vercel did not return refreshable credentials. Authorize Vercel again.",
    );
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    accessTokenExpiresAt: now + response.expires_in * 1000,
  };
}

export function vercelAccessTokenNeedsRefresh(
  credentials: Pick<VercelCredentials, "accessTokenExpiresAt">,
  now: number,
): boolean {
  return now >= credentials.accessTokenExpiresAt - VERCEL_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

export function createVercelCredentialManager(options: {
  secrets: VercelSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<VercelCredentials | undefined> {
    const raw = await options.secrets.get(VERCEL_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidVercelCredentialsError();
    if (!vercelAccessTokenNeedsRefresh(stored, now())) return stored;
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidVercelCredentialsError) &&
        !(error instanceof VercelOAuthError && error.status === 401)
      ) {
        return stored;
      }
      throw error;
    }
  }

  /**
   * Refresh tokens rotate on every use, so the exchange runs inside the atomic Secret update. A peer
   * process that already rotated the credential leaves a different access token, which is kept.
   */
  async function refresh(expectedAccessToken: string): Promise<VercelCredentials | undefined> {
    let terminalError: VercelOAuthError | undefined;
    const raw = await options.secrets.update(VERCEL_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidVercelCredentialsError();
      if (stored.accessToken !== expectedAccessToken) return current;
      if (!vercelAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshVercelAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(vercelCredentialsFromTokenResponse(response, now()));
      } catch (error) {
        if (error instanceof VercelOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials) throw new InvalidVercelCredentialsError();
    return credentials;
  }

  return {
    read,
    async store(response: VercelOAuthTokenResponse): Promise<VercelCredentials> {
      const credentials = vercelCredentialsFromTokenResponse(response, now());
      await options.secrets.set(VERCEL_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight rotation commits
     * first and the returned credentials are the ones still valid at Vercel, ready for revocation.
     */
    async clear(): Promise<VercelCredentials | undefined> {
      let removed: VercelCredentials | undefined;
      await options.secrets.update(VERCEL_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): VercelCredentials | undefined {
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
