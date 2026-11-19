import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { VERCEL_ACCESS_TOKEN_REFRESH_WINDOW_MS, type VercelCredentials } from "./credentials.js";
import { VercelOAuthError } from "./oauth.js";
import { createVercelRefreshScheduler } from "./refresh-scheduler.js";

beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
afterEach(() => vi.useRealTimers());

test("the next refresh is armed ahead of access token expiry", async () => {
  const expiresAt = Date.now() + 3_600_000;
  const read = vi.fn(async (): Promise<VercelCredentials> => ({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: expiresAt,
  }));
  const scheduler = createVercelRefreshScheduler({ signal: new AbortController().signal, read });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(
    expiresAt - VERCEL_ACCESS_TOKEN_REFRESH_WINDOW_MS - Date.now() - 1,
  );
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("transient failures back off while disposal stops further reads", async () => {
  const read = vi.fn(async (): Promise<VercelCredentials | undefined> => {
    throw new VercelOAuthError("Vercel is temporarily unavailable. Try again.", 503);
  });
  const log = vi.fn();
  const scheduler = createVercelRefreshScheduler({
    signal: new AbortController().signal,
    read,
    log,
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  assert.equal(read.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(60_000);
  assert.equal(read.mock.calls.length, 2);
  await vi.advanceTimersByTimeAsync(60_000);
  assert.equal(read.mock.calls.length, 3);
  assert.equal(log.mock.calls.length, 3);
  scheduler.dispose();
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  assert.equal(read.mock.calls.length, 3);
});
