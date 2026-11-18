import { test } from "vitest";
import assert from "node:assert/strict";

import { githubFetch, withGitHubRequest } from "./github-fetch.js";

test("githubFetch uses global fetch by default", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("ok");
  }) as typeof fetch;

  try {
    const response = await githubFetch("https://example.com");
    assert.equal(called, true);
    assert.equal(await response.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request transports are scoped independently and inherit cancellation", async () => {
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

test("a 401 refreshes the Bearer credential and replays the request once", async () => {
  const authorizations: Array<string | null> = [];
  const bodies: unknown[] = [];
  const refreshed: string[] = [];
  const response = await withGitHubRequest(
    {
      fetch: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("Authorization"));
        bodies.push(init?.body);
        return authorizations.length === 1
          ? Response.json({ message: "Bad credentials" }, { status: 401 })
          : Response.json({ ok: true });
      },
      refreshAccessToken: async (rejected) => {
        refreshed.push(rejected);
        return "fixture-access-1";
      },
    },
    () =>
      githubFetch("https://example.test/resource", {
        method: "POST",
        headers: { Authorization: "Bearer fixture-access-0" },
        body: "fixture-body",
      }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(authorizations, ["Bearer fixture-access-0", "Bearer fixture-access-1"]);
  assert.deepEqual(bodies, ["fixture-body", "fixture-body"]);
  assert.deepEqual(refreshed, ["fixture-access-0"]);
});

test("a second 401 is returned without another refresh or replay", async () => {
  let requests = 0;
  let refreshes = 0;
  const response = await withGitHubRequest(
    {
      fetch: async (_input, init) => {
        requests += 1;
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          requests === 1 ? "Bearer old" : "Bearer new",
        );
        return new Response(null, { status: 401 });
      },
      refreshAccessToken: async () => {
        refreshes += 1;
        return "new";
      },
    },
    () => githubFetch("https://example.test", { headers: { Authorization: "Bearer old" } }),
  );
  assert.equal(response.status, 401);
  assert.equal(requests, 2);
  assert.equal(refreshes, 1);
});

test("an unauthenticated 401 is returned without invoking the credential manager", async () => {
  let refreshes = 0;
  const response = await withGitHubRequest(
    {
      fetch: async () => new Response(null, { status: 401 }),
      refreshAccessToken: async () => {
        refreshes += 1;
        return undefined;
      },
    },
    () => githubFetch("https://example.test"),
  );
  assert.equal(response.status, 401);
  assert.equal(refreshes, 0);
});
