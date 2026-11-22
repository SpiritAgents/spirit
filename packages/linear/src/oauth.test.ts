import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import { LINEAR_OAUTH_ISSUER } from "./oauth-config.js";
import {
  createLinearAuthorizationRequest,
  exchangeLinearAuthorizationCode,
  linearAuthorizationUrl,
  LinearOAuthError,
  listenForLinearAuthorizationCode,
  refreshLinearAccessToken,
  revokeLinearToken,
} from "./oauth.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const encodedIssuer = encodeURIComponent(LINEAR_OAUTH_ISSUER);

test("the authorization URL identifies Spirit by its metadata URL and binds PKCE and the MCP resource", () => {
  const request = createLinearAuthorizationRequest();
  assert.equal(
    request.codeChallenge,
    createHash("sha256").update(request.codeVerifier).digest("base64url"),
  );
  const url = new URL(
    linearAuthorizationUrl({
      redirectUri: "http://127.0.0.1:43210/callback",
      state: request.state,
      codeChallenge: request.codeChallenge,
    }),
  );
  assert.equal(url.origin + url.pathname, "https://mcp.linear.app/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code",
    client_id: "https://spirit.dev/oauth/client-metadata.json",
    redirect_uri: "http://127.0.0.1:43210/callback",
    scope: "read write",
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    resource: "https://mcp.linear.app/mcp",
  });
});

test("the loopback listener only settles on the pending state with Linear's advertised issuer", async () => {
  const controller = new AbortController();
  const callback = await listenForLinearAuthorizationCode({
    state: "pending-state",
    signal: controller.signal,
  });
  const redirect = new URL(callback.redirectUri);
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/callback");
  assert.ok(Number(redirect.port) > 0);

  assert.equal((await fetch(new URL("/favicon.ico", redirect))).status, 404);
  const forged = await fetch(`${callback.redirectUri}?state=other&code=forged`);
  assert.equal(forged.status, 400);
  assert.match(await forged.text(), /does not match/);

  const accepted = await fetch(
    `${callback.redirectUri}?state=pending-state&iss=${encodedIssuer}&code=real-code`,
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await callback.code, "real-code");
  await assert.rejects(fetch(callback.redirectUri));
});

test("missing or mismatched RFC 9207 iss on the pending state rejects with HTTP 400 and fails the flow", async () => {
  for (const query of [
    "state=pending-state&code=real-code",
    `state=pending-state&iss=${encodeURIComponent("https://example.com")}&code=real-code`,
  ]) {
    const callback = await listenForLinearAuthorizationCode({
      state: "pending-state",
      signal: new AbortController().signal,
    });
    const settled = assert.rejects(
      callback.code,
      /Linear authorization returned an unexpected issuer\./,
    );
    const response = await fetch(`${callback.redirectUri}?${query}`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /unexpected issuer/);
    await settled;
    await assert.rejects(fetch(callback.redirectUri));
  }
});

test("a denied authorization rejects with a readable error and closes the listener", async () => {
  const callback = await listenForLinearAuthorizationCode({
    state: "pending-state",
    signal: new AbortController().signal,
  });
  const settled = assert.rejects(callback.code, /Linear authorization was denied\./);
  const response = await fetch(
    `${callback.redirectUri}?state=pending-state&iss=${encodedIssuer}&error=access_denied`,
  );
  assert.equal(response.status, 400);
  await settled;
  await assert.rejects(fetch(callback.redirectUri));
});

test("cancelling the authorization releases the loopback port", async () => {
  const controller = new AbortController();
  const callback = await listenForLinearAuthorizationCode({
    state: "pending-state",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(callback.code, /cancelled/);
  await assert.rejects(fetch(callback.redirectUri));
});

test("the code exchange sends the verifier, redirect URI, client metadata URL, and resource", async () => {
  let body: URLSearchParams | undefined;
  const token = await exchangeLinearAuthorizationCode({
    fetch: async (input, init) => {
      assert.equal(String(input), "https://mcp.linear.app/token");
      body = init?.body as URLSearchParams;
      return json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    },
    code: "code",
    redirectUri: "http://127.0.0.1:43210/callback",
    codeVerifier: "verifier",
  });
  assert.equal(token.access_token, "access");
  assert.deepEqual(Object.fromEntries(body!), {
    client_id: "https://spirit.dev/oauth/client-metadata.json",
    resource: "https://mcp.linear.app/mcp",
    grant_type: "authorization_code",
    code: "code",
    redirect_uri: "http://127.0.0.1:43210/callback",
    code_verifier: "verifier",
  });
});

test("token errors distinguish retired grants, client errors, outages, and unreachable Linear", async () => {
  const refresh = (fetchImpl: typeof fetch) =>
    refreshLinearAccessToken({ fetch: fetchImpl, refreshToken: "refresh" });
  await assert.rejects(
    refresh(async () => json({ error: "invalid_grant" }, 400)),
    (error) => error instanceof LinearOAuthError && error.status === 401,
  );
  await assert.rejects(
    refresh(async () => new Response(null, { status: 401 })),
    (error) => error instanceof LinearOAuthError && error.status === 401,
  );
  await assert.rejects(
    refresh(async () => json({ error: "invalid_request" }, 400)),
    (error) => error instanceof LinearOAuthError && error.status === 400,
  );
  await assert.rejects(
    refresh(async () => json({}, 503)),
    (error) => error instanceof LinearOAuthError && error.status === 503,
  );
  await assert.rejects(
    refresh(async () => {
      throw new TypeError("fetch failed");
    }),
    (error) =>
      error instanceof LinearOAuthError &&
      error.status === undefined &&
      /Could not reach Linear/.test(error.message),
  );
});

test("token revocation posts to Linear's token endpoint with client_id and token_type_hint", async () => {
  let body: URLSearchParams | undefined;
  await revokeLinearToken({
    fetch: async (input, init) => {
      assert.equal(String(input), "https://mcp.linear.app/token");
      body = init?.body as URLSearchParams;
      return new Response(null, { status: 200 });
    },
    token: "stored-refresh",
    hint: "refresh_token",
  });
  assert.deepEqual(Object.fromEntries(body!), {
    client_id: "https://spirit.dev/oauth/client-metadata.json",
    token: "stored-refresh",
    token_type_hint: "refresh_token",
  });
});
