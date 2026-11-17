import assert from "node:assert/strict";
import { test } from "vitest";

import { withGitHubRequest } from "./github-fetch.js";
import { pollGitHubAutomationTriggerProvider } from "./extension-poller.js";

test("GitHub adapter baselines new triggers and maps ordered provider events", async () => {
  await withGitHubRequest(
    {
      fetch: async (input) => {
        const url = new URL(input instanceof URL ? input : String(input));
        if (url.searchParams.get("per_page") === "1") {
          return Response.json([{ number: 2, html_url: "https://example/2", pull_request: {} }]);
        }
        return Response.json([
          { number: 2, html_url: "https://example/2", pull_request: {}, created_at: "2026-01-01" },
        ]);
      },
    },
    async () => {
      const output = await pollGitHubAutomationTriggerProvider({
        triggers: [
          {
            automationId: "baseline",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
          },
          {
            automationId: "initialized",
            config: { owner: "spirit", repo: "demo", event: "pull_request_created" },
            state: { lastSeenNumber: 1 },
          },
        ],
        signal: new AbortController().signal,
        clearAuthorization: async () => {},
        loadAccessToken: async () => "test-token",
      });
      assert.deepEqual(output.results[0], {
        automationId: "baseline",
        checkpoint: { lastSeenNumber: 2 },
      });
      assert.equal(output.results[1]?.automationId, "initialized");
      assert.equal(output.results[1]?.events?.[0]?.id, "https://example/2");
      assert.deepEqual(output.results[1]?.events?.[0]?.checkpoint, { lastSeenNumber: 2 });
    },
  );
});

test("GitHub adapter reports missing authorization for baseline and initialized triggers", async () => {
  const output = await pollGitHubAutomationTriggerProvider({
    triggers: [
      {
        automationId: "baseline",
        config: { owner: "spirit", repo: "demo", event: "issue_created" },
      },
      {
        automationId: "initialized",
        config: { owner: "spirit", repo: "demo", event: "issue_created" },
        state: { lastSeenNumber: 10 },
      },
    ],
    signal: new AbortController().signal,
    clearAuthorization: async () => {},
    loadAccessToken: async () => undefined,
  });

  assert.deepEqual(output, {
    results: [
      { automationId: "baseline", error: "Connect GitHub before running this Automation." },
      { automationId: "initialized", error: "Connect GitHub before running this Automation." },
    ],
  });
});

test("repository polling shares one fetch and gives each event its own checkpoint", async () => {
  let calls = 0;
  await withGitHubRequest(
    {
      fetch: async () => {
        calls += 1;
        return Response.json([
          { number: 9, html_url: "https://example.test/events/9" },
          { number: 8, html_url: "https://example.test/events/8", pull_request: {} },
          { number: 7, html_url: "https://example.test/events/7" },
          { number: 6, html_url: "https://example.test/events/6" },
        ]);
      },
    },
    async () => {
      const output = await pollGitHubAutomationTriggerProvider({
        triggers: [
          {
            automationId: "issues",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: 6 },
          },
          {
            automationId: "pulls",
            config: { owner: "spirit", repo: "demo", event: "pull_request_created" },
            state: { lastSeenNumber: 7 },
          },
        ],
        signal: new AbortController().signal,
        loadAccessToken: async () => "test-token",
        clearAuthorization: async () => assert.fail("unexpected authorization clear"),
      });
      assert.equal(calls, 1);
      assert.deepEqual(
        output.results[0].events?.map((x) => x.checkpoint),
        [{ lastSeenNumber: 7 }, { lastSeenNumber: 9 }],
      );
      assert.deepEqual(
        output.results[1].events?.map((x) => x.checkpoint),
        [{ lastSeenNumber: 8 }],
      );
    },
  );
});

test("overlapping API pages cannot publish the same provider event twice", async () => {
  await withGitHubRequest(
    {
      fetch: async () =>
        Response.json([
          { number: 8, html_url: "https://example.test/events/8" },
          { number: 8, html_url: "https://example.test/events/8" },
        ]),
    },
    async () => {
      const output = await pollGitHubAutomationTriggerProvider({
        triggers: [
          {
            automationId: "issues",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: 7 },
          },
        ],
        signal: new AbortController().signal,
        loadAccessToken: async () => "test-token",
        clearAuthorization: async () => {},
      });
      assert.deepEqual(
        output.results[0].events?.map((x) => x.id),
        ["https://example.test/events/8"],
      );
    },
  );
});

