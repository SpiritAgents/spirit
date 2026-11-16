import { test } from "vitest";
import assert from "node:assert/strict";

import { githubFetch, setGitHubFetchImplementation } from "./github-fetch.js";

test("githubFetch uses global fetch by default", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("ok");
  }) as typeof fetch;

  try {
    setGitHubFetchImplementation(undefined);
    const response = await githubFetch("https://example.com");
    assert.equal(called, true);
    assert.equal(await response.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
    setGitHubFetchImplementation(undefined);
  }
});

test("setGitHubFetchImplementation overrides outbound fetch", async () => {
  let injectedCalled = false;
  setGitHubFetchImplementation(async () => {
    injectedCalled = true;
    return new Response("injected");
  });

  try {
    const response = await githubFetch("https://api.github.com");
    assert.equal(injectedCalled, true);
    assert.equal(await response.text(), "injected");
  } finally {
    setGitHubFetchImplementation(undefined);
  }
});

test("request transports are scoped independently and inherit cancellation", async () => {
  const { withGitHubRequest } = await import("./github-fetch.js");
  const first = withGitHubRequest({ fetch: async () => new Response("one") }, async () => {
    await Promise.resolve();
    return (await githubFetch("https://example.test")).text();
  });
  const second = withGitHubRequest({ fetch: async () => new Response("two") }, async () =>
    (await githubFetch("https://example.test")).text(),
  );
  assert.deepEqual(await Promise.all([first, second]), ["one", "two"]);
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () =>
      withGitHubRequest(
        {
          signal: controller.signal,
          fetch: async () => {
            assert.fail("aborted request reached transport");
          },
        },
        () => githubFetch("https://example.test"),
      ),
    /abort/i,
  );
});
