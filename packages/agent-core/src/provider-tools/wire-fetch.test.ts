import assert from "node:assert/strict";
import { test } from "vitest";

import { createProviderToolsWireFetch, mergeProviderToolLiteralEntries } from "./wire-fetch.js";

function captureFetch(): {
  fetchImpl: typeof fetch;
  bodies: () => Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (typeof init?.body === "string") {
      try {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      } catch {
        // non-JSON body: nothing to inspect
      }
    }
    return new Response("{}", { status: 200 });
  };
  return { fetchImpl, bodies: () => bodies };
}

const MESSAGES_BODY = { model: "m", messages: [{ role: "user", content: "hi" }] };

test("provider tools wire fetch merges literal entries and entry bodies into model requests", async () => {
  const { fetchImpl, bodies } = captureFetch();
  const fetch = createProviderToolsWireFetch(
    {
      literalEntries: [{ type: "web_search_20250305", name: "web_search" }],
      bodyPatches: [{ enable_search: true }],
    },
    fetchImpl,
  );

  await fetch("https://example.com/anthropic/v1/messages", {
    method: "POST",
    body: JSON.stringify({ ...MESSAGES_BODY, tools: [{ type: "function", name: "shell" }] }),
  });

  const body = bodies()[0]!;
  assert.equal(body.enable_search, true);
  assert.deepEqual(body.tools, [
    { type: "function", name: "shell" },
    { type: "web_search_20250305", name: "web_search" },
  ]);
});

test("provider tools wire fetch leaves non-model and non-JSON requests untouched", async () => {
  const { fetchImpl, bodies } = captureFetch();
  const fetch = createProviderToolsWireFetch(
    {
      literalEntries: [{ type: "web_search_20250305", name: "web_search" }],
      bodyPatches: [{ enable_search: true }],
    },
    fetchImpl,
  );

  await fetch("https://example.com/v1/files", { method: "POST", body: "not json" });
  await fetch("https://example.com/v1/models", { method: "GET" });
  // Image-generation-style body: string prompt is not a model conversation.
  await fetch("https://example.com/v1/images/generations", {
    method: "POST",
    body: JSON.stringify({ model: "m", prompt: "a red circle" }),
  });

  assert.equal(bodies().length, 1);
  assert.equal("tools" in bodies()[0]!, false);
  assert.equal("enable_search" in bodies()[0]!, false);
});

test("mergeProviderToolLiteralEntries dedups by type+name / id / function_name", () => {
  const merged = mergeProviderToolLiteralEntries(
    [
      { type: "web_search_20250305", name: "web_search" },
      { type: "function", name: "shell" },
    ],
    [
      { type: "web_search_20250305", name: "web_search" },
      { type: "provider", id: "gateway.search", args: {} },
      { type: "acme_formula", formula_uri: "acme/search:latest", function_name: "web_search" },
    ],
  );

  assert.deepEqual(merged, [
    { type: "web_search_20250305", name: "web_search" },
    { type: "function", name: "shell" },
    { type: "provider", id: "gateway.search", args: {} },
    { type: "acme_formula", formula_uri: "acme/search:latest", function_name: "web_search" },
  ]);
});

test("provider tools wire fetch is the identity when there is nothing to merge", async () => {
  const baseFetch: typeof fetch = async () => new Response("{}", { status: 200 });
  const fetch = createProviderToolsWireFetch({ literalEntries: [], bodyPatches: [] }, baseFetch);
  assert.equal(fetch, baseFetch);
});
