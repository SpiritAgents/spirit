import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createGitHubCredentialManager,
  GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  GITHUB_CREDENTIAL_SLOT,
  gitHubAccessTokenNeedsRefresh,
  InvalidGitHubCredentialsError,
  type GitHubCredentials,
} from "./credentials.js";
import { withGitHubRequest } from "./github-fetch.js";
import { GitHubOAuthError } from "./oauth.js";
import type { GitHubOAuthTokenResponse } from "./types.js";

const NOW = 1_800_000_000_000;

function tokenResponse(generation = 1): GitHubOAuthTokenResponse {
  return {
    access_token: `fixture-access-${generation}`,
    refresh_token: `fixture-refresh-${generation}`,
    token_type: "bearer",
    expires_in: 8 * 60 * 60,
    refresh_token_expires_in: 180 * 24 * 60 * 60,
  };
}

function storedCredentials(overrides: Partial<GitHubCredentials> = {}): GitHubCredentials {
  return {
    accessToken: "fixture-access-0",
    refreshToken: "fixture-refresh-0",
    accessTokenExpiresAt: NOW + 8 * 60 * 60 * 1000,
    refreshTokenExpiresAt: NOW + 180 * 24 * 60 * 60 * 1000,
    login: "fixture-account",
    ...overrides,
  };
}

function secretsFixture(initial?: unknown) {
  let raw = initial === undefined ? undefined : JSON.stringify(initial);
  let queue = Promise.resolve();
  let active = 0;
  let maxActive = 0;
  return {
    get raw() {
      return raw;
    },
    get maxActive() {
      return maxActive;
    },
    async get(key: string) {
      assert.equal(key, GITHUB_CREDENTIAL_SLOT);
      return raw;
    },
    async set(key: string, value: string) {
      assert.equal(key, GITHUB_CREDENTIAL_SLOT);
      raw = value;
    },
    async update(key: string, updater: (current: string | undefined) => unknown) {
      assert.equal(key, GITHUB_CREDENTIAL_SLOT);
      const run = queue.then(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          const next = (await updater(raw)) as string | undefined;
          if (next !== raw) raw = next;
          return next;
        } finally {
          active -= 1;
        }
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async delete(key: string) {
      assert.equal(key, GITHUB_CREDENTIAL_SLOT);
      raw = undefined;
    },
  };
}

function managerWith(
  secrets: ReturnType<typeof secretsFixture>,
  transport: typeof fetch,
  now = () => NOW,
) {
  const manager = createGitHubCredentialManager({ secrets, clientId: "fixture-client", now });
  return {
    manager,
    run<T>(run: () => T): T {
      return withGitHubRequest({ fetch: transport }, run);
    },
  };
}

test("new authorization persists both tokens and absolute expiry times", async () => {
  const secrets = secretsFixture();
  const { manager } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  await manager.store(tokenResponse(), "fixture-account");
  assert.deepEqual(JSON.parse(secrets.raw!), {
    accessToken: "fixture-access-1",
    refreshToken: "fixture-refresh-1",
    accessTokenExpiresAt: NOW + 8 * 60 * 60 * 1000,
    refreshTokenExpiresAt: NOW + 180 * 24 * 60 * 60 * 1000,
    login: "fixture-account",
  });
});

test("a fresh access token does not reach the network", async () => {
  const secrets = secretsFixture(storedCredentials());
  const { manager, run } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  assert.equal(await run(() => manager.token()), "fixture-access-0");
  assert.equal(
    gitHubAccessTokenNeedsRefresh(
      { accessTokenExpiresAt: NOW + GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS + 1 },
      NOW,
    ),
    false,
  );
});

test("the ten-minute boundary refreshes and rotates the complete credential", async () => {
  const secrets = secretsFixture(
    storedCredentials({ accessTokenExpiresAt: NOW + GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS }),
  );
  let requests = 0;
  const { manager, run } = managerWith(secrets, async (_input, init) => {
    requests += 1;
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("client_id"), "fixture-client");
    assert.equal(body.get("refresh_token"), "fixture-refresh-0");
    return Response.json(tokenResponse());
  });
  assert.equal(await run(() => manager.token()), "fixture-access-1");
  assert.equal(requests, 1);
  assert.deepEqual(
    JSON.parse(secrets.raw!),
    storedCredentials({
      accessToken: "fixture-access-1",
      refreshToken: "fixture-refresh-1",
    }),
  );
});

test("legacy credentials are retired once without a refresh request", async () => {
  const secrets = secretsFixture({ accessToken: "legacy-access", login: "fixture-account" });
  const { manager, run } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  assert.deepEqual(await run(() => manager.status()), { connected: false });
  assert.equal(secrets.raw, undefined);
});

test("malformed credentials remain diagnosable and are not silently discarded", async () => {
  const secrets = secretsFixture();
  await secrets.set(GITHUB_CREDENTIAL_SLOT, "{not-json");
  const { manager } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  await assert.rejects(() => manager.read(), InvalidGitHubCredentialsError);
  assert.equal(secrets.raw, "{not-json");
});

