import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  LINEAR_MCP_RESOURCE,
  LINEAR_OAUTH_AUTHORIZATION_URL,
  LINEAR_OAUTH_CLIENT_ID,
  LINEAR_OAUTH_ISSUER,
  LINEAR_OAUTH_REDIRECT_HOST,
  LINEAR_OAUTH_REDIRECT_PATH,
  LINEAR_OAUTH_REVOCATION_URL,
  LINEAR_OAUTH_SCOPE,
  LINEAR_OAUTH_TOKEN_URL,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export class LinearOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LinearOAuthError";
  }
}

export interface LinearOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface LinearAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function createLinearAuthorizationRequest(): LinearAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function linearAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(LINEAR_OAUTH_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: LINEAR_OAUTH_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: LINEAR_OAUTH_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: LINEAR_MCP_RESOURCE,
  }).toString();
  return url.href;
}

export interface LinearAuthorizationCallback {
  redirectUri: string;
  /** Settles once: with the code, a denial, an issuer mismatch, or cancellation. The listener then closes. */
  code: Promise<string>;
}

/**
 * Receives the authorization response on an ephemeral loopback port. Unrelated requests whose
 * state does not match are rejected without ending the wait. Once a response carries the pending
 * state, its RFC 9207 `iss` parameter must match Linear's advertised issuer or the attempt fails.
 */
export async function listenForLinearAuthorizationCode(input: {
  state: string;
  signal: AbortSignal;
}): Promise<LinearAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LINEAR_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${LINEAR_OAUTH_REDIRECT_HOST}:${port}${LINEAR_OAUTH_REDIRECT_PATH}`;

  const code = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | { error: LinearOAuthError }) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if ("code" in result) resolve(result.code);
      else reject(result.error);
    };
    const abort = () =>
      finish({ error: new LinearOAuthError("Linear authorization was cancelled.") });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== LINEAR_OAUTH_REDIRECT_PATH) {
        respond(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respond(response, 400, "This response does not match the pending Linear authorization.");
        return;
      }
      if (url.searchParams.get("iss") !== LINEAR_OAUTH_ISSUER) {
        respond(
          response,
          400,
          "Linear authorization returned an unexpected issuer. You can close this tab.",
        );
        finish({
          error: new LinearOAuthError("Linear authorization returned an unexpected issuer."),
        });
        return;
      }
      const error = url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode) {
        respond(response, 400, "Linear authorization was not completed. You can close this tab.");
        const detail = url.searchParams.get("error_description") || error || "no code was returned";
        finish({
          error: new LinearOAuthError(
            error === "access_denied"
              ? "Linear authorization was denied."
              : `Linear authorization failed: ${detail}`,
          ),
        });
        return;
      }
      respond(response, 200, "Linear is connected. You can close this tab.");
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

export function exchangeLinearAuthorizationCode(input: {
  fetch: typeof fetch;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  signal?: AbortSignal;
}): Promise<LinearOAuthTokenResponse> {
  return requestLinearToken(
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

export function refreshLinearAccessToken(input: {
  fetch: typeof fetch;
  refreshToken: string;
}): Promise<LinearOAuthTokenResponse> {
  return requestLinearToken(input.fetch, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

/** Revokes a Linear token per RFC 7009; callers must still delete local credentials first. */
export async function revokeLinearToken(input: {
  fetch: typeof fetch;
  token: string;
  hint: "access_token" | "refresh_token";
}): Promise<void> {
  const response = await input.fetch(LINEAR_OAUTH_REVOCATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: LINEAR_OAUTH_CLIENT_ID,
      token: input.token,
      token_type_hint: input.hint,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new LinearOAuthError(`Linear token revocation failed: HTTP ${response.status}`);
  }
}

export function isRetriableLinearHttpStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function requestLinearToken(
  fetchImpl: typeof fetch,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<LinearOAuthTokenResponse> {
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(LINEAR_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: LINEAR_OAUTH_CLIENT_ID,
        resource: LINEAR_MCP_RESOURCE,
        ...values,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) throw new LinearOAuthError("Linear authorization was cancelled.");
    throw new LinearOAuthError(
      "Could not reach Linear. Check the network connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Partial<LinearOAuthTokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (response.status === 401 || (response.status === 400 && payload?.error === "invalid_grant")) {
    throw new LinearOAuthError("Linear authorization expired. Authorize Linear again.", 401);
  }
  if (isRetriableLinearHttpStatus(response.status)) {
    throw new LinearOAuthError("Linear is temporarily unavailable. Try again.", response.status);
  }
  if (!response.ok || payload?.error || typeof payload?.access_token !== "string") {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new LinearOAuthError(`Linear token request failed: ${detail}`, response.status);
  }
  return payload as LinearOAuthTokenResponse;
}
