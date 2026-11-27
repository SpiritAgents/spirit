import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  PARALLEL_MCP_RESOURCE,
  PARALLEL_OAUTH_AUTHORIZATION_URL,
  PARALLEL_OAUTH_CLIENT_ID,
  PARALLEL_OAUTH_ISSUER,
  PARALLEL_OAUTH_REDIRECT_HOST,
  PARALLEL_OAUTH_REDIRECT_PATH,
  PARALLEL_OAUTH_REVOCATION_URL,
  PARALLEL_OAUTH_SCOPE,
  PARALLEL_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class ParallelOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ParallelOAuthError";
  }
}

export interface ParallelOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface ParallelAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createParallelAuthorizationRequest(): ParallelAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function parallelAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(PARALLEL_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: PARALLEL_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: PARALLEL_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: PARALLEL_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface ParallelAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, an issuer mismatch, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Unrelated requests whose
 * state does not match are rejected without ending the wait. Once a response carries the pending
 * state, its RFC 9207 `iss` parameter must match Parallel's advertised issuer or the attempt fails.
 */
export async function listenForParallelAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<ParallelAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, PARALLEL_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${PARALLEL_OAUTH_REDIRECT_HOST}:${port}${PARALLEL_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: ParallelOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () =>
      finish({ error: new ParallelOAuthError("Parallel authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== PARALLEL_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(response, 400, "This response does not match the pending Parallel authorization.");
        return;
      }
      const issuers = url.searchParams.getAll("iss");
      if (issuers.length !== 1 || issuers[0] !== PARALLEL_OAUTH_ISSUER) {
        respond(
          response,
          400,
          "Parallel authorization returned an unexpected issuer. You can close this tab.",
        );
        finish({
          error: new ParallelOAuthError("Parallel authorization returned an unexpected issuer."),
        });
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(response, 400, "Parallel authorization was not completed. You can close this tab.");
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new ParallelOAuthError(
            error === "access_denied"
              ? "Parallel authorization was denied."
              : `Parallel authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Parallel is connected. You can close this tab.");
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

export function exchangeParallelAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<ParallelOAuthTokenResponse> {
  return requestParallelToken(
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

export function refreshParallelAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<ParallelOAuthTokenResponse> {
  return requestParallelToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/**
 * Revokes a Parallel refresh token at Parallel's Account API revocation endpoint;
 * callers must still delete local credentials first.
 */
export async function revokeParallelToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<void> {
  const response = await input.fetch(PARALLEL_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new ParallelOAuthError(`Parallel token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableParallelHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestParallelToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<ParallelOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(PARALLEL_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: PARALLEL_OAUTH_CLIENT_ID,
        resource: PARALLEL_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new ParallelOAuthError("Parallel authorization was cancelled.");
    throw new ParallelOAuthError(
      "Could not reach Parallel. Check the network connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<ParallelOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (response.status === 401 || (response.status === 400 && payload?.error === "invalid_grant")) {
    throw new ParallelOAuthError("Parallel authorization expired. Authorize Parallel again.", 401);
  }
  if (isRetriableParallelHttpStatus(response.status)) {
    throw new ParallelOAuthError(
      "Parallel is temporarily unavailable. Try again.",
      response.status,
    );
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new ParallelOAuthError(`Parallel token request failed: ${detail}`, response.status);
  }
  return payload as ParallelOAuthTokenResponse;
}