test("concurrent proactive readers consume only one rotating refresh token", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  let requests = 0;
  const { manager, run } = managerWith(secrets, async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json(tokenResponse());
  });
  const tokens = await run(() => Promise.all(Array.from({ length: 12 }, () => manager.token())));
  assert.deepEqual(
    tokens,
    Array.from({ length: 12 }, () => "fixture-access-1"),
  );
  assert.equal(requests, 1);
  assert.equal(secrets.maxActive, 1);
});

test("concurrent rejected readers reuse the credential rotated by the first", async () => {
  const secrets = secretsFixture(storedCredentials());
  let requests = 0;
  const { manager, run } = managerWith(secrets, async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json(tokenResponse());
  });
  const tokens = await run(() =>
    Promise.all(Array.from({ length: 12 }, () => manager.refreshAfterRejected("fixture-access-0"))),
  );
  assert.deepEqual(
    tokens,
    Array.from({ length: 12 }, () => "fixture-access-1"),
  );
  assert.equal(requests, 1);
});

test("a rejected refresh grant clears authorization", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  const { manager, run } = managerWith(secrets, async () =>
    Response.json({ error: "invalid_grant" }, { status: 400 }),
  );
  await assert.rejects(
    () => run(() => manager.token()),
    (error: unknown) => error instanceof GitHubOAuthError && error.status === 401,
  );
  assert.equal(secrets.raw, undefined);
});

test("a transient refresh failure preserves authorization for a later attempt", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  const { manager, run } = managerWith(secrets, async () =>
    Response.json({ message: "fixture unavailable" }, { status: 503 }),
  );
  await assert.rejects(
    () => run(() => manager.token()),
    (error: unknown) => error instanceof GitHubOAuthError && error.status === 503,
  );
  assert.deepEqual(JSON.parse(secrets.raw!), storedCredentials({ accessTokenExpiresAt: NOW }));
});

test("a transient proactive failure still uses a token that has not expired", async () => {
  const expiresAt = NOW + 60_000;
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: expiresAt }));
  const { manager, run } = managerWith(secrets, async () =>
    Response.json({ message: "fixture unavailable" }, { status: 503 }),
  );
  assert.equal(await run(() => manager.token()), "fixture-access-0");
  assert.deepEqual(await run(() => manager.status()), {
    connected: true,
    login: "fixture-account",
  });
  await assert.rejects(
    () => run(() => manager.read({ allowValidTokenOnRefreshFailure: false })),
    (error: unknown) => error instanceof GitHubOAuthError && error.status === 503,
  );
  assert.equal(JSON.parse(secrets.raw!).accessTokenExpiresAt, expiresAt);
});

test("cancelling the caller cannot abort or discard an in-flight token rotation", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  const controller = new AbortController();
  const manager = createGitHubCredentialManager({
    secrets,
    clientId: "fixture-client",
    now: () => NOW,
  });
  const token = await withGitHubRequest(
    {
      signal: controller.signal,
      fetch: async (_input, init) => {
        controller.abort();
        assert.equal(init?.signal?.aborted, false);
        return Response.json(tokenResponse());
      },
    },
    () => manager.token(),
  );
  assert.equal(token, "fixture-access-1");
  assert.equal(JSON.parse(secrets.raw!).refreshToken, "fixture-refresh-1");
});

test("GitHub's bad_refresh_token response clears authorization even with HTTP 200", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  const { manager, run } = managerWith(secrets, async () =>
    Response.json({ error: "bad_refresh_token" }),
  );
  await assert.rejects(
    () => run(() => manager.token()),
    (error: unknown) => error instanceof GitHubOAuthError && error.status === 401,
  );
  assert.equal(secrets.raw, undefined);
});

test("an incomplete refresh response cannot overwrite the current credential", async () => {
  const secrets = secretsFixture(storedCredentials({ accessTokenExpiresAt: NOW }));
  const { manager, run } = managerWith(secrets, async () =>
    Response.json({ access_token: "incomplete-access", token_type: "bearer" }),
  );
  await assert.rejects(() => run(() => manager.token()), /complete refreshable credentials/);
  assert.deepEqual(JSON.parse(secrets.raw!), storedCredentials({ accessTokenExpiresAt: NOW }));
});

test("an expired refresh token requires authorization without a network request", async () => {
  const secrets = secretsFixture(storedCredentials({ refreshTokenExpiresAt: NOW }));
  const { manager, run } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  await assert.rejects(
    () => run(() => manager.refreshAfterRejected("fixture-access-0")),
    (error: unknown) => error instanceof GitHubOAuthError && error.status === 401,
  );
  assert.equal(secrets.raw, undefined);
});

test("permanently expired refresh metadata reports a disconnected status", async () => {
  const secrets = secretsFixture(
    storedCredentials({ accessTokenExpiresAt: NOW, refreshTokenExpiresAt: NOW }),
  );
  const { manager, run } = managerWith(secrets, async () => {
    throw new Error("Unexpected network request");
  });
  assert.deepEqual(await run(() => manager.status()), { connected: false });
  assert.equal(secrets.raw, undefined);
});
