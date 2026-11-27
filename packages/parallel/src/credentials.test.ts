import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createParallelCredentialManager,
  InvalidParallelCredentialsError,
  PARALLEL_CREDENTIAL_SLOT,
  parallelAccessTokenNeedsRefresh,
  parallelCredentialsFromTokenResponse,
  parallelRefreshLeadMs,
} from "./credentials.js";
import { ParallelOAuthError } from "./oauth.js";

const NOW = 1_800_000_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function secretsFixture(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PARALLEL_CREDENTIAL_SLOT, JSON.stringify(initial));
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

const stored = (accessTokenExpiresAt: number, accessTokenRefreshAt: number) => ({
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  accessTokenExpiresAt,
  accessTokenRefreshAt,
});

const noNetwork: typeof fetch = async () => assert.fail("no token request was expected");

test("a freshly issued 10-minute access token schedules refresh at minute 8 and does not immediately refresh", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createParallelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const creds = await manager.store({
    access_token: "access-600s",
    refresh_token: "refresh-1",
    expires_in: 600,
  });
  assert.deepEqual(creds, {
    accessToken: "access-600s",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: NOW + 600_000,
    accessTokenRefreshAt: NOW + 480_000,
  });
  assert.deepEqual(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!), creds);
  assert.equal(parallelAccessTokenNeedsRefresh(creds, NOW), false);
  assert.equal(parallelAccessTokenNeedsRefresh(creds, NOW + 479_999), false);
  assert.equal(parallelAccessTokenNeedsRefresh(creds, NOW + 480_000), true);
  // Reading right after store must return the token without making a network request.
  assert.equal((await manager.read())?.accessToken, "access-600s");
});

test("proportional refresh lead scales for short TTLs and caps at 2 minutes for long TTLs", () => {
  assert.equal(parallelRefreshLeadMs(60_000), 12_000);
  assert.equal(parallelRefreshLeadMs(600_000), 120_000);
  assert.equal(parallelRefreshLeadMs(3_600_000), 120_000);

  const shortToken = parallelCredentialsFromTokenResponse(
    { access_token: "a", refresh_token: "r", expires_in: 60 },
    NOW,
  );
  assert.equal(shortToken.accessTokenExpiresAt, NOW + 60_000);
  assert.equal(shortToken.accessTokenRefreshAt, NOW + 48_000);

  const longToken = parallelCredentialsFromTokenResponse(
    { access_token: "a", refresh_token: "r", expires_in: 3600 },
    NOW,
  );
  assert.equal(longToken.accessTokenExpiresAt, NOW + 3_600_000);
  assert.equal(longToken.accessTokenRefreshAt, NOW + 3_480_000);
});

test("a due access token rotates to a new refresh token when returned", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000, NOW));
  let body: URLSearchParams | undefined;
  const manager = createParallelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async (_input, init) => {
      body = init?.body as URLSearchParams;
      return json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 600 });
    },
  });
  assert.deepEqual(await manager.read(), {
    accessToken: "next-access",
    refreshToken: "next-refresh",
    accessTokenExpiresAt: NOW + 600_000,
    accessTokenRefreshAt: NOW + 480_000,
  });
  assert.equal(body?.get("grant_type"), "refresh_token");
  assert.equal(body?.get("refresh_token"), "stored-refresh");
  assert.equal(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!).refreshToken, "next-refresh");
});

test("a refresh response omitting refresh_token retains the stored refresh token", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000, NOW));
  const manager = createParallelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({ access_token: "next-access", expires_in: 600 }),
  });
  assert.deepEqual(await manager.read(), {
    accessToken: "next-access",
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: NOW + 600_000,
    accessTokenRefreshAt: NOW + 480_000,
  });
  assert.equal(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!).refreshToken, "stored-refresh");
});

test("a credential already refreshed by a peer is kept without spending its refresh token", async () => {
  const { secrets } = secretsFixture(stored(NOW + 60_000, NOW));
  const manager = createParallelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const original = secrets.update.bind(secrets);
  secrets.update = (key, updater) =>
    original(key, async () =>
      updater(
        JSON.stringify({
          ...stored(NOW + 600_000, NOW + 480_000),
          accessToken: "peer-access",
        }),
      ),
    );
  assert.equal((await manager.read())?.accessToken, "peer-access");
});

