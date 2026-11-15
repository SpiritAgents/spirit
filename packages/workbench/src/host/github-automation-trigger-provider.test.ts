import assert from "node:assert/strict";
import { test } from "vitest";

import { setGitHubFetchImplementation } from "@spiritagent/github";
import { pollGitHubAutomationTriggerProvider } from "./github-automation-trigger-provider.js";

test("GitHub adapter baselines new triggers and maps ordered provider events", async () => {
  setGitHubFetchImplementation(async (input) => {
    const url = new URL(input instanceof URL ? input : String(input));
    if (url.searchParams.get("per_page") === "1") {
      return Response.json([{ number: 2, html_url: "https://example/2", pull_request: {} }]);
    }
    return Response.json([
      { number: 2, html_url: "https://example/2", pull_request: {}, created_at: "2026-01-01" },
    ]);
  });
  try {
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
      loadAccessToken: async () => "test-token",
    });
    assert.deepEqual(output.results[0], {
      automationId: "baseline",
      checkpoint: { lastSeenNumber: 2 },
    });
    assert.equal(output.results[1]?.automationId, "initialized");
    assert.equal(output.results[1]?.events?.[0]?.id, "https://example/2");
    assert.deepEqual(output.results[1]?.events?.[0]?.checkpoint, { lastSeenNumber: 2 });
  } finally {
    setGitHubFetchImplementation(undefined);
  }
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
    loadAccessToken: async () => undefined,
  });

  assert.deepEqual(output, {
    results: [
      { automationId: "baseline", error: "Connect GitHub before running this Automation." },
      { automationId: "initialized", error: "Connect GitHub before running this Automation." },
    ],
  });
});
