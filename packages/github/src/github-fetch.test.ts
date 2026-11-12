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
