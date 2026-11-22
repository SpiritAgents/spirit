import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  NOTION_MCP_RESOURCE,
  NOTION_OAUTH_AUTHORIZATION_URL,
  NOTION_OAUTH_CLIENT_ID,
  NOTION_OAUTH_ISSUER,
  NOTION_OAUTH_REDIRECT_HOST,
  NOTION_OAUTH_REDIRECT_PATH,
  NOTION_OAUTH_REVOCATION_URL,
  NOTION_OAUTH_SCOPE,
  NOTION_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class NotionOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "NotionOAuthError";
  }
}

export interface NotionOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface NotionAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createNotionAuthorizationRequest(): NotionAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function notionAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(NOTION_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: NOTION_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: NOTION_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: NOTION_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface NotionAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, an issuer mismatch, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Only the response carrying the
 * pending state settles the request; unrelated requests are rejected without ending the wait.
 * RFC 9207 issuer verification is enforced because Notion advertises iss parameter support.
 */
export async function listenForNotionAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<NotionAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, NOTION_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${NOTION_OAUTH_REDIRECT_HOST}:${port}${NOTION_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: NotionOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () =>
      finish({ error: new NotionOAuthError("Notion authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== NOTION_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(response, 400, "This response does not match the pending Notion authorization.");
        return;
      }
      const issuers = url.searchParams.getAll("iss");
      if (issuers.length !== 1 || issuers[0] !== NOTION_OAUTH_ISSUER) {
        respond(
          response,
          400,
          "Notion authorization response had an unexpected issuer. You can close this tab.",
        );
        finish({
          error: new NotionOAuthError("Notion authorization response had an unexpected issuer."),
        });
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(response, 400, "Notion authorization was not completed. You can close this tab.");
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new NotionOAuthError(
            error === "access_denied"
              ? "Notion authorization was denied."
              : `Notion authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Notion is connected. You can close this tab.");
      finish({ code: authorizationCode });
    });
  });
  return { redirectUri, code };
}

function respond(response: ServerResponse, status: number, message: string) {
  // Plain text so nothing from the query string can be rendered as markup on this origin.
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(`${message}\n`);
}

export function exchangeNotionAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<NotionOAuthTokenResponse> {
  return requestNotionToken(
    input.fetch,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    input.signal,
  );
}

export function refreshNotionAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<NotionOAuthTokenResponse> {
  return requestNotionToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Revocation is best-effort; callers must still delete local credentials first. */
export async function revokeNotionToken(input: {
  fetch: typeof fetch;
  token: string;
  hint: "access_token" | "refresh_token";
}): Promise<void> {
  const response = await input.fetch(NOTION_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: NOTION_OAUTH_CLIENT_ID,
      token: input.token,
      token_type_hint: input.hint,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new NotionOAuthError(`Notion token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableNotionHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestNotionToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<NotionOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(NOTION_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: NOTION_OAUTH_CLIENT_ID,
        resource: NOTION_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new NotionOAuthError("Notion authorization was cancelled.");
    throw new NotionOAuthError(
      "Could not reach Notion. Check the network connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<NotionOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (
    (response.status === 400 && payload?.error === "invalid_grant") ||
    (response.status === 401 &&
      (payload?.error === "invalid_grant" || values.grant_type === "refresh_token"))
  ) {
    throw new NotionOAuthError("Notion authorization expired. Authorize Notion again.", 401);
  }
  if (isRetriableNotionHttpStatus(response.status)) {
    throw new NotionOAuthError("Notion is temporarily unavailable. Try again.", response.status);
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new NotionOAuthError(`Notion token request failed: ${detail}`, response.status);
  }
  return payload as NotionOAuthTokenResponse;
}
