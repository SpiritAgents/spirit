import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createVercelCredentialManager,
  InvalidVercelCredentialsError,
  VERCEL_CREDENTIAL_SLOT,
} from "./credentials.js";
import { VercelOAuthError } from "./oauth.js";

const NOW = 1_800_000_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function secretsFixture(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(VERCEL_CREDENTIAL_SLOT, JSON.stringify(initial));
  // Serializes updates like the host's cross-process Secret lock.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    values,
    secrets: {
      async get(key: string) {
        return values.get(key);
      },
      async set(key: string, value: string) {
        values.set(key, value);
      },
      update(
        key: string,
        updater: (current: string | undefined) => string | undefined | Promise<string | undefined>,
      ) {
        const run = tail.then(async () => {
          const next = await updater(values.get(key));
          if (next === undefined) values.delete(key);
          else values.set(key, next);
          return next;
        });
        tail = run.catch(() => undefined);
        return run;
      },
      async delete(key: string) {
        values.delete(key);
      },
    },
  };
}

const stored = (accessTokenExpiresAt: number) => ({
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  accessTokenExpiresAt,
  username: "fixture-account",
});

const idToken = (claims: Record<string, unknown>) =>
  ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

const noNetwork: typeof fetch = async () => assert.fail("no token request was expected");

test("a fresh access token is returned without a token request", async () => {
  const { secrets } = secretsFixture(stored(NOW + 3_600_000));
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  assert.equal((await manager.read())?.accessToken, "stored-access");
});

test("a due access token rotates the refresh token and keeps the account label", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  let body: URLSearchParams | undefined;
  const manager = createVercelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async (_input, init) => {
      body = init?.body as URLSearchParams;
      return json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 3600 });
    },
  });
  assert.deepEqual(await manager.read(), {
    accessToken: "next-access",
    refreshToken: "next-refresh",
    accessTokenExpiresAt: NOW + 3_600_000,
    username: "fixture-account",
  });
  assert.equal(body?.get("grant_type"), "refresh_token");
  assert.equal(body?.get("refresh_token"), "stored-refresh");
  assert.equal(JSON.parse(values.get(VERCEL_CREDENTIAL_SLOT)!).refreshToken, "next-refresh");
});

test("a credential already rotated by a peer is kept without spending its refresh token", async () => {
  const { secrets } = secretsFixture(stored(NOW + 60_000));
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const original = secrets.update.bind(secrets);
  secrets.update = (key, updater) =>
    original(key, async () =>
      updater(JSON.stringify({ ...stored(NOW + 3_600_000), accessToken: "peer-access" })),
    );
  assert.equal((await manager.read())?.accessToken, "peer-access");
});

test("a retired refresh grant deletes the credential", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  const manager = createVercelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({ error: "invalid_grant" }, 400),
  });
  await assert.rejects(
    manager.read(),
    (error) => error instanceof VercelOAuthError && error.status === 401,
  );
  assert.equal(values.size, 0);
});

test("a transient refresh failure keeps the stored credential", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  const manager = createVercelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({}, 503),
  });
  assert.equal((await manager.read())?.accessToken, "stored-access");
  await assert.rejects(
    manager.read({ allowValidTokenOnRefreshFailure: false }),
    (error) => error instanceof VercelOAuthError && error.status === 503,
  );
  assert.equal(JSON.parse(values.get(VERCEL_CREDENTIAL_SLOT)!).refreshToken, "stored-refresh");
});

test("clearing during a refresh returns the rotated credential that is still valid at Vercel", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  let requested!: () => void;
  let release!: (response: Response) => void;
  const tokenRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const manager = createVercelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: () => {
      requested();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
  });
  const refreshing = manager.read();
  await tokenRequested;
  const clearing = manager.clear();
  release(json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 3600 }));
  await refreshing;
  assert.deepEqual(await clearing, {
    accessToken: "next-access",
    refreshToken: "next-refresh",
    accessTokenExpiresAt: NOW + 3_600_000,
    username: "fixture-account",
  });
  assert.equal(values.size, 0);
});

test("unreadable credentials are reported instead of being silently replaced", async () => {
  const { secrets, values } = secretsFixture();
  values.set(VERCEL_CREDENTIAL_SLOT, "not json");
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  await assert.rejects(manager.read(), InvalidVercelCredentialsError);
  assert.equal(await manager.clear(), undefined);
  assert.equal(values.size, 0);
});

test("authorization stores the ID token username but not the ID token", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const token = idToken({
    iss: "https://vercel.com",
    aud: "https://spirit.dev/oauth/client-metadata.json",
    preferred_username: "fixture-account",
  });
  await manager.store({
    access_token: "access",
    refresh_token: "refresh",
    id_token: token,
    expires_in: 3600,
  });
  assert.deepEqual(JSON.parse(values.get(VERCEL_CREDENTIAL_SLOT)!), {
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: NOW + 3_600_000,
    username: "fixture-account",
  });
});

test("credentials without a refresh token are not stored", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  await assert.rejects(
    manager.store({ access_token: "access", expires_in: 3600 }),
    /did not return refreshable credentials/,
  );
  assert.equal(values.size, 0);
});

test("a missing or untrusted ID token only drops the account label", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createVercelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  for (const id_token of [
    undefined,
    idToken({ iss: "https://vercel.com", aud: "other-client", preferred_username: "spoofed" }),
  ]) {
    await manager.store({
      access_token: "access",
      refresh_token: "refresh",
      id_token,
      expires_in: 3600,
    });
    assert.deepEqual(JSON.parse(values.get(VERCEL_CREDENTIAL_SLOT)!), {
      accessToken: "access",
      refreshToken: "refresh",
      accessTokenExpiresAt: NOW + 3_600_000,
    });
  }
});
