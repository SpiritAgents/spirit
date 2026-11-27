import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS, type ExaCredentials } from "./credentials.js";
import { ExaOAuthError } from "./oauth.js";
import { createExaRefreshScheduler } from "./refresh-scheduler.js";

beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
afterEach(() => vi.useRealTimers());

test("the next refresh is armed ahead of access token expiry using the bounded refresh lead", async () => {
  const expiresAt = Date.now() + 3_600_000;
  const read = vi.fn(async (): Promise<ExaCredentials> => ({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: expiresAt,
    refreshLeadMs: EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  }));
  const scheduler = createExaRefreshScheduler({ signal: new AbortController().signal, read });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(
    expiresAt - EXA_MAX_ACCESS_TOKEN_REFRESH_WINDOW_MS - Date.now() - 1,
  );
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("short-lived tokens arm their refresh using refreshLeadMs instead of looping immediately", async () => {
  const expiresAt = Date.now() + 300_000;
  const read = vi.fn(async (): Promise<ExaCredentials> => ({
    accessToken: "short-access",
    refreshToken: "short-refresh",
    accessTokenExpiresAt: expiresAt,
    refreshLeadMs: 60_000,
  }));
  const scheduler = createExaRefreshScheduler({ signal: new AbortController().signal, read });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(239_999);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("transient failures back off while disposal stops further reads", async () => {
  const read = vi.fn(async (): Promise<ExaCredentials | undefined> => {
    throw new ExaOAuthError("Exa is temporarily unavailable. Try again.", 503);
  });
  const log = vi.fn();
  const scheduler = createExaRefreshScheduler({
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
