import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createExaCredentialManager,
  EXA_CREDENTIAL_SLOT,
  EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  exaAccessTokenNeedsRefresh,
  exaRefreshLeadMs,
  InvalidExaCredentialsError,
} from "./credentials.js";
import { ExaOAuthError } from "./oauth.js";

const NOW = 1_800_000_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function secretsFixture(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(EXA_CREDENTIAL_SLOT, JSON.stringify(initial));
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

const stored = (accessTokenExpiresAt: number, refreshLeadMs?: number) => ({
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  accessTokenExpiresAt,
  ...(refreshLeadMs === undefined ? {} : { refreshLeadMs }),
});

const noNetwork: typeof fetch = async () => assert.fail("no token request was expected");

test("bounded refresh lead scales for short-lived tokens and caps at ten minutes", () => {
  assert.equal(exaRefreshLeadMs(3600), EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS);
  assert.equal(exaRefreshLeadMs(300), 60_000);
  assert.equal(exaRefreshLeadMs(60), 12_000);
  assert.equal(exaRefreshLeadMs(4), 1_000);
  assert.equal(exaRefreshLeadMs(1), 500);
});

test("a short-lived token is not immediately considered due for refresh", async () => {
  const { secrets } = secretsFixture();
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const saved = await manager.store({
    access_token: "short-access",
    refresh_token: "short-refresh",
    expires_in: 300,
  });
  assert.equal(saved.refreshLeadMs, 60_000);
  assert.equal(exaAccessTokenNeedsRefresh(saved, NOW), false);
  assert.equal(exaAccessTokenNeedsRefresh(saved, NOW + 239_999), false);
  assert.equal(exaAccessTokenNeedsRefresh(saved, NOW + 240_000), true);
  assert.equal((await manager.read())?.accessToken, "short-access");
});

test("a fresh access token is returned without a token request", async () => {
  const { secrets } = secretsFixture(stored(NOW + 3_600_000));
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  assert.equal((await manager.read())?.accessToken, "stored-access");
});

test("a due access token rotates to a new refresh token when returned", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  let body: URLSearchParams | undefined;
  const manager = createExaCredentialManager({
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
    refreshLeadMs: EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  });
  assert.equal(body?.get("grant_type"), "refresh_token");
  assert.equal(body?.get("refresh_token"), "stored-refresh");
  assert.equal(JSON.parse(values.get(EXA_CREDENTIAL_SLOT)!).refreshToken, "next-refresh");
});

test("a refresh response omitting refresh_token retains the stored refresh token", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  const manager = createExaCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({ access_token: "next-access", expires_in: 3600 }),
  });
  assert.deepEqual(await manager.read(), {
    accessToken: "next-access",
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: NOW + 3_600_000,
    refreshLeadMs: EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  });
  assert.equal(JSON.parse(values.get(EXA_CREDENTIAL_SLOT)!).refreshToken, "stored-refresh");
});

test("a credential already refreshed by a peer is kept without spending its refresh token", async () => {
  const { secrets } = secretsFixture(stored(NOW + 60_000));
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  const original = secrets.update.bind(secrets);
  secrets.update = (key, updater) =>
    original(key, async () =>
      updater(JSON.stringify({ ...stored(NOW + 3_600_000), accessToken: "peer-access" })),
    );
  assert.equal((await manager.read())?.accessToken, "peer-access");
});

test("a retired refresh grant (HTTP 401 or HTTP 400 invalid_grant) deletes the credential", async () => {
  for (const response of [
    () => json({ error: "invalid_grant" }, 400),
    () => new Response(null, { status: 401 }),
  ]) {
    const { secrets, values } = secretsFixture(stored(NOW + 60_000));
    const manager = createExaCredentialManager({
      secrets,
      now: () => NOW,
      fetch: async () => response(),
    });
    await assert.rejects(
      manager.read(),
      (error) => error instanceof ExaOAuthError && error.status === 401,
    );
    assert.equal(values.size, 0);
  }
});

test("a transient refresh failure keeps the stored credential", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  const manager = createExaCredentialManager({
    secrets,
    now: () => NOW,
    fetch: async () => json({}, 503),
  });
  assert.equal((await manager.read())?.accessToken, "stored-access");
  await assert.rejects(
    manager.read({ allowValidTokenOnRefreshFailure: false }),
    (error) => error instanceof ExaOAuthError && error.status === 503,
  );
  assert.equal(JSON.parse(values.get(EXA_CREDENTIAL_SLOT)!).refreshToken, "stored-refresh");
});

test("clearing during a refresh returns the refreshed credential still valid at Exa", async () => {
  const { secrets, values } = secretsFixture(stored(NOW + 60_000));
  let requested!: () => void;
  let release!: (response: Response) => void;
  const tokenRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const manager = createExaCredentialManager({
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
    refreshLeadMs: EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  });
  assert.equal(values.size, 0);
});

test("unreadable credentials are reported instead of being silently replaced", async () => {
  const { secrets, values } = secretsFixture();
  values.set(EXA_CREDENTIAL_SLOT, "not json");
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  await assert.rejects(manager.read(), InvalidExaCredentialsError);
  assert.equal(await manager.clear(), undefined);
  assert.equal(values.size, 0);
});

test("initial authorization stores accessToken, refreshToken, accessTokenExpiresAt, and refreshLeadMs", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  await manager.store({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 3600,
  });
  assert.deepEqual(JSON.parse(values.get(EXA_CREDENTIAL_SLOT)!), {
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: NOW + 3_600_000,
    refreshLeadMs: EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  });
});

test("credentials without a refresh token or positive finite expires_in are not stored", async () => {
  const { secrets, values } = secretsFixture();
  const manager = createExaCredentialManager({ secrets, fetch: noNetwork, now: () => NOW });
  for (const invalid of [
    { access_token: "access", expires_in: 3600 },
    { access_token: "access", refresh_token: "refresh", expires_in: 0 },
    { access_token: "access", refresh_token: "refresh", expires_in: -60 },
    { access_token: "access", refresh_token: "refresh", expires_in: Number.NaN },
  ]) {
    await assert.rejects(manager.store(invalid), /did not return refreshable credentials/);
  }
  assert.equal(values.size, 0);
});
