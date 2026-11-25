import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chmod, rename, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import {
  CHATGPT_OAUTH_AGENT_NAME_HINT,
  CHATGPT_OAUTH_DYNAMIC_CLIENT_ID,
  CHATGPT_OAUTH_REDIRECT_HOST,
  CHATGPT_OAUTH_REDIRECT_PATH,
  CHATGPT_OAUTH_SCOPES,
  CHATGPT_PLAN_USAGE_SCOPE,
  resolveChatGptOAuthEndpoints,
  resolveChatGptOAuthFetch,
  type ChatGptOAuthEndpoints,
} from "./oauth-config.js";

const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const JWT_CLOCK_SKEW_SECONDS = 60;
const HOST_ID_FILENAME = "chatgpt-host-id";

export class ChatGptOAuthError extends Error {
  readonly isRetryable = false;
  readonly code?: string;
  readonly status?: number;
  readonly statusCode?: number;
  readonly providerId?: string;

  constructor(
    message: string,
    options?: {
      code?: string;
      status?: number;
      providerId?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChatGptOAuthError";
    if (options?.code !== undefined) this.code = options.code;
    if (options?.status !== undefined) {
      this.status = options.status;
      this.statusCode = options.status;
    }
    if (options?.providerId !== undefined) this.providerId = options.providerId;
  }
}

export interface ChatGptOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  earliest_refresh_at?: string | number;
}

export interface ChatGptAuthorizationRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
}

export interface ChatGptAuthorizationCallbackResult {
  code: string;
  clientId: string;
  scope?: string;
}

export interface ChatGptAuthorizationCallback {
  redirectUri: string;
  result: Promise<ChatGptAuthorizationCallbackResult>;
}

export interface VerifiedChatGptIdTokenClaims {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  workspaceId?: string;
}

/**
 * Generates an RFC 9278 JWK thumbprint URI (`urn:ietf:params:oauth:jwk-thumbprint:sha-256:...`)
 * derived from a fresh P-256 public key, as recommended by OpenAI SIWC docs for `ext_agent_host_id`.
 */
export function generateChatGptExtAgentHostId(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as {
    crv: string;
    kty: string;
    x: string;
    y: string;
  };
  // RFC 7638 canonical member order for EC keys: crv, kty, x, y.
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const thumbprint = createHash("sha256").update(canonical).digest("base64url");
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${thumbprint}`;
}

/** Reads or creates the persisted opaque `ext_agent_host_id` for this Spirit installation. */
export async function getOrCreateChatGptExtAgentHostId(spiritDataDir: string): Promise<string> {
  const filePath = join(spiritDataDir, HOST_ID_FILENAME);
  if (existsSync(filePath)) {
    try {
      const existing = readFileSync(filePath, "utf8").trim();
      if (existing.length > 0) {
        return existing;
      }
    } catch {
      // Fall through and regenerate if unreadable.
    }
  }
  mkdirSync(spiritDataDir, { recursive: true });
  const hostId = generateChatGptExtAgentHostId();
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, `${hostId}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(tempPath, 0o600);
  } catch {
    // Ignore chmod failures on filesystems that do not support POSIX modes.
  }
  await rename(tempPath, filePath);
  return hostId;
}

export function createChatGptAuthorizationRequest(): ChatGptAuthorizationRequest {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function buildChatGptAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  extAgentHostId: string;
  clientId?: string;
  idTokenHint?: string;
  loginHint?: string;
  promptConsent?: boolean;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
}): string {
  const endpoints = resolveChatGptOAuthEndpoints(input.endpoints);
  const url = new URL(endpoints.authorizationUrl);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId?.trim() || CHATGPT_OAUTH_DYNAMIC_CLIENT_ID,
    redirect_uri: input.redirectUri,
    scope: CHATGPT_OAUTH_SCOPES.join(" "),
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    resource: endpoints.resource,
    ext_agent_host_id: input.extAgentHostId,
    agent_name_hint: CHATGPT_OAUTH_AGENT_NAME_HINT,
  });
  if (input.idTokenHint?.trim()) {
    params.set("id_token_hint", input.idTokenHint.trim());
  }
  if (input.loginHint?.trim()) {
    params.set("login_hint", input.loginHint.trim());
  }
  if (input.promptConsent) {
    params.set("prompt", "consent");
  }
  url.search = params.toString();
  return url.href;
}

