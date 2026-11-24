import { keyringStore } from "../credentials/keyring-store.js";
import { KEYRING_SERVICE } from "../credentials/provider-key-channels.js";
import {
  CHATGPT_OAUTH_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  CHATGPT_OAUTH_REFRESH_TOKEN_LIFETIME_MS,
  type ChatGptOAuthEndpoints,
} from "./oauth-config.js";
import {
  ChatGptOAuthError,
  hasChatGptPlanUsageScope,
  parseScopeList,
  refreshChatGptAccessToken,
  type ChatGptOAuthTokenResponse,
  type VerifiedChatGptIdTokenClaims,
} from "./oauth.js";

/** Error codes where the stored OAuth refresh token or client registration is terminally unusable. */
export const CHATGPT_TERMINAL_REFRESH_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

export interface ChatGptOAuthCredentials {
  clientId: string;
  extAgentHostId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  earliestRefreshAt?: number;
  idToken?: string;
  subject: string;
  email?: string;
  workspaceId?: string;
  scopes: string[];
  savedAt: number;
}

export function chatGptOAuthKeyringAccount(providerId: string): string {
  return `provider::${providerId}::oauth`;
}

function parseEarliestRefreshAtMs(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value.trim());
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber < 1_000_000_000_000 ? asNumber * 1000 : asNumber;
    }
    const parsed = Date.parse(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function chatGptCredentialsFromTokenResponse(input: {
  response: ChatGptOAuthTokenResponse;
  clientId: string;
  extAgentHostId: string;
  claims: VerifiedChatGptIdTokenClaims;
  previous?: ChatGptOAuthCredentials;
  now: number;
}): ChatGptOAuthCredentials {
  const accessToken = input.response.access_token?.trim() ?? "";
  const refreshToken = input.response.refresh_token?.trim() || input.previous?.refreshToken || "";
  const expiresInSeconds = isPositiveFiniteNumber(input.response.expires_in)
    ? input.response.expires_in
    : 3600;
  if (!accessToken || !refreshToken) {
    throw new ChatGptOAuthError(
      "ChatGPT did not return complete refreshable credentials. Authorize ChatGPT again.",
      { code: "invalid_token_response" },
    );
  }

  const scopes = input.response.scope
    ? parseScopeList(input.response.scope)
    : (input.previous?.scopes ?? []);
  const parsedEarliestRefreshAt = parseEarliestRefreshAtMs(input.response.earliest_refresh_at);
  const previousEarliestRefreshAt =
    input.previous?.earliestRefreshAt !== undefined && input.previous.earliestRefreshAt > input.now
      ? input.previous.earliestRefreshAt
      : undefined;
  const earliestRefreshAt = parsedEarliestRefreshAt ?? previousEarliestRefreshAt;
  const idToken = input.response.id_token?.trim() || input.previous?.idToken;

  const email = input.claims.email ?? input.previous?.email;
  const workspaceId = input.claims.workspaceId ?? input.previous?.workspaceId;

  return {
    clientId: input.clientId,
    extAgentHostId: input.extAgentHostId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: input.now + expiresInSeconds * 1000,
    refreshTokenExpiresAt: input.now + CHATGPT_OAUTH_REFRESH_TOKEN_LIFETIME_MS,
    ...(earliestRefreshAt !== undefined ? { earliestRefreshAt } : {}),
    ...(idToken ? { idToken } : {}),
    subject: input.claims.subject,
    ...(email ? { email } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    scopes,
    savedAt: input.now,
  };
}

function parseStoredChatGptCredentials(raw: string): ChatGptOAuthCredentials | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.clientId !== "string" ||
      !record.clientId.trim() ||
      typeof record.extAgentHostId !== "string" ||
      !record.extAgentHostId.trim() ||
      typeof record.accessToken !== "string" ||
      !record.accessToken.trim() ||
      typeof record.refreshToken !== "string" ||
      !record.refreshToken.trim() ||
      !isPositiveFiniteNumber(record.accessTokenExpiresAt) ||
      !isPositiveFiniteNumber(record.refreshTokenExpiresAt) ||
      typeof record.subject !== "string" ||
      !record.subject.trim()
    ) {
      return undefined;
    }
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((item): item is string => typeof item === "string")
      : [];
    return {
      clientId: record.clientId,
      extAgentHostId: record.extAgentHostId,
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      accessTokenExpiresAt: record.accessTokenExpiresAt,
      refreshTokenExpiresAt: record.refreshTokenExpiresAt,
      ...(isPositiveFiniteNumber(record.earliestRefreshAt)
        ? { earliestRefreshAt: record.earliestRefreshAt }
        : {}),
      ...(typeof record.idToken === "string" && record.idToken.trim()
        ? { idToken: record.idToken.trim() }
        : {}),
      subject: record.subject,
      ...(typeof record.email === "string" && record.email.trim()
        ? { email: record.email.trim() }
        : {}),
      ...(typeof record.workspaceId === "string" && record.workspaceId.trim()
        ? { workspaceId: record.workspaceId.trim() }
        : {}),
      scopes,
      savedAt: isPositiveFiniteNumber(record.savedAt) ? record.savedAt : Date.now(),
    };
  } catch {
    return undefined;
  }
}

