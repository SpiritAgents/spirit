import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  EXA_MCP_RESOURCE,
  EXA_OAUTH_AUTHORIZATION_URL,
  EXA_OAUTH_CLIENT_ID,
  EXA_OAUTH_ISSUER,
  EXA_OAUTH_REDIRECT_HOST,
  EXA_OAUTH_REDIRECT_PATH,
  EXA_OAUTH_REVOCATION_URL,
  EXA_OAUTH_SCOPE,
  EXA_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class ExaOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExaOAuthError";
  }
}

export interface ExaOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface ExaAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createExaAuthorizationRequest(): ExaAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function exaAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(EXA_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: EXA_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: EXA_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: EXA_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface ExaAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, an issuer mismatch, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Unrelated requests whose
 * state does not match are rejected without ending the wait. Exa does not advertise RFC 9207
 * `authorization_response_iss_parameter_supported`, so an omitted `iss` is accepted while a
 * present `iss` must equal Exa's issuer or the attempt fails with HTTP 400.
 */
export async function listenForExaAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<ExaAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, EXA_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${EXA_OAUTH_REDIRECT_HOST}:${port}${EXA_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: ExaOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () => finish({ error: new ExaOAuthError("Exa authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== EXA_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(response, 400, "This response does not match the pending Exa authorization.");
        return;
      }
      const issuer = url.searchParams.get("iss");
      if (issuer !== null && issuer !== EXA_OAUTH_ISSUER) {
        respond(
          response,
          400,
          "Exa authorization returned an unexpected issuer. You can close this tab.",
        );
        finish({
          error: new ExaOAuthError("Exa authorization returned an unexpected issuer."),
        });
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(response, 400, "Exa authorization was not completed. You can close this tab.");
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new ExaOAuthError(
            error === "access_denied"
              ? "Exa authorization was denied."
              : `Exa authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Exa is connected. You can close this tab.");
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

export function exchangeExaAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<ExaOAuthTokenResponse> {
  return requestExaToken(
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

export function refreshExaAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<ExaOAuthTokenResponse> {
  return requestExaToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Revokes an Exa token per RFC 7009; callers must still delete local credentials first. */
export async function revokeExaToken(input: {
  fetch: typeof fetch;
  token: string;
  hint: "access_token" | "refresh_token";
}): Promise<void> {
  const response = await input.fetch(EXA_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: EXA_OAUTH_CLIENT_ID,
      token: input.token,
      token_type_hint: input.hint,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new ExaOAuthError(`Exa token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableExaHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestExaToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<ExaOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(EXA_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: EXA_OAUTH_CLIENT_ID,
        resource: EXA_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new ExaOAuthError("Exa authorization was cancelled.");
    throw new ExaOAuthError("Could not reach Exa. Check the network connection and try again.");
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<ExaOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (response.status === 401 || (response.status === 400 && payload?.error === "invalid_grant")) {
    throw new ExaOAuthError("Exa authorization expired. Authorize Exa again.", 401);
  }
  if (isRetriableExaHttpStatus(response.status)) {
    throw new ExaOAuthError("Exa is temporarily unavailable. Try again.", response.status);
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new ExaOAuthError(`Exa token request failed: ${detail}`, response.status);
  }
  return payload as ExaOAuthTokenResponse;
}
