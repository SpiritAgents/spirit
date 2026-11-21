import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import {
  CloudflareOAuthError,
  refreshCloudflareAccessToken,
  type CloudflareOAuthTokenResponse,
} from "./oauth.js";

export const CLOUDFLARE_CREDENTIAL_SLOT = "oauthCredentials";
export const CLOUDFLARE_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;

export interface CloudflareCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  accessTokenRefreshAt: number;
}

export class InvalidCloudflareCredentialsError extends Error {
  constructor() {
    super("Stored Cloudflare authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidCloudflareCredentialsError";
  }
}

type CloudflareSecrets = Pick<
  SpiritExtensionContext["secrets"],
  "get" | "set" | "update" | "delete"
>;

export function cloudflareCredentialsFromTokenResponse(
  response: CloudflareOAuthTokenResponse,
  now: number,
  fallbackRefreshToken?: string,
): CloudflareCredentials {
  const refreshToken = response.refresh_token?.trim() || fallbackRefreshToken?.trim();
  if (
    !response.access_token.trim() ||
    !refreshToken ||
    typeof response.expires_in !== "number" ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new CloudflareOAuthError(
      "Cloudflare did not return refreshable credentials. Authorize Cloudflare again.",
    );
  }
  const lifetimeMs = response.expires_in * 1000;
  const refreshLeadMs = Math.min(CLOUDFLARE_ACCESS_TOKEN_REFRESH_WINDOW_MS, lifetimeMs / 2);
  const accessTokenExpiresAt = now + lifetimeMs;
  return {
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt,
    accessTokenRefreshAt: accessTokenExpiresAt - refreshLeadMs,
  };
}

export function cloudflareAccessTokenNeedsRefresh(
  credentials: Pick<CloudflareCredentials, "accessTokenRefreshAt">,
  now: number,
): boolean {
  return now >= credentials.accessTokenRefreshAt;
}

export function createCloudflareCredentialManager(options: {
  secrets: CloudflareSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<CloudflareCredentials | undefined> {
    const raw = await options.secrets.get(CLOUDFLARE_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidCloudflareCredentialsError();
    if (!cloudflareAccessTokenNeedsRefresh(stored, now())) return stored;
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidCloudflareCredentialsError) &&
        !(error instanceof CloudflareOAuthError && error.status === 401)
      ) {
        return stored;
      }
      throw error;
    }
  }

  /**
   * Refresh runs inside the atomic Secret update so concurrent hosts never spend the same refresh
   * token. A peer process that already rotated the credential leaves a different access token,
   * which is kept; if a refresh response omits a new refresh token, the stored one is retained.
   */
  async function refresh(expectedAccessToken: string): Promise<CloudflareCredentials | undefined> {
    let terminalError: CloudflareOAuthError | undefined;
    const raw = await options.secrets.update(CLOUDFLARE_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidCloudflareCredentialsError();
      if (stored.accessToken !== expectedAccessToken) return current;
      if (!cloudflareAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshCloudflareAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(
          cloudflareCredentialsFromTokenResponse(response, now(), stored.refreshToken),
        );
      } catch (error) {
        if (error instanceof CloudflareOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials) throw new InvalidCloudflareCredentialsError();
    return credentials;
  }

  return {
    read,
    async store(response: CloudflareOAuthTokenResponse): Promise<CloudflareCredentials> {
      const credentials = cloudflareCredentialsFromTokenResponse(response, now());
      await options.secrets.set(CLOUDFLARE_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight rotation commits
     * first and the returned credentials are the ones still valid at Cloudflare, ready for revocation.
     */
    async clear(): Promise<CloudflareCredentials | undefined> {
      let removed: CloudflareCredentials | undefined;
      await options.secrets.update(CLOUDFLARE_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): CloudflareCredentials | undefined {
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
    typeof record.accessTokenRefreshAt !== "number" ||
    !Number.isFinite(record.accessTokenRefreshAt) ||
    record.accessTokenRefreshAt < 0
  ) {
    return undefined;
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt,
    accessTokenRefreshAt: record.accessTokenRefreshAt,
  };
}
