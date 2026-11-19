import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  VERCEL_MCP_RESOURCE,
  VERCEL_OAUTH_AUTHORIZATION_URL,
  VERCEL_OAUTH_CLIENT_ID,
  VERCEL_OAUTH_ISSUER,
  VERCEL_OAUTH_REDIRECT_HOST,
  VERCEL_OAUTH_REDIRECT_PATH,
  VERCEL_OAUTH_REVOCATION_URL,
  VERCEL_OAUTH_SCOPE,
  VERCEL_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class VercelOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VercelOAuthError";
  }
}

export interface VercelOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  /** Returned for the authorization code grant only; refresh responses omit it. */
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Reads the account label from an ID token received directly from the token endpoint over TLS
 * (OpenID Connect Core 3.1.3.7). It only labels the connection, so the signature is not verified;
 * the issuer and audience still have to name Vercel and this client.
 */
export function vercelUsernameFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!claims || typeof claims !== "object") return undefined;
  const { iss, aud, preferred_username } = claims as Record<string, unknown>;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (iss !== VERCEL_OAUTH_ISSUER || !audiences.includes(VERCEL_OAUTH_CLIENT_ID)) return undefined;
  return typeof preferred_username === "string" && preferred_username.trim()
    ? preferred_username.trim()
    : undefined;
}

export interface VercelAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createVercelAuthorizationRequest(): VercelAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function vercelAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(VERCEL_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: VERCEL_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: VERCEL_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: VERCEL_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface VercelAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Only the response carrying the
 * pending state settles the request; unrelated requests are rejected without ending the wait.
 */
export async function listenForVercelAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<VercelAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, VERCEL_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${VERCEL_OAUTH_REDIRECT_HOST}:${port}${VERCEL_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: VercelOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () =>
      finish({ error: new VercelOAuthError("Vercel authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== VERCEL_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(response, 400, "This response does not match the pending Vercel authorization.");
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(response, 400, "Vercel authorization was not completed. You can close this tab.");
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new VercelOAuthError(
            error === "access_denied"
              ? "Vercel authorization was denied."
              : `Vercel authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Vercel is connected. You can close this tab.");
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

export function exchangeVercelAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<VercelOAuthTokenResponse> {
  return requestVercelToken(
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

export function refreshVercelAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<VercelOAuthTokenResponse> {
  return requestVercelToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Revocation is not immediately enforced by Vercel MCP; callers must still delete local credentials. */
export async function revokeVercelToken(input: {
  fetch: typeof fetch;
  token: string;
  hint: "access_token" | "refresh_token";
}): Promise<void> {
  const response = await input.fetch(VERCEL_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: VERCEL_OAUTH_CLIENT_ID,
      token: input.token,
      token_type_hint: input.hint,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new VercelOAuthError(`Vercel token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableVercelHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestVercelToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<VercelOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(VERCEL_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: VERCEL_OAUTH_CLIENT_ID,
        resource: VERCEL_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new VercelOAuthError("Vercel authorization was cancelled.");
    throw new VercelOAuthError(
      "Could not reach Vercel. Check the network connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<VercelOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (payload?.error === "invalid_grant") {
    throw new VercelOAuthError("Vercel authorization expired. Authorize Vercel again.", 401);
  }
  if (isRetriableVercelHttpStatus(response.status)) {
    throw new VercelOAuthError("Vercel is temporarily unavailable. Try again.", response.status);
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new VercelOAuthError(`Vercel token request failed: ${detail}`, response.status);
  }
  return payload as VercelOAuthTokenResponse;
}