export function readStoredChatGptOAuthCredentials(
  providerId: string,
): ChatGptOAuthCredentials | undefined {
  const raw = keyringStore().getPassword(KEYRING_SERVICE, chatGptOAuthKeyringAccount(providerId));
  return raw ? parseStoredChatGptCredentials(raw) : undefined;
}

export function hasStoredChatGptOAuthCredentials(providerId: string): boolean {
  return readStoredChatGptOAuthCredentials(providerId) !== undefined;
}

export function storeChatGptOAuthCredentials(
  providerId: string,
  credentials: ChatGptOAuthCredentials,
): void {
  keyringStore().setPassword(
    KEYRING_SERVICE,
    chatGptOAuthKeyringAccount(providerId),
    JSON.stringify(credentials),
  );
}

export function clearChatGptOAuthCredentials(providerId: string): void {
  keyringStore().deletePassword(KEYRING_SERVICE, chatGptOAuthKeyringAccount(providerId));
}

export function chatGptAccessTokenNeedsRefresh(
  credentials: Pick<ChatGptOAuthCredentials, "accessTokenExpiresAt" | "earliestRefreshAt">,
  now: number,
): boolean {
  if (now >= credentials.accessTokenExpiresAt) {
    return true;
  }
  const withinWindow =
    credentials.accessTokenExpiresAt - now <= CHATGPT_OAUTH_ACCESS_TOKEN_REFRESH_WINDOW_MS;
  if (!withinWindow) {
    return false;
  }
  if (credentials.earliestRefreshAt !== undefined && now < credentials.earliestRefreshAt) {
    return false;
  }
  return true;
}

function isTerminalRefreshError(error: unknown): boolean {
  if (!(error instanceof ChatGptOAuthError)) {
    return false;
  }
  return Boolean(error.code && CHATGPT_TERMINAL_REFRESH_ERROR_CODES.has(error.code));
}

/** Process-wide per-provider mutex so concurrent refreshes and reconnects never race on rotating tokens. */
const refreshLocks = new Map<string, Promise<unknown>>();

export async function withChatGptOAuthLock<T>(
  providerId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = refreshLocks.get(providerId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(
    () => gate,
    () => gate,
  );
  refreshLocks.set(providerId, chained);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (refreshLocks.get(providerId) === chained) {
      refreshLocks.delete(providerId);
    }
  }
}

export async function storeChatGptOAuthCredentialsLocked(
  providerId: string,
  credentials: ChatGptOAuthCredentials,
): Promise<void> {
  await withChatGptOAuthLock(providerId, async () => {
    storeChatGptOAuthCredentials(providerId, credentials);
  });
}

export async function clearChatGptOAuthCredentialsLocked(providerId: string): Promise<void> {
  await withChatGptOAuthLock(providerId, async () => {
    clearChatGptOAuthCredentials(providerId);
  });
}

