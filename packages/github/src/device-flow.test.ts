import { test } from "vitest";
import assert from "node:assert/strict";

import { pollGitHubDeviceToken, requestGitHubDeviceCode } from "./device-flow.js";
import { GitHubOAuthError } from "./oauth.js";

const originalFetch = globalThis.fetch;
const TEST_CLIENT_ID = "test-client-id";

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

test("requestGitHubDeviceCode maps GitHub device code response", async () => {
  mockFetch(async (_input, init) => {
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("client_id"), TEST_CLIENT_ID);
    assert.equal(body.get("scope"), "repo read:user");
    return Response.json({
      device_code: "device-code-1",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
  });

  try {
    const challenge = await requestGitHubDeviceCode({ clientId: TEST_CLIENT_ID });
    assert.equal(challenge.deviceCode, "device-code-1");
    assert.equal(challenge.userCode, "ABCD-1234");
    assert.equal(challenge.verificationUri, "https://github.com/login/device");
    assert.equal(challenge.expiresIn, 900);
    assert.equal(challenge.intervalSeconds, 5);
  } finally {
    restoreFetch();
  }
});

test("requestGitHubDeviceCode retries fetch failures until device code is returned", async () => {
  let requestCount = 0;
  mockFetch(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      throw new TypeError("fetch failed");
    }
    return Response.json({
      device_code: "device-code-1",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
  });

  try {
    const challenge = await requestGitHubDeviceCode({ clientId: TEST_CLIENT_ID });
    assert.equal(challenge.deviceCode, "device-code-1");
    assert.equal(requestCount, 2);
  } finally {
    restoreFetch();
  }
});

test("pollGitHubDeviceToken waits for authorization_pending then returns token", async () => {
  let pollCount = 0;
  mockFetch(async () => {
    pollCount += 1;
    if (pollCount === 1) {
      return Response.json({ error: "authorization_pending" });
    }
    return Response.json({
      access_token: "gho_test_token",
      token_type: "bearer",
      scope: "repo,read:user",
    });
  });

  try {
    const token = await pollGitHubDeviceToken({
      deviceCode: "device-code-1",
      intervalSeconds: 0,
      expiresIn: 5,
      clientId: TEST_CLIENT_ID,
    });
    assert.equal(token.access_token, "gho_test_token");
    assert.equal(pollCount, 2);
  } finally {
    restoreFetch();
  }
});

test("pollGitHubDeviceToken honors abort signal", async () => {
  const abort = new AbortController();
  mockFetch(async () => {
    abort.abort();
    return Response.json({ error: "authorization_pending" });
  });

  try {
    await assert.rejects(
      () =>
        pollGitHubDeviceToken({
          deviceCode: "device-code-1",
          intervalSeconds: 0,
          expiresIn: 5,
          clientId: TEST_CLIENT_ID,
          signal: abort.signal,
        }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubOAuthError);
        assert.match(error.message, /cancelled/iu);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("pollGitHubDeviceToken retries fetch failures until token is returned", async () => {
  let pollCount = 0;
  mockFetch(async () => {
    pollCount += 1;
    if (pollCount === 1) {
      throw new TypeError("fetch failed");
    }
    return Response.json({
      access_token: "gho_test_token",
      token_type: "bearer",
    });
  });

  try {
    const token = await pollGitHubDeviceToken({
      deviceCode: "device-code-1",
      intervalSeconds: 0,
      expiresIn: 5,
      clientId: TEST_CLIENT_ID,
    });
    assert.equal(token.access_token, "gho_test_token");
    assert.equal(pollCount, 2);
  } finally {
    restoreFetch();
  }
});

test("pollGitHubDeviceToken maps access_denied to GitHubOAuthError", async () => {
  mockFetch(async () => Response.json({ error: "access_denied" }));

  try {
    await assert.rejects(
      () =>
        pollGitHubDeviceToken({
          deviceCode: "device-code-1",
          intervalSeconds: 0,
          expiresIn: 5,
          clientId: TEST_CLIENT_ID,
        }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubOAuthError);
        assert.match(error.message, /denied/iu);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});
