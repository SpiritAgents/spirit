import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { LINEAR_ACCESS_TOKEN_REFRESH_WINDOW_MS, type LinearCredentials } from "./credentials.js";
import { LinearOAuthError } from "./oauth.js";
import { createLinearRefreshScheduler } from "./refresh-scheduler.js";

beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
afterEach(() => vi.useRealTimers());

test("the next refresh is armed ahead of access token expiry", async () => {
  const expiresAt = Date.now() + 3_600_000;
  const read = vi.fn(async (): Promise<LinearCredentials> => ({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: expiresAt,
  }));
  const scheduler = createLinearRefreshScheduler({ signal: new AbortController().signal, read });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(
    expiresAt - LINEAR_ACCESS_TOKEN_REFRESH_WINDOW_MS - Date.now() - 1,
  );
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("transient failures back off while disposal stops further reads", async () => {
  const read = vi.fn(async (): Promise<LinearCredentials | undefined> => {
    throw new LinearOAuthError("Linear is temporarily unavailable. Try again.", 503);
  });
  const log = vi.fn();
  const scheduler = createLinearRefreshScheduler({
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
