import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import { setKeyringStoreForTests, type KeyringStore } from "../credentials/keyring-store.js";
import { hasResolvableCredentials } from "../credentials/credentials.js";
import { tryResolveTransportConfig } from "../resolve-transport.js";
import { saveSpiritConfig } from "../credentials/spirit-config.js";
import {
  buildChatGptAuthorizationUrl,
  CHATGPT_OAUTH_AGENT_NAME_HINT,
  CHATGPT_OAUTH_DYNAMIC_CLIENT_ID,
  CHATGPT_OAUTH_SCOPES,
  ChatGptOAuthError,
  clearChatGptOAuthCredentials,
  createChatGptAuthorizationRequest,
  createChatGptOAuthCredentialManager,
  generateChatGptExtAgentHostId,
  getOrCreateChatGptExtAgentHostId,
  hasChatGptPlanUsageScope,
  listenForChatGptAuthorizationCallback,
  readStoredChatGptOAuthCredentials,
  storeChatGptOAuthCredentials,
  storeChatGptOAuthCredentialsLocked,
  verifyChatGptIdToken,
  type ChatGptOAuthCredentials,
} from "./index.js";

function createMemoryKeyring(): KeyringStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getPassword(service, account) {
      return data.get(`${service}::${account}`);
    },
    setPassword(service, account, password) {
      data.set(`${service}::${account}`, password);
    },
    deletePassword(service, account) {
      data.delete(`${service}::${account}`);
    },
  };
}

function createSignedRs256Jwt(
  claims: Record<string, unknown>,
  privateKey: KeyObject,
  kid = "test-key-1",
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), privateKey).toString(
    "base64url",
  );
  return `${signingInput}.${signature}`;
}

const tempDirs: string[] = [];

afterEach(() => {
  setKeyringStoreForTests(undefined);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("ext_agent_host_id uses RFC 9278 JWK thumbprint format and persists stably", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-chatgpt-host-id-"));
  tempDirs.push(dir);

  const generated = generateChatGptExtAgentHostId();
  assert.match(generated, /^urn:ietf:params:oauth:jwk-thumbprint:sha-256:[A-Za-z0-9_-]{43}$/);

  const first = await getOrCreateChatGptExtAgentHostId(dir);
  const second = await getOrCreateChatGptExtAgentHostId(dir);
  assert.equal(first, second);
  assert.match(first, /^urn:ietf:params:oauth:jwk-thumbprint:sha-256:/);
});

test("buildChatGptAuthorizationUrl uses dynamic_agent_client and Spirit hint for first registration", () => {
  const req = createChatGptAuthorizationRequest();
  const href = buildChatGptAuthorizationUrl({
    redirectUri: "http://127.0.0.1:43210/auth/callback",
    state: req.state,
    nonce: req.nonce,
    codeChallenge: req.codeChallenge,
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:test",
  });
  const url = new URL(href);
  assert.equal(url.searchParams.get("client_id"), CHATGPT_OAUTH_DYNAMIC_CLIENT_ID);
  assert.equal(url.searchParams.get("agent_name_hint"), CHATGPT_OAUTH_AGENT_NAME_HINT);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("resource"), "https://api.openai.com/v1");
  assert.equal(url.searchParams.get("scope"), CHATGPT_OAUTH_SCOPES.join(" "));

  const reauthHref = buildChatGptAuthorizationUrl({
    redirectUri: "http://127.0.0.1:43211/auth/callback",
    state: req.state,
    nonce: req.nonce,
    codeChallenge: req.codeChallenge,
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:test",
    clientId: "oaiapp_issued_123",
    idTokenHint: "id-tok-prev",
  });
  const reauthUrl = new URL(reauthHref);
  assert.equal(reauthUrl.searchParams.get("client_id"), "oaiapp_issued_123");
  assert.equal(reauthUrl.searchParams.get("id_token_hint"), "id-tok-prev");
});

test("listenForChatGptAuthorizationCallback validates state and issued client_id on loopback", async () => {
  const controller = new AbortController();
  const callback = await listenForChatGptAuthorizationCallback({
    state: "state-abc",
    signal: controller.signal,
  });

  // Wrong state is rejected with 400 without terminating the listener.
  const wrongStateRes = await fetch(`${callback.redirectUri}?code=bad&state=wrong&client_id=x`);
  assert.equal(wrongStateRes.status, 400);

  // Valid state + issued client_id settles the callback.
  const okRes = await fetch(
    `${callback.redirectUri}?code=code-123&state=state-abc&client_id=oaiapp_456&scope=openid+chatgpt.tokens.use.direct`,
  );
  assert.equal(okRes.status, 200);
  const settled = await callback.result;
  assert.equal(settled.code, "code-123");
  assert.equal(settled.clientId, "oaiapp_456");
  assert.equal(hasChatGptPlanUsageScope(settled.scope), true);
});

