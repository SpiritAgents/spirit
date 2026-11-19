import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import {
  createVercelAuthorizationRequest,
  exchangeVercelAuthorizationCode,
  listenForVercelAuthorizationCode,
  refreshVercelAccessToken,
  vercelAuthorizationUrl,
  VercelOAuthError,
  vercelUsernameFromIdToken,
} from "./oauth.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("the authorization URL identifies Spirit by its metadata URL and binds PKCE and the MCP resource", () => {
  const request = createVercelAuthorizationRequest();
  assert.equal(
    request.codeChallenge,
    createHash("sha256").update(request.codeVerifier).digest("base64url"),
  );
  const url = new URL(
    vercelAuthorizationUrl({
      redirectUri: "http://127.0.0.1:43210/callback",
      state: request.state,
      codeChallenge: request.codeChallenge,
    }),
  );
  assert.equal(url.origin + url.pathname, "https://vercel.com/oauth/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code",
    client_id: "https://spirit.dev/oauth/client-metadata.json",
    redirect_uri: "http://127.0.0.1:43210/callback",
    scope: "openid profile offline_access",
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    resource: "https://mcp.vercel.com/",
  });
});

test("the loopback listener only settles on the response carrying the pending state", async () => {
  const controller = new AbortController();
  const callback = await listenForVercelAuthorizationCode({
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

  const accepted = await fetch(`${callback.redirectUri}?state=pending-state&code=real-code`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await callback.code, "real-code");
  await assert.rejects(fetch(callback.redirectUri));
});

test("a denied authorization rejects with a readable error and closes the listener", async () => {
  const callback = await listenForVercelAuthorizationCode({
    state: "pending-state",
    signal: new AbortController().signal,
  });
  const settled = assert.rejects(callback.code, /Vercel authorization was denied\./);
  const response = await fetch(`${callback.redirectUri}?state=pending-state&error=access_denied`);
  assert.equal(response.status, 400);
  await settled;
  await assert.rejects(fetch(callback.redirectUri));
});

test("cancelling the authorization releases the loopback port", async () => {
  const controller = new AbortController();
  const callback = await listenForVercelAuthorizationCode({
    state: "pending-state",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(callback.code, /cancelled/);
  await assert.rejects(fetch(callback.redirectUri));
});

test("the code exchange sends the verifier, redirect URI, client metadata URL, and resource", async () => {
  let body: URLSearchParams | undefined;
  const token = await exchangeVercelAuthorizationCode({
    fetch: async (input, init) => {
      assert.equal(String(input), "https://api.vercel.com/login/oauth/token");
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
    resource: "https://mcp.vercel.com/",
    grant_type: "authorization_code",
    code: "code",
    redirect_uri: "http://127.0.0.1:43210/callback",
    code_verifier: "verifier",
  });
});

test("token errors distinguish retired grants, outages, and unreachable Vercel", async () => {
  const refresh = (fetchImpl: typeof fetch) =>
    refreshVercelAccessToken({ fetch: fetchImpl, refreshToken: "refresh" });
  await assert.rejects(
    refresh(async () => json({ error: "invalid_grant" }, 400)),
    (error) => error instanceof VercelOAuthError && error.status === 401,
  );
  await assert.rejects(
    refresh(async () => json({}, 503)),
    (error) => error instanceof VercelOAuthError && error.status === 503,
  );
  await assert.rejects(
    refresh(async () => {
      throw new TypeError("fetch failed");
    }),
    (error) =>
      error instanceof VercelOAuthError &&
      error.status === undefined &&
      /Could not reach Vercel/.test(error.message),
  );
});

const idToken = (claims: Record<string, unknown>) =>
  ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

test("the account label comes from an ID token issued by Vercel for this client", () => {
  const claims = {
    iss: "https://vercel.com",
    aud: "https://spirit.dev/oauth/client-metadata.json",
    preferred_username: "fixture-account",
  };
  assert.equal(vercelUsernameFromIdToken(idToken(claims)), "fixture-account");
  assert.equal(
    vercelUsernameFromIdToken(idToken({ ...claims, aud: [claims.aud, "other"] })),
    "fixture-account",
  );
  assert.equal(vercelUsernameFromIdToken(idToken({ ...claims, aud: "other-client" })), undefined);
  assert.equal(
    vercelUsernameFromIdToken(idToken({ ...claims, iss: "https://example.com" })),
    undefined,
  );
  assert.equal(
    vercelUsernameFromIdToken(idToken({ ...claims, preferred_username: " " })),
    undefined,
  );
  assert.equal(vercelUsernameFromIdToken("not-a-jwt"), undefined);
  assert.equal(vercelUsernameFromIdToken(undefined), undefined);
});