export function parseScopeList(scope: string | undefined): string[] {
  if (!scope) {
    return [];
  }
  return [
    ...new Set(
      scope
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

export function hasChatGptPlanUsageScope(scopes: readonly string[] | string | undefined): boolean {
  const list = typeof scopes === "string" ? parseScopeList(scopes) : (scopes ?? []);
  return list.includes(CHATGPT_PLAN_USAGE_SCOPE);
}

/**
 * Listens on an ephemeral `127.0.0.1` loopback port for the SIWC OAuth callback.
 * Validates `state`, enforces dynamic registration `client_id` issuance, and prevents reauthorization
 * from silently replacing an existing account's client ID.
 */
export async function listenForChatGptAuthorizationCallback(input: {
  state: string;
  expectedClientId?: string;
  signal: AbortSignal;
}): Promise<ChatGptAuthorizationCallback> {
  input.signal.throwIfAborted();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CHATGPT_OAUTH_REDIRECT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${CHATGPT_OAUTH_REDIRECT_HOST}:${port}${CHATGPT_OAUTH_REDIRECT_PATH}`;

  const result = new Promise<ChatGptAuthorizationCallbackResult>((resolve, reject) => {
    let settled = false;
    const finish = (
      outcome:
        | { ok: true; value: ChatGptAuthorizationCallbackResult }
        | { ok: false; error: ChatGptOAuthError },
    ) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const abort = () =>
      finish({
        ok: false,
        error: new ChatGptOAuthError("ChatGPT authorization was cancelled.", {
          code: "cancelled",
        }),
      });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) {
      abort();
      return;
    }

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (settled || request.method !== "GET" || url.pathname !== CHATGPT_OAUTH_REDIRECT_PATH) {
        respondPlainText(response, 404, "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== input.state) {
        respondPlainText(
          response,
          400,
          "This response does not match the pending ChatGPT authorization.",
        );
        return;
      }

      const errorParam = url.searchParams.get("error")?.trim();
      const authorizationCode = url.searchParams.get("code")?.trim();
      if (errorParam || !authorizationCode) {
        respondPlainText(
          response,
          400,
          "ChatGPT authorization was not completed. You can close this tab.",
        );
        const detail =
          url.searchParams.get("error_description")?.trim() || errorParam || "no code was returned";
        finish({
          ok: false,
          error: new ChatGptOAuthError(
            errorParam === "access_denied"
              ? "ChatGPT authorization was declined."
              : `ChatGPT authorization failed: ${detail}`,
            { code: errorParam || "authorization_failed" },
          ),
        });
        return;
      }

      const returnedClientId = url.searchParams.get("client_id")?.trim() || undefined;
      let resolvedClientId: string;
      if (input.expectedClientId) {
        if (returnedClientId && returnedClientId !== input.expectedClientId) {
          respondPlainText(
            response,
            400,
            "ChatGPT returned a mismatched client registration. You can close this tab.",
          );
          finish({
            ok: false,
            error: new ChatGptOAuthError(
              "ChatGPT authorization returned a different client ID than the saved registration.",
              { code: "invalid_client" },
            ),
          });
          return;
        }
        resolvedClientId = input.expectedClientId;
      } else {
        if (!returnedClientId || returnedClientId === CHATGPT_OAUTH_DYNAMIC_CLIENT_ID) {
          respondPlainText(
            response,
            400,
            "ChatGPT did not issue a valid client registration. You can close this tab.",
          );
          finish({
            ok: false,
            error: new ChatGptOAuthError(
              "ChatGPT authorization did not return an issued client ID.",
              { code: "invalid_client" },
            ),
          });
          return;
        }
        resolvedClientId = returnedClientId;
      }

      const scope = url.searchParams.get("scope")?.trim() || undefined;
      respondPlainText(response, 200, "ChatGPT is connected. You can close this tab.");
      finish({
        ok: true,
        value: {
          code: authorizationCode,
          clientId: resolvedClientId,
          ...(scope ? { scope } : {}),
        },
      });
    });
  });

  return { redirectUri, result };
}

function respondPlainText(response: ServerResponse, status: number, message: string): void {
  // Plain text prevents any query parameters from being interpreted as active markup on loopback.
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(`${message}\n`);
}

function readTokenEndpointError(
  payload: unknown,
  status: number,
): { code?: string; message: string } {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nested =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : undefined;
    const code =
      (typeof nested?.code === "string" && nested.code.trim()) ||
      (typeof record.error === "string" && record.error.trim()) ||
      (typeof record.code === "string" && record.code.trim()) ||
      undefined;
    const message =
      (typeof nested?.message === "string" && nested.message.trim()) ||
      (typeof record.error_description === "string" && record.error_description.trim()) ||
      (typeof record.message === "string" && record.message.trim()) ||
      code ||
      `ChatGPT token request failed (HTTP ${status}).`;
    return { ...(code ? { code } : {}), message };
  }
  return { message: `ChatGPT token request failed (HTTP ${status}).` };
}

async function requestChatGptToken(input: {
  body: Record<string, string>;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ChatGptOAuthTokenResponse> {
  const endpoints = resolveChatGptOAuthEndpoints(input.endpoints);
  const fetchFn = resolveChatGptOAuthFetch(input.fetch);
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  const response = await fetchFn(endpoints.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(input.body).toString(),
    signal,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const { code, message } = readTokenEndpointError(parsed, response.status);
    throw new ChatGptOAuthError(message, {
      ...(code ? { code } : {}),
      status: response.status,
    });
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { access_token?: unknown }).access_token !== "string" ||
    !(parsed as { access_token: string }).access_token.trim()
  ) {
    throw new ChatGptOAuthError("ChatGPT token endpoint returned an incomplete response.", {
      code: "invalid_token_response",
      status: response.status,
    });
  }

  return parsed as ChatGptOAuthTokenResponse;
}

export function exchangeChatGptAuthorizationCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ChatGptOAuthTokenResponse> {
  if (!input.clientId.trim() || input.clientId.trim() === CHATGPT_OAUTH_DYNAMIC_CLIENT_ID) {
    throw new ChatGptOAuthError("Token exchange requires an issued ChatGPT client ID.", {
      code: "invalid_client",
    });
  }
  const endpoints = resolveChatGptOAuthEndpoints(input.endpoints);
  return requestChatGptToken({
    body: {
      grant_type: "authorization_code",
      client_id: input.clientId.trim(),
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      resource: endpoints.resource,
    },
    ...(input.endpoints ? { endpoints: input.endpoints } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export function refreshChatGptAccessToken(input: {
  clientId: string;
  refreshToken: string;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ChatGptOAuthTokenResponse> {
  const endpoints = resolveChatGptOAuthEndpoints(input.endpoints);
  return requestChatGptToken({
    body: {
      grant_type: "refresh_token",
      client_id: input.clientId.trim(),
      refresh_token: input.refreshToken,
      resource: endpoints.resource,
    },
    ...(input.endpoints ? { endpoints: input.endpoints } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

interface JwkWithKid {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

const jwksCache = new Map<string, { fetchedAt: number; keys: JwkWithKid[] }>();

async function fetchJwksKeys(input: {
  jwksUrl: string;
  fetch: typeof fetch;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<JwkWithKid[]> {
  const now = Date.now();
  const cached = jwksCache.get(input.jwksUrl);
  if (!input.forceRefresh && cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const response = await input.fetch(input.jwksUrl, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new ChatGptOAuthError(`Failed to fetch OpenAI JWKS (HTTP ${response.status}).`, {
      code: "jwks_fetch_failed",
      status: response.status,
    });
  }
  const payload = (await response.json()) as { keys?: unknown };
  if (!payload || !Array.isArray(payload.keys)) {
    throw new ChatGptOAuthError("OpenAI JWKS response did not contain a keys array.", {
      code: "jwks_invalid",
    });
  }
  const keys = payload.keys.filter(
    (entry): entry is JwkWithKid => typeof entry === "object" && entry !== null,
  );
  jwksCache.set(input.jwksUrl, { fetchedAt: now, keys });
  return keys;
}

function verifyJwtSignatureWithJwk(
  signingInput: string,
  signature: Buffer,
  alg: string,
  jwk: JwkWithKid,
): boolean {
  const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
  const data = Buffer.from(signingInput, "utf8");
  switch (alg) {
    case "RS256":
      return verifySignature("sha256", data, publicKey, signature);
    case "RS384":
      return verifySignature("sha384", data, publicKey, signature);
    case "RS512":
      return verifySignature("sha512", data, publicKey, signature);
    case "PS256":
      return verifySignature(
        "sha256",
        data,
        {
          key: publicKey,
          padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
          saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      );
    case "ES256":
      return verifySignature(
        "sha256",
        data,
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      );
    case "ES384":
      return verifySignature(
        "sha384",
        data,
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      );
    default:
      return false;
  }
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Verifies the OIDC ID token signature against OpenAI JWKS and validates issuer, audience, nonce, and expiry. */
export async function verifyChatGptIdToken(input: {
  idToken: string;
  expectedClientId: string;
  expectedNonce?: string;
  endpoints?: Partial<ChatGptOAuthEndpoints>;
  fetch?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<VerifiedChatGptIdTokenClaims> {
  const parts = input.idToken.split(".");
  if (parts.length !== 3) {
    throw new ChatGptOAuthError("Invalid ChatGPT ID token format.", { code: "invalid_id_token" });
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeBase64UrlJson(headerPart);
  const claims = decodeBase64UrlJson(payloadPart);
  if (!header || !claims) {
    throw new ChatGptOAuthError("Unable to decode ChatGPT ID token.", { code: "invalid_id_token" });
  }

  const alg = typeof header.alg === "string" ? header.alg : "";
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  if (!alg || alg === "none") {
    throw new ChatGptOAuthError("Unsupported ChatGPT ID token signature algorithm.", {
      code: "invalid_id_token",
    });
  }

  const endpoints = resolveChatGptOAuthEndpoints(input.endpoints);
  const fetchFn = resolveChatGptOAuthFetch(input.fetch);
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = Buffer.from(signaturePart, "base64url");

  const findCandidates = (keys: JwkWithKid[]) =>
    kid
      ? keys.filter((key) => key.kid === kid)
      : keys.filter((key) => !key.use || key.use === "sig");

  let keys = await fetchJwksKeys({
    jwksUrl: endpoints.jwksUrl,
    fetch: fetchFn,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  let candidates = findCandidates(keys);
  if (candidates.length === 0) {
    keys = await fetchJwksKeys({
      jwksUrl: endpoints.jwksUrl,
      fetch: fetchFn,
      forceRefresh: true,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    candidates = findCandidates(keys);
  }

  const verified = candidates.some((jwk) => {
    try {
      return verifyJwtSignatureWithJwk(signingInput, signature, alg, jwk);
    } catch {
      return false;
    }
  });
  if (!verified) {
    throw new ChatGptOAuthError("ChatGPT ID token signature verification failed.", {
      code: "invalid_id_token",
    });
  }

  const issuer = typeof claims.iss === "string" ? claims.iss.replace(/\/+$/u, "") : "";
  const expectedIssuer = endpoints.issuer.replace(/\/+$/u, "");
  if (issuer !== expectedIssuer) {
    throw new ChatGptOAuthError("ChatGPT ID token issuer mismatch.", { code: "invalid_id_token" });
  }

  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : [];
  if (!audiences.includes(input.expectedClientId)) {
    throw new ChatGptOAuthError("ChatGPT ID token audience mismatch.", {
      code: "invalid_id_token",
    });
  }

  if (input.expectedNonce && claims.nonce !== input.expectedNonce) {
    throw new ChatGptOAuthError("ChatGPT ID token nonce mismatch.", { code: "invalid_id_token" });
  }

  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000);
  if (typeof claims.exp === "number" && claims.exp + JWT_CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new ChatGptOAuthError("ChatGPT ID token has expired.", { code: "token_expired" });
  }

  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (!subject) {
    throw new ChatGptOAuthError("ChatGPT ID token is missing a subject claim.", {
      code: "invalid_id_token",
    });
  }

  const email =
    typeof claims.email === "string" && claims.email.trim() ? claims.email.trim() : undefined;
  const emailVerified =
    typeof claims.email_verified === "boolean" ? claims.email_verified : undefined;
  const name =
    typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : undefined;
  const authClaim =
    claims["https://api.openai.com/auth"] &&
    typeof claims["https://api.openai.com/auth"] === "object"
      ? (claims["https://api.openai.com/auth"] as Record<string, unknown>)
      : undefined;
  const workspaceId =
    (typeof authClaim?.chatgpt_account_id === "string" && authClaim.chatgpt_account_id.trim()) ||
    (typeof claims.chatgpt_account_id === "string" && claims.chatgpt_account_id.trim()) ||
    undefined;

  return {
    subject,
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(name ? { name } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}