test("listenForChatGptAuthorizationCallback rejects mismatched client_id on reauthorization", async () => {
  const controller = new AbortController();
  const callback = await listenForChatGptAuthorizationCallback({
    state: "state-reauth",
    expectedClientId: "oaiapp_original",
    signal: controller.signal,
  });

  const rejection = assert.rejects(
    callback.result,
    (error: unknown) => error instanceof ChatGptOAuthError && error.code === "invalid_client",
  );
  const res = await fetch(
    `${callback.redirectUri}?code=code-123&state=state-reauth&client_id=oaiapp_different`,
  );
  assert.equal(res.status, 400);
  await rejection;
});

test("verifyChatGptIdToken validates RS256 signature, issuer, audience, and nonce", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", use: "sig" };
  const nowSec = Math.floor(Date.now() / 1000);
  const idToken = createSignedRs256Jwt(
    {
      iss: "https://auth.example.test",
      aud: "oaiapp_issued_1",
      sub: "user_42",
      email: "user@example.test",
      email_verified: true,
      nonce: "nonce-xyz",
      exp: nowSec + 3600,
    },
    privateKey,
    "k1",
  );

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const claims = await verifyChatGptIdToken({
    idToken,
    expectedClientId: "oaiapp_issued_1",
    expectedNonce: "nonce-xyz",
    endpoints: {
      issuer: "https://auth.example.test",
      jwksUrl: "https://auth.example.test/.well-known/jwks.json",
    },
    fetch: mockFetch,
  });
  assert.equal(claims.subject, "user_42");
  assert.equal(claims.email, "user@example.test");

  await assert.rejects(
    verifyChatGptIdToken({
      idToken,
      expectedClientId: "oaiapp_issued_1",
      expectedNonce: "wrong-nonce",
      endpoints: {
        issuer: "https://auth.example.test",
        jwksUrl: "https://auth.example.test/.well-known/jwks.json",
      },
      fetch: mockFetch,
    }),
    /nonce mismatch/,
  );
});