test("a successful baseline is reported once when the initialized group fetch fails", async () => {
  await withGitHubRequest(
    {
      fetch: async (input) => {
        const url = new URL(String(input));
        return url.searchParams.get("per_page") === "1"
          ? Response.json([{ number: 8 }])
          : Response.json({ message: "Offline transport failure" }, { status: 500 });
      },
    },
    async () => {
      const output = await pollGitHubAutomationTriggerProvider({
        triggers: [
          {
            automationId: "fresh",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
          },
          {
            automationId: "initialized",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: 7 },
          },
        ],
        signal: new AbortController().signal,
        loadAccessToken: async () => "test-token",
        clearAuthorization: async () => {},
      });
      assert.deepEqual(
        output.results.map((x) => x.automationId),
        ["fresh", "initialized"],
      );
      assert.deepEqual(output.results[0], {
        automationId: "fresh",
        checkpoint: { lastSeenNumber: 8 },
      });
      assert.match(output.results[1].error ?? "", /Offline transport failure/);
    },
  );
});

test("polling clears only rejected credentials and propagates cancellation", async () => {
  for (const status of [401, 403]) {
    let clears = 0;
    await withGitHubRequest(
      { fetch: async () => Response.json({ message: "Denied" }, { status }) },
      async () => {
        const output = await pollGitHubAutomationTriggerProvider({
          triggers: [
            {
              automationId: "issues",
              config: { owner: "spirit", repo: "demo", event: "issue_created" },
              state: { lastSeenNumber: 7 },
            },
          ],
          signal: new AbortController().signal,
          loadAccessToken: async () => "test-token",
          clearAuthorization: async () => {
            clears += 1;
          },
        });
        assert.equal(output.results.length, 1);
        assert.ok(output.results[0].error);
        assert.equal(clears, status === 401 ? 1 : 0);
      },
    );
  }
  const controller = new AbortController();
  await withGitHubRequest(
    {
      fetch: async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    },
    async () => {
      await assert.rejects(
        pollGitHubAutomationTriggerProvider({
          triggers: [
            {
              automationId: "issues",
              config: { owner: "spirit", repo: "demo", event: "issue_created" },
              state: { lastSeenNumber: 7 },
            },
          ],
          signal: controller.signal,
          loadAccessToken: async () => "test-token",
          clearAuthorization: async () =>
            assert.fail("cancelled poll must not clear authorization"),
        }),
        /abort/i,
      );
    },
  );
});

test("polling reports invalid checkpoint numbers without reaching transport", async () => {
  let calls = 0;
  await withGitHubRequest(
    {
      fetch: async () => {
        calls += 1;
        throw new Error("Unexpected transport");
      },
    },
    async () => {
      for (const lastSeenNumber of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const output = await pollGitHubAutomationTriggerProvider({
          triggers: [
            {
              automationId: "issues",
              config: { owner: "spirit", repo: "demo", event: "issue_created" },
              state: { lastSeenNumber },
            },
          ],
          signal: new AbortController().signal,
          loadAccessToken: async () => "test-token",
          clearAuthorization: async () => {},
        });
        assert.deepEqual(output.results, [
          { automationId: "issues", error: "Invalid GitHub Automation trigger checkpoint." },
        ]);
      }
      assert.equal(calls, 0);
    },
  );
});

test("invalid targets are isolated from healthy GitHub automations", async () => {
  let calls = 0;
  await withGitHubRequest(
    {
      fetch: async () => {
        calls += 1;
        return Response.json([{ number: 8, html_url: "https://example.test/events/8" }]);
      },
    },
    async () => {
      const output = await pollGitHubAutomationTriggerProvider({
        triggers: [
          {
            automationId: "bad-config",
            config: { owner: 12, repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: 7 },
          },
          {
            automationId: "bad-checkpoint",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: -1 },
          },
          {
            automationId: "healthy",
            config: { owner: "spirit", repo: "demo", event: "issue_created" },
            state: { lastSeenNumber: 7 },
          },
        ],
        signal: new AbortController().signal,
        loadAccessToken: async () => "test-token",
        clearAuthorization: async () => {},
      });
      const results = new Map(output.results.map((x) => [x.automationId, x]));
      assert.equal(output.results.length, 3);
      assert.match(results.get("bad-config")?.error ?? "", /config/);
      assert.match(results.get("bad-checkpoint")?.error ?? "", /checkpoint/);
      assert.deepEqual(
        results.get("healthy")?.events?.map((x) => x.checkpoint),
        [{ lastSeenNumber: 8 }],
      );
      assert.equal(calls, 1);
    },
  );
});
