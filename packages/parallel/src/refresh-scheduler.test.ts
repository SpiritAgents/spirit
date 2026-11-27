import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  createParallelCredentialManager,
  PARALLEL_CREDENTIAL_SLOT,
  parallelCredentialsFromTokenResponse,
  type ParallelCredentials,
} from "./credentials.js";
import { ParallelOAuthError } from "./oauth.js";
import { createParallelRefreshScheduler } from "./refresh-scheduler.js";

beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
afterEach(() => vi.useRealTimers());

test("a freshly issued 10-minute token is armed to refresh at minute 8, not immediately", async () => {
  const credentials = parallelCredentialsFromTokenResponse(
    { access_token: "access", refresh_token: "refresh", expires_in: 600 },
    Date.now(),
  );
  const read = vi.fn(async (): Promise<ParallelCredentials> => credentials);
  const scheduler = createParallelRefreshScheduler({ signal: new AbortController().signal, read });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);

  // 1ms before minute 8 (480,000ms): no second read yet.
  await vi.advanceTimersByTimeAsync(480_000 - 1);
  assert.equal(read.mock.calls.length, 1);

  // At minute 8 (2 minutes before expiry): triggers the refresh read.
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("transient failures back off while disposal stops further reads", async () => {
  const read = vi.fn(async (): Promise<ParallelCredentials | undefined> => {
    throw new ParallelOAuthError("Parallel is temporarily unavailable. Try again.", 503);
  });
  const log = vi.fn();
  const scheduler = createParallelRefreshScheduler({
    signal: new AbortController().signal,
    read,
    log,
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(read.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(read.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(read.mock.calls.length, 3);
  assert.equal(log.mock.calls.length, 3);
  scheduler.dispose();
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  assert.equal(read.mock.calls.length, 3);
});

test("retired grants keep polling locally so peer reauthorization can wake the scheduler", async () => {
  let attempt = 0;
  const read = vi.fn(async (): Promise<ParallelCredentials | undefined> => {
    attempt += 1;
    if (attempt === 1) {
      throw new ParallelOAuthError(
        "Parallel authorization expired. Authorize Parallel again.",
        401,
      );
    }
    return undefined;
  });
  const scheduler = createParallelRefreshScheduler({
    signal: new AbortController().signal,
    read,
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("pre-expiry retry backoff caps at accessTokenExpiresAt even when the first refresh fails", async () => {
  const start = Date.now();
  const values = new Map<string, string>([
    [
      PARALLEL_CREDENTIAL_SLOT,
      JSON.stringify({
        accessToken: "due-access",
        refreshToken: "stored-refresh",
        accessTokenExpiresAt: start + 10_000,
        accessTokenRefreshAt: start - 110_000,
      }),
    ],
  ]);
  const secrets = {
    async get(key: string) {
      return values.get(key);
    },
    async set(key: string, value: string) {
      values.set(key, value);
    },
    async update(
      key: string,
      updater: (current: string | undefined) => string | undefined | Promise<string | undefined>,
    ) {
      const next = await updater(values.get(key));
      if (next === undefined) values.delete(key);
      else values.set(key, next);
      return next;
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
  let refreshAttempts = 0;
  const manager = createParallelCredentialManager({
    secrets,
    now: () => Date.now(),
    fetch: async () => {
      refreshAttempts += 1;
      return new Response(JSON.stringify({}), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const scheduler = createParallelRefreshScheduler({
    signal: new AbortController().signal,
    read: () => manager.read({ allowValidTokenOnRefreshFailure: false }),
    readAccessTokenExpiresAt: () => manager.readAccessTokenExpiresAt(),
  });
  scheduler.start();

  // First read fails 10s before expiry: accessToken stays valid, retry is capped at 10s (not 30s).
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(refreshAttempts, 1);
  assert.equal(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!).accessToken, "due-access");

  // At exact expiry (10s later): retries and strips expired accessToken immediately.
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(refreshAttempts, 2);
  assert.deepEqual(JSON.parse(values.get(PARALLEL_CREDENTIAL_SLOT)!), {
    refreshToken: "stored-refresh",
    accessTokenExpiresAt: start + 10_000,
    accessTokenRefreshAt: start - 110_000,
  });

  // Subsequent retries follow normal backoff (60s) without spinning.
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(refreshAttempts, 2);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(refreshAttempts, 3);
  scheduler.dispose();
});