test("credential manager deduplicates concurrent rotating refreshes and clears only on terminal errors", async () => {
  const memoryKeyring = createMemoryKeyring();
  setKeyringStoreForTests(memoryKeyring);

  let currentNow = 1_700_000_000_000;
  const initial: ChatGptOAuthCredentials = {
    clientId: "oaiapp_issued",
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:host",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: currentNow + 60_000, // inside 5m refresh window
    refreshTokenExpiresAt: currentNow + 30 * 24 * 60 * 60 * 1000,
    subject: "user_1",
    scopes: [...CHATGPT_OAUTH_SCOPES],
    savedAt: currentNow - 3_540_000,
  };
  storeChatGptOAuthCredentials("chatgpt", initial);

  let refreshCalls = 0;
  const manager = createChatGptOAuthCredentialManager({
    providerId: "chatgpt",
    now: () => currentNow,
    endpoints: {
      tokenUrl: "https://auth.example.test/token",
      resource: "https://api.openai.com/v1",
    },
    fetch: async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(
        JSON.stringify({
          access_token: `access-${refreshCalls + 1}`,
          refresh_token: `refresh-${refreshCalls + 1}`,
          expires_in: 3600,
          scope: CHATGPT_OAUTH_SCOPES.join(" "),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const [t1, t2] = await Promise.all([manager.getAccessToken(), manager.getAccessToken()]);
  assert.equal(refreshCalls, 1);
  assert.equal(t1, "access-2");
  assert.equal(t2, "access-2");
  assert.equal(readStoredChatGptOAuthCredentials("chatgpt")?.refreshToken, "refresh-2");

  // Transient 503 preserves stored credentials while token is still valid.
  currentNow += 3_400_000;
  const transientManager = createChatGptOAuthCredentialManager({
    providerId: "chatgpt",
    now: () => currentNow,
    endpoints: {
      tokenUrl: "https://auth.example.test/token",
      resource: "https://api.openai.com/v1",
    },
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  const fallbackToken = await transientManager.getAccessToken();
  assert.equal(fallbackToken, "access-2");
  assert.ok(readStoredChatGptOAuthCredentials("chatgpt"));

  // Terminal invalid_grant clears stored credentials.
  const terminalManager = createChatGptOAuthCredentialManager({
    providerId: "chatgpt",
    now: () => currentNow,
    endpoints: {
      tokenUrl: "https://auth.example.test/token",
      resource: "https://api.openai.com/v1",
    },
    fetch: async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(
    terminalManager.getAccessToken(),
    (error: unknown) => error instanceof ChatGptOAuthError && error.code === "invalid_grant",
  );
  assert.equal(readStoredChatGptOAuthCredentials("chatgpt"), undefined);
});

test("hasResolvableCredentials and tryResolveTransportConfig bind chatgpt-oauth providers to Keychain credentials", async () => {
  const memoryKeyring = createMemoryKeyring();
  setKeyringStoreForTests(memoryKeyring);
  const dir = mkdtempSync(join(tmpdir(), "spirit-chatgpt-config-"));
  tempDirs.push(dir);

  await saveSpiritConfig(dir, {
    schemaVersion: 1,
    activeModel: { providerId: "chatgpt", name: "gpt-5.4" },
    providers: [
      {
        id: "chatgpt",
        label: "ChatGPT",
        apiBase: "https://api.openai.com/v1",
        transportKind: "open-responses",
        sdk: "@ai-sdk/openai",
        options: {
          auth: "chatgpt-oauth",
          applyPatch: true,
          reasoningSummary: true,
          statelessStreamingResponses: true,
        },
        models: [{ name: "gpt-5.4" }],
      },
    ],
  });

  assert.equal(hasResolvableCredentials(dir), false);
  assert.equal(tryResolveTransportConfig({ workspaceRoot: dir, spiritDataDir: dir }).ok, false);

  storeChatGptOAuthCredentials("chatgpt", {
    clientId: "oaiapp_1",
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:host",
    accessToken: "access-live",
    refreshToken: "refresh-live",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    subject: "user_1",
    scopes: [...CHATGPT_OAUTH_SCOPES],
    savedAt: Date.now(),
  });

  assert.equal(hasResolvableCredentials(dir), true);
  const resolved = tryResolveTransportConfig({ workspaceRoot: dir, spiritDataDir: dir });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.providerId, "chatgpt");
    assert.equal(resolved.config.transportKind, "open-responses");
    assert.equal(typeof resolved.config.resolveBearerToken, "function");
    assert.equal(typeof resolved.config.refreshBearerTokenAfterUnauthorized, "function");
  }

  clearChatGptOAuthCredentials("chatgpt");
  assert.equal(hasResolvableCredentials(dir), false);
});

test("storeChatGptOAuthCredentialsLocked serializes reconnect writes behind an in-flight refresh", async () => {
  const memoryKeyring = createMemoryKeyring();
  setKeyringStoreForTests(memoryKeyring);

  const now = 1_700_000_000_000;
  storeChatGptOAuthCredentials("chatgpt", {
    clientId: "oaiapp_old",
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:host",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    accessTokenExpiresAt: now + 60_000,
    refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
    subject: "user_1",
    scopes: [...CHATGPT_OAUTH_SCOPES],
    savedAt: now - 3_540_000,
  });

  let releaseRefresh!: () => void;
  const refreshInFlight = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const manager = createChatGptOAuthCredentialManager({
    providerId: "chatgpt",
    now: () => now,
    endpoints: {
      tokenUrl: "https://auth.example.test/token",
      resource: "https://api.openai.com/v1",
    },
    fetch: async () => {
      await refreshInFlight;
      return new Response(
        JSON.stringify({
          access_token: "access-rotated-old",
          refresh_token: "refresh-rotated-old",
          expires_in: 3600,
          scope: CHATGPT_OAUTH_SCOPES.join(" "),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const refreshPromise = manager.getAccessToken();
  const reconnectWrite = storeChatGptOAuthCredentialsLocked("chatgpt", {
    clientId: "oaiapp_new",
    extAgentHostId: "urn:ietf:params:oauth:jwk-thumbprint:sha-256:host",
    accessToken: "access-new-login",
    refreshToken: "refresh-new-login",
    accessTokenExpiresAt: now + 3_600_000,
    refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
    subject: "user_2",
    scopes: [...CHATGPT_OAUTH_SCOPES],
    savedAt: now,
  });

  releaseRefresh();
  await Promise.all([refreshPromise, reconnectWrite]);

  // Locked reconnect write runs after the in-flight refresh finishes, so the new login wins.
  const stored = readStoredChatGptOAuthCredentials("chatgpt");
  assert.equal(stored?.accessToken, "access-new-login");
  assert.equal(stored?.refreshToken, "refresh-new-login");
});