test("a retired refresh grant (HTTP 401 or HTTP 400 invalid_grant) deletes the credential", async () => {
  for (const response of [
    () => json({ error: "invalid_grant" }, 400),
    () => new Response(null, { status: 401 }),
  ]) {
    const { secrets, values } = secretsFixture(stored(NOW + 60_000, NOW));
    const manager = createParallelCredentialManager({
      secrets,
      now: () => NOW,
      fetch: async () => response(),
    });
    await assert.rejects(
      manager.read(),
      (error) => error instanceof ParallelOAuthError && error.status === 401,
    );
    assert.equal(values.size, 0);
  }
});

test("a transient refresh failure keeps a still-valid access token", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000, NOW));
  const manager = createParallelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({}, 503),
  });
  assert.equal((await manager.read())?.accessToken, "stored-access");
  await assert.rejects(
    manager.read({ allowValidTokenOnRefreshFailure: false }),
    (error) => error instanceof ParallelOAuthError && error.status === 503,
  );
  assert.deepEqual(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!), stored(NOW + 60_000, NOW));
});

test("a non-401 refresh failure strips an expired access token while keeping refreshToken for retry and revocation", async () => {
  const { secrets, values } = secretsFixture(stored(NOW - 1_000, NOW - 121_000));
  let online = false;
  const manager = createParallelCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () =>
      online
        ? json({
            access_token: "recovered-access",
            refresh_token: "recovered-refresh",
            expires_in: 600,
          })
        : json({}, 503),
  });

  await assert.rejects(
    manager.read(),
    (error) => error instanceof ParallelOAuthError && error.status === 503,
  );
  // Dead accessToken is removed so the optional MCP Bearer header falls back to keyless,
  // while refreshToken remains available for retries and disconnect revocation.
  assert.deepEqual(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!), {
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: NOW - 1_000,
    accessTokenRefreshAt: NOW - 121_000,
  });

  // Once Parallel recovers, the retained refreshToken restores OAuth access automatically.
  online = true;
  assert.deepEqual(await manager.read(), {
    accessToken: "recovered-access",
    refreshToken: "recovered-refresh",
    accessTokenExpiresAt: NOW + 600_000,
    accessTokenRefreshAt: NOW + 480_000,
  });
});

test("clear still returns refreshToken after an expired access token has been stripped", async () => {
  const { secrets, values } = secretsFixture({
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: NOW - 1_000,
    accessTokenRefreshAt: NOW - 121_000,
  });
  const manager = createParallelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  assert.deepEqual(await manager.clear(), {
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: NOW - 1_000,
    accessTokenRefreshAt: NOW - 121_000,
  });
  assert.equal(values.size, 0);
});

test("clearing during a refresh returns the refreshed credential still valid at Parallel", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000, NOW));
  let requested!: () => void;
  let release!: (response: Response) => void;
  const tokenRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const manager = createParallelCredentialManager({
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
  release(json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 600 }));
  await refreshing;
  assert.deepEqual(await clearing, {
    accessToken: "next-access",
    refreshToken: "next-refresh",
    accessTokenExpiresAt: NOW + 600_000,
    accessTokenRefreshAt: NOW + 480_000,
  });
  assert.equal(values.size, 0);
});

test("unreadable or inconsistent credentials are reported instead of being silently replaced", async () => {
  for (const bad of [
    "not json",
    JSON.stringify({
      accessToken: "a",
      refreshToken: "r",
      accessTokenExpiresAt: NOW + 1000,
      accessTokenRefreshAt: NOW + 2000,
    }),
  ]) {
    const { secrets, values } = secretsFixture();
    values.set(PARALLEL_CREDENTIAL_SLOT, bad);
    const manager = createParallelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
    await assert.rejects(manager.read(), InvalidParallelCredentialsError);
    assert.equal(await manager.clear(), undefined);
    assert.equal(values.size, 0);
  }
});

test("credentials without a refresh token are not stored on initial authorization", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createParallelCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  await assert.rejects(
    manager.store({ access_token: "access", expires_in: 600 }),
    /did not return refreshable credentials/,
  );
  assert.equal(values.size, 0);
});