export function createChatGptOAuthCredentialManager(options: {
  providerId: string;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const now = () => options.now?.() ?? Date.now();

  async function refresh(input: {
    expectedAccessToken?: string;
    force: boolean;
  }): Promise<ChatGptOAuthCredentials> {
    return withChatGptOAuthLock(options.providerId, async () => {
      const current = readStoredChatGptOAuthCredentials(options.providerId);
      if (!current) {
        throw new ChatGptOAuthError("ChatGPT is not connected. Sign in again.", {
          code: "subscription_sharing_invalid_user",
          status: 401,
          providerId: options.providerId,
        });
      }
      if (
        input.expectedAccessToken !== undefined &&
        current.accessToken !== input.expectedAccessToken
      ) {
        return current;
      }
      if (!input.force && !chatGptAccessTokenNeedsRefresh(current, now())) {
        return current;
      }
      if (current.refreshTokenExpiresAt <= now()) {
        clearChatGptOAuthCredentials(options.providerId);
        throw new ChatGptOAuthError("ChatGPT authorization has expired. Sign in again.", {
          code: "refresh_token_expired",
          status: 401,
          providerId: options.providerId,
        });
      }

      try {
        const response = await refreshChatGptAccessToken({
          clientId: current.clientId,
          refreshToken: current.refreshToken,
          ...(options.endpoints ? { endpoints: options.endpoints } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
        const next = chatGptCredentialsFromTokenResponse({
          response,
          clientId: current.clientId,
          extAgentHostId: current.extAgentHostId,
          claims: {
            subject: current.subject,
            ...(current.email ? { email: current.email } : {}),
            ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
          },
          previous: current,
          now: now(),
        });
        if (!hasChatGptPlanUsageScope(next.scopes)) {
          clearChatGptOAuthCredentials(options.providerId);
          throw new ChatGptOAuthError(
            "ChatGPT plan usage permission is no longer granted. Sign in again to enable it.",
            {
              code: "chatpass_v2_scope_not_authorized",
              status: 403,
              providerId: options.providerId,
            },
          );
        }
        const latestBeforeWrite = readStoredChatGptOAuthCredentials(options.providerId);
        if (!latestBeforeWrite) {
          throw new ChatGptOAuthError("ChatGPT was disconnected while refreshing credentials.", {
            code: "subscription_sharing_invalid_user",
            status: 401,
            providerId: options.providerId,
          });
        }
        if (latestBeforeWrite.accessToken !== current.accessToken) {
          return latestBeforeWrite;
        }
        storeChatGptOAuthCredentials(options.providerId, next);
        return next;
      } catch (error) {
        if (isTerminalRefreshError(error)) {
          const latestBeforeClear = readStoredChatGptOAuthCredentials(options.providerId);
          if (!latestBeforeClear || latestBeforeClear.accessToken === current.accessToken) {
            clearChatGptOAuthCredentials(options.providerId);
          }
          const oauthError = error as ChatGptOAuthError;
          throw new ChatGptOAuthError(oauthError.message, {
            ...(oauthError.code ? { code: oauthError.code } : {}),
            status: oauthError.status ?? 401,
            providerId: options.providerId,
            cause: error,
          });
        }
        throw error;
      }
    });
  }

  async function read(
    readOptions: { allowValidTokenOnRefreshFailure?: boolean } = {},
  ): Promise<ChatGptOAuthCredentials | undefined> {
    const stored = readStoredChatGptOAuthCredentials(options.providerId);
    if (!stored) {
      return undefined;
    }
    if (!chatGptAccessTokenNeedsRefresh(stored, now())) {
      return stored;
    }
    try {
      return await refresh({ expectedAccessToken: stored.accessToken, force: false });
    } catch (error) {
      if (
        readOptions.allowValidTokenOnRefreshFailure !== false &&
        stored.accessTokenExpiresAt > now() &&
        !isTerminalRefreshError(error)
      ) {
        return stored;
      }
      throw error;
    }
  }

  return {
    read,
    async getAccessToken(): Promise<string> {
      const credentials = await read();
      if (!credentials) {
        throw new ChatGptOAuthError("ChatGPT is not connected. Sign in again.", {
          code: "subscription_sharing_invalid_user",
          status: 401,
          providerId: options.providerId,
        });
      }
      return credentials.accessToken;
    },
    async refreshAfterUnauthorized(rejectedAccessToken: string): Promise<string | undefined> {
      const refreshed = await refresh({
        expectedAccessToken: rejectedAccessToken,
        force: true,
      });
      return refreshed.accessToken;
    },
    clear(): void {
      clearChatGptOAuthCredentials(options.providerId);
    },
  };
}
