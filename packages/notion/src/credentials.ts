import type { SpiritExtensionContext } from "@spiritagent/extension-toolkit/desktop-ui";

import {
  NotionOAuthError,
  refreshNotionAccessToken,
  type NotionOAuthTokenResponse,
} from "./oauth.js";

export const NOTION_CREDENTIAL_SLOT = "oauthCredentials";
export const NOTION_ACCESS_TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;

export interface NotionCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export class InvalidNotionCredentialsError extends Error {
  constructor() {
    super("Stored Notion authorization is invalid. Disconnect and authorize again.");
    this.name = "InvalidNotionCredentialsError";
  }
}

type NotionSecrets = Pick<SpiritExtensionContext["secrets"], "get" | "set" | "update" | "delete">;

export function notionCredentialsFromTokenResponse(
  response: NotionOAuthTokenResponse,
  now: number,
  fallbackRefreshToken?: string,
): NotionCredentials {
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
    throw new NotionOAuthError(
      "Notion did not return refreshable credentials. Authorize Notion again.",
    );
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt: now + response.expires_in * 1000,
  };
}

export function notionAccessTokenNeedsRefresh(
  credentials: Pick<NotionCredentials, "accessTokenExpiresAt">,
  now: number,
): boolean {
  return now >= credentials.accessTokenExpiresAt - NOTION_ACCESS_TOKEN_REFRESH_WINDOW_MS;
}

export function createNotionCredentialManager(options: {
  secrets: NotionSecrets;
  fetch: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<NotionCredentials | undefined> {
    const raw = await options.secrets.get(NOTION_CREDENTIAL_SLOT);
    if (raw === undefined) return undefined;
    const stored = parseStoredCredentials(raw);
    if (!stored) throw new InvalidNotionCredentialsError();
    if (!notionAccessTokenNeedsRefresh(stored, now())) return stored;
    try {
      return await refresh(stored.accessToken);
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !(error instanceof InvalidNotionCredentialsError) &&
        !(error instanceof NotionOAuthError && error.status === 401)
      ) {
        return stored;
      }
      throw error;
    }
  }

  /**
   * Refresh tokens rotate on use, so the exchange runs inside the atomic Secret update. A peer
   * process that already rotated the credential leaves a different access token, which is kept.
   */
  async function refresh(expectedAccessToken: string): Promise<NotionCredentials | undefined> {
    let terminalError: NotionOAuthError | undefined;
    const raw = await options.secrets.update(NOTION_CREDENTIAL_SLOT, async (current) => {
      if (current === undefined) return undefined;
      const stored = parseStoredCredentials(current);
      if (!stored) throw new InvalidNotionCredentialsError();
      if (stored.accessToken !== expectedAccessToken) return current;
      if (!notionAccessTokenNeedsRefresh(stored, now())) return current;
      try {
        const response = await refreshNotionAccessToken({
          fetch: options.fetch,
          refreshToken: stored.refreshToken,
        });
        return JSON.stringify(
          notionCredentialsFromTokenResponse(response, now(), stored.refreshToken),
        );
      } catch (error) {
        if (error instanceof NotionOAuthError && error.status === 401) {
          terminalError = error;
          return undefined;
        }
        throw error;
      }
    });
    if (terminalError) throw terminalError;
    if (raw === undefined) return undefined;
    const credentials = parseStoredCredentials(raw);
    if (!credentials) throw new InvalidNotionCredentialsError();
    return credentials;
  }

  return {
    read,
    async store(response: NotionOAuthTokenResponse): Promise<NotionCredentials> {
      const credentials = notionCredentialsFromTokenResponse(response, now());
      await options.secrets.set(NOTION_CREDENTIAL_SLOT, JSON.stringify(credentials));
      return credentials;
    },
    /**
     * Removes the credential under the same Secret lock as refresh, so an in-flight rotation commits
     * first and the returned credentials are the ones still valid at Notion, ready for revocation.
     */
    async clear(): Promise<NotionCredentials | undefined> {
      let removed: NotionCredentials | undefined;
      await options.secrets.update(NOTION_CREDENTIAL_SLOT, (current) => {
        removed = current === undefined ? undefined : parseStoredCredentials(current);
        return undefined;
      });
      return removed;
    },
  };
}

function parseStoredCredentials(raw: string): NotionCredentials | undefined {
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
