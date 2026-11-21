import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  CLOUDFLARE_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  type CloudflareCredentials,
} from "./credentials.js";
import { CloudflareOAuthError } from "./oauth.js";
import { createCloudflareRefreshScheduler } from "./refresh-scheduler.js";

beforeEach(() => vi.useFakeTimers({ now: 1_800_000_000_000 }));
afterEach(() => vi.useRealTimers());

test("the next refresh is armed ahead of access token expiry", async () => {
  const expiresAt = Date.now() + 3_600_000;
  const refreshAt = expiresAt - CLOUDFLARE_ACCESS_TOKEN_REFRESH_WINDOW_MS;
  const read = vi.fn(async (): Promise<CloudflareCredentials> => ({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: expiresAt,
    accessTokenRefreshAt: refreshAt,
  }));
  const scheduler = createCloudflareRefreshScheduler({
    signal: new AbortController().signal,
    read,
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(refreshAt - Date.now() - 1);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("short-lived tokens wait until accessTokenRefreshAt instead of spinning at delay 0", async () => {
  const read = vi.fn(async (): Promise<CloudflareCredentials> => ({
    accessToken: "short-access",
    refreshToken: "short-refresh",
    accessTokenExpiresAt: Date.now() + 300_000,
    accessTokenRefreshAt: Date.now() + 150_000,
  }));
  const scheduler = createCloudflareRefreshScheduler({
    signal: new AbortController().signal,
    read,
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(149_999);
  assert.equal(read.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(read.mock.calls.length, 2);
  scheduler.dispose();
});

test("transient failures back off while disposal stops further reads", async () => {
  const read = vi.fn(async (): Promise<CloudflareCredentials | undefined> => {
    throw new CloudflareOAuthError("Cloudflare is temporarily unavailable. Try again.", 503);
  });
  const log = vi.fn();
  const scheduler = createCloudflareRefreshScheduler({
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
