import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import { GitHubOAuthError } from "./oauth.js";
import { createGitHubRefreshScheduler } from "./refresh-scheduler.js";
import { GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS } from "./credentials.js";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function credentials(expiresInMs = 60 * 60 * 1000) {
  return {
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    accessTokenExpiresAt: Date.now() + expiresInMs,
    refreshTokenExpiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
    login: "fixture-account",
  };
}

test("activation schedules a non-blocking read and then refreshes at the expiry boundary", async () => {
  const controller = new AbortController();
  let reads = 0;
  const scheduler = createGitHubRefreshScheduler({
    signal: controller.signal,
    read: async () => {
      reads += 1;
      return credentials();
    },
    runInBackground: (run) => run(),
  });
  scheduler.start();
  assert.equal(reads, 0);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(reads, 1);
  const delay = 60 * 60 * 1000 - GITHUB_ACCESS_TOKEN_REFRESH_WINDOW_MS;
  await vi.advanceTimersByTimeAsync(delay - 1);
  assert.equal(reads, 1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(reads, 2);
  scheduler.dispose();
});

test("transient failures retry with backoff and success restores the expiry schedule", async () => {
  const controller = new AbortController();
  let reads = 0;
  const messages: string[] = [];
  const scheduler = createGitHubRefreshScheduler({
    signal: controller.signal,
    read: async () => {
      reads += 1;
      if (reads === 1) throw new TypeError("offline");
      return credentials();
    },
    runInBackground: (run) => run(),
    log: (message) => messages.push(message),
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(reads, 1);
  assert.equal(messages.length, 1);
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(reads, 1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(reads, 2);
  scheduler.dispose();
});

test("permanent authorization failure and dispose both stop future work", async () => {
  const controller = new AbortController();
  let reads = 0;
  const scheduler = createGitHubRefreshScheduler({
    signal: controller.signal,
    read: async () => {
      reads += 1;
      throw new GitHubOAuthError("reauthorize", 401);
    },
    runInBackground: (run) => run(),
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_001);
  assert.equal(reads, 2);

  scheduler.start();
  scheduler.dispose();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  assert.equal(reads, 2);
});

test("an empty read retries locally and resumes the expiry schedule after peer authorization", async () => {
  const controller = new AbortController();
  let reads = 0;
  const scheduler = createGitHubRefreshScheduler({
    signal: controller.signal,
    read: async () => {
      reads += 1;
      return reads < 3 ? undefined : credentials();
    },
    runInBackground: (run) => run(),
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(reads, 1);
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(reads, 1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(reads, 2);
  await vi.advanceTimersByTimeAsync(60_001);
  assert.equal(reads, 3);
  scheduler.dispose();
});

test("restarting during an in-flight read cannot arm a stale schedule", async () => {
  const controller = new AbortController();
  let resolveFirst!: (value: ReturnType<typeof credentials>) => void;
  let reads = 0;
  const scheduler = createGitHubRefreshScheduler({
    signal: controller.signal,
    read: async () => {
      reads += 1;
      if (reads === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return credentials();
    },
    runInBackground: (run) => run(),
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(reads, 1);
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(reads, 2);
  resolveFirst(credentials());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(vi.getTimerCount(), 1);
  scheduler.dispose();
});
