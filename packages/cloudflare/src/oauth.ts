import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  CLOUDFLARE_MCP_RESOURCE,
  CLOUDFLARE_OAUTH_AUTHORIZATION_URL,
  CLOUDFLARE_OAUTH_CLIENT_ID,
  CLOUDFLARE_OAUTH_ISSUER,
  CLOUDFLARE_OAUTH_REDIRECT_HOST,
  CLOUDFLARE_OAUTH_REDIRECT_PATH,
  CLOUDFLARE_OAUTH_REVOCATION_URL,
  CLOUDFLARE_OAUTH_SCOPE,
  CLOUDFLARE_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class CloudflareOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CloudflareOAuthError";
  }
}

export interface CloudflareOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface CloudflareAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createCloudflareAuthorizationRequest(): CloudflareAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function cloudflareAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(CLOUDFLARE_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLOUDFLARE_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: CLOUDFLARE_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: CLOUDFLARE_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface CloudflareAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, an issuer mismatch, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Only the response carrying the
 * pending state settles the request; unrelated requests are rejected without ending the wait.
 * Cloudflare advertises RFC 9207 issuer identification, so the response `iss` must match.
 */
export async function listenForCloudflareAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<CloudflareAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CLOUDFLARE_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${CLOUDFLARE_OAUTH_REDIRECT_HOST}:${port}${CLOUDFLARE_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: CloudflareOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () =>
      finish({ error: new CloudflareOAuthError("Cloudflare authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== CLOUDFLARE_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(
          response,
          400,
          "This response does not match the pending Cloudflare authorization.",
        );
        return;
      }
      if (url.searchParams.get("iss") !== CLOUDFLARE_OAUTH_ISSUER) {
        respond(
          response,
          400,
          "Cloudflare authorization failed issuer verification. You can close this tab.",
        );
        finish({
          error: new CloudflareOAuthError(
            "Cloudflare authorization failed: unexpected authorization issuer.",
          ),
        });
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(
          response,
          400,
          "Cloudflare authorization was not completed. You can close this tab.",
        );
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new CloudflareOAuthError(
            error === "access_denied"
              ? "Cloudflare authorization was denied."
              : `Cloudflare authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Cloudflare is connected. You can close this tab.");
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

export function exchangeCloudflareAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<CloudflareOAuthTokenResponse> {
  return requestCloudflareToken(
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

export function refreshCloudflareAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<CloudflareOAuthTokenResponse> {
  return requestCloudflareToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Callers must still delete local credentials before attempting remote revocation. */
export async function revokeCloudflareToken(input: {
  fetch: typeof fetch;
  token: string;
  hint: "access_token" | "refresh_token";
}): Promise<void> {
  const response = await input.fetch(CLOUDFLARE_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLOUDFLARE_OAUTH_CLIENT_ID,
      token: input.token,
      token_type_hint: input.hint,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new CloudflareOAuthError(`Cloudflare token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableCloudflareHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestCloudflareToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<CloudflareOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(CLOUDFLARE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLOUDFLARE_OAUTH_CLIENT_ID,
        resource: CLOUDFLARE_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new CloudflareOAuthError("Cloudflare authorization was cancelled.");
    throw new CloudflareOAuthError(
      "Could not reach Cloudflare. Check the network connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<CloudflareOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (response.status === 401 || (response.status === 400 && payload?.error === "invalid_grant")) {
    throw new CloudflareOAuthError(
      "Cloudflare authorization expired. Authorize Cloudflare again.",
      401,
    );
  }
  if (isRetriableCloudflareHttpStatus(response.status)) {
    throw new CloudflareOAuthError(
      "Cloudflare is temporarily unavailable. Try again.",
      response.status,
    );
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new CloudflareOAuthError(`Cloudflare token request failed: ${detail}`, response.status);
  }
  return payload as CloudflareOAuthTokenResponse;
}
