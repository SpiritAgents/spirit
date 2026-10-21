import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "../ports.js";
import {
  executeProviderToolCall,
  interpolateProviderToolExecuteBody,
  renderProviderToolResults,
} from "./execute.js";

type CapturedRequest = { url: string; init: RequestInit | undefined };

function fakeFetch(responder: (request: CapturedRequest) => Response): {
  fetchImpl: typeof fetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: String(input), init };
    requests.push(request);
    return responder(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function requestBody(request: CapturedRequest): JsonObject {
  return JSON.parse(String(request.init?.body)) as JsonObject;
}

const SITE = { apiBase: "https://api.example.com/v1", apiKey: "k" };

test("executeProviderToolCall POSTs the interpolated body to apiBase+path with Bearer auth", async () => {
  const { fetchImpl, requests } = fakeFetch(() => new Response(JSON.stringify({ ok: true })));
  const result = await executeProviderToolCall(
    { path: "/search", body: { text_query: "{arg.query}", count: "{arg.max_results}", static: 1 } },
    { toolName: "web_search", argumentsJson: JSON.stringify({ query: "q", max_results: 5 }) },
    { ...SITE, fetchImpl },
  );

  assert.equal(result.kind, "succeeded");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.example.com/v1/search");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer k");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(requestBody(requests[0] as CapturedRequest), {
    text_query: "q",
    count: 5,
    static: 1,
  });
});

test("executeProviderToolCall prefers the absolute url override", async () => {
  const { fetchImpl, requests } = fakeFetch(() => new Response(JSON.stringify({})));
  await executeProviderToolCall(
    { path: "/ignored", url: "https://search.example.com/run" },
    { toolName: "web_search", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.equal(requests[0]?.url, "https://search.example.com/run");
});

test("interpolateProviderToolExecuteBody keeps raw JSON types for whole-value placeholders", () => {
  const outcome = interpolateProviderToolExecuteBody(
    {
      name: "{toolName}",
      raw: "{argumentsJson}",
      count: "{arg.max_results}",
      flag: "{arg.flag}",
      nested: "{arg.filter.country}",
      literal: 3,
      list: ["{arg.query}", "plain"],
      record: { inner: "{arg.query}" },
    },
    {
      toolName: "web_search",
      argumentsJson: JSON.stringify({
        query: "q",
        max_results: 50,
        flag: true,
        filter: { country: "us" },
      }),
    },
  );
  assert.equal(outcome.kind, "ok");
  if (outcome.kind !== "ok") {
    return;
  }
  assert.equal(outcome.body.name, "web_search");
  assert.equal(typeof outcome.body.raw, "string");
  assert.equal(JSON.parse(String(outcome.body.raw)).max_results, 50);
  assert.equal(outcome.body.count, 50);
  assert.equal(outcome.body.flag, true);
  assert.equal(outcome.body.nested, "us");
  assert.equal(outcome.body.literal, 3);
  assert.deepEqual(outcome.body.list, ["q", "plain"]);
  assert.deepEqual(outcome.body.record, { inner: "q" });
});

test("interpolateProviderToolExecuteBody omits fields whose whole-value placeholder is missing", () => {
  const outcome = interpolateProviderToolExecuteBody(
    { query: "{arg.query}", count: "{arg.max_results}", keep: "x" },
    { toolName: "web_search", argumentsJson: JSON.stringify({ query: "q" }) },
  );
  assert.equal(outcome.kind, "ok");
  if (outcome.kind !== "ok") {
    return;
  }
  assert.deepEqual(outcome.body, { query: "q", keep: "x" });
});

test("interpolateProviderToolExecuteBody stringifies embedded placeholders and keeps unknown tokens literal", () => {
  const outcome = interpolateProviderToolExecuteBody(
    {
      text: "query={arg.query} count={arg.max_results} obj={arg.filter} unknown={nope}",
      untouched: "{nope}",
    },
    {
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "q", max_results: 5, filter: { country: "us" } }),
    },
  );
  assert.equal(outcome.kind, "ok");
  if (outcome.kind !== "ok") {
    return;
  }
  assert.equal(outcome.body.text, 'query=q count=5 obj={"country":"us"} unknown={nope}');
  assert.equal(outcome.body.untouched, "{nope}");
});

test("interpolateProviderToolExecuteBody fails a tool-argument error on an embedded missing value", () => {
  const outcome = interpolateProviderToolExecuteBody(
    { text: "query={arg.query}" },
    { toolName: "web_search", argumentsJson: "{}" },
  );
  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") {
    return;
  }
  assert.match(outcome.error, /web_search/);
  assert.match(outcome.error, /\{arg\.query\}/);
});

test("interpolateProviderToolExecuteBody treats arg placeholders as missing when arguments are invalid JSON", () => {
  const omitted = interpolateProviderToolExecuteBody(
    { count: "{arg.max_results}", name: "{toolName}", raw: "{argumentsJson}" },
    { toolName: "web_search", argumentsJson: "not json" },
  );
  assert.equal(omitted.kind, "ok");
  if (omitted.kind === "ok") {
    assert.deepEqual(omitted.body, { name: "web_search", raw: "not json" });
  }
  const embedded = interpolateProviderToolExecuteBody(
    { text: "query={arg.query}" },
    { toolName: "web_search", argumentsJson: "not json" },
  );
  assert.equal(embedded.kind, "failed");
});

test("executeProviderToolCall surfaces an embedded missing value as the tool error without fetching", async () => {
  const { fetchImpl, requests } = fakeFetch(() => new Response("{}"));
  const result = await executeProviderToolCall(
    { path: "/search", body: { text: "q={arg.query}" } },
    { toolName: "web_search", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.equal(result.kind, "failed");
  assert.equal(requests.length, 0);
});

test("executeProviderToolCall gates on statusPath with the default okValue and reads errorPath chains", async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({ status: "failed", error: "", context: { error: "upstream broke" } }),
      ),
  );
  const result = await executeProviderToolCall(
    {
      path: "/fibers",
      statusPath: "status",
      errorPath: ["error", "context.error", "context.output"],
    },
    { toolName: "web_search", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.deepEqual(result, { kind: "failed", error: "upstream broke" });
});

test("executeProviderToolCall honors a custom okValue and reports status when no error is found", async () => {
  const okFetch = fakeFetch(() => new Response(JSON.stringify({ state: "done", out: "yes" })));
  const ok = await executeProviderToolCall(
    { path: "/x", statusPath: "state", okValue: "done", resultPath: "out" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl: okFetch.fetchImpl },
  );
  assert.deepEqual(ok, { kind: "succeeded", content: "yes" });

  const badFetch = fakeFetch(() => new Response(JSON.stringify({ status: 42 })));
  const bad = await executeProviderToolCall(
    { path: "/x", statusPath: "status" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl: badFetch.fetchImpl },
  );
  assert.deepEqual(bad, {
    kind: "failed",
    error: 'Provider tool "t" did not succeed (status=unknown).',
  });
});

test("executeProviderToolCall extracts resultPath with first-non-empty-wins", async () => {
  const { fetchImpl } = fakeFetch(
    () => new Response(JSON.stringify({ context: { encrypted_output: "  ", output: "plain" } })),
  );
  const result = await executeProviderToolCall(
    { path: "/x", resultPath: ["context.encrypted_output", "context.output"] },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.deepEqual(result, { kind: "succeeded", content: "plain" });
});

test("executeProviderToolCall fails when a declared resultPath has no value", async () => {
  const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ context: {} })));
  const result = await executeProviderToolCall(
    { path: "/x", resultPath: ["context.encrypted_output", "context.output"] },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.match(result.error, /no result at context\.encrypted_output, context\.output/);
  }
});

test("executeProviderToolCall renders resultsPath + fields with the markdown renderer", async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          search_results: [
            {
              title: "First",
              url: "https://a.example",
              site_name: "A",
              date: "2026-01-01",
              snippet: "snip",
              content: "body",
            },
            { title: "", link: "https://b.example" },
          ],
        }),
      ),
  );
  const result = await executeProviderToolCall(
    {
      path: "/search",
      resultsPath: "search_results",
      fields: { title: "title", url: "link", site: "site_name" },
    },
    { toolName: "web_search", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.equal(result.kind, "succeeded");
  if (result.kind !== "succeeded") {
    return;
  }
  assert.equal(
    result.content,
    ["## 1. First", "Site: A", "", "## 2. Untitled", "URL: https://b.example"].join("\n"),
  );
});

test("executeProviderToolCall falls back to the raw response JSON without result declarations", async () => {
  const payload = { anything: true, n: 1 };
  const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify(payload)));
  const result = await executeProviderToolCall(
    { path: "/x" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl },
  );
  assert.deepEqual(result, { kind: "succeeded", content: JSON.stringify(payload) });
});

test("executeProviderToolCall fails on non-OK, non-JSON, and network errors", async () => {
  const httpError = fakeFetch(() => new Response("bad upstream", { status: 502 }));
  const a = await executeProviderToolCall(
    { path: "/x" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl: httpError.fetchImpl },
  );
  assert.deepEqual(a, {
    kind: "failed",
    error: 'Provider tool "t" request failed (502): bad upstream',
  });

  const nonJson = fakeFetch(() => new Response("nope", { status: 200 }));
  const b = await executeProviderToolCall(
    { path: "/x" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl: nonJson.fetchImpl },
  );
  assert.deepEqual(b, { kind: "failed", error: 'Provider tool "t" returned a non-JSON response.' });

  const throwing = (async () => {
    throw new Error("socket hangup");
  }) as typeof fetch;
  const c = await executeProviderToolCall(
    { path: "/x" },
    { toolName: "t", argumentsJson: "{}" },
    { ...SITE, fetchImpl: throwing },
  );
  assert.deepEqual(c, { kind: "failed", error: "socket hangup" });
});

test("renderProviderToolResults renders slots in order, skips missing fields, and handles empty input", () => {
  assert.equal(renderProviderToolResults([], { title: "title" }), "No search results.");
  const rendered = renderProviderToolResults(
    [
      { t: "Title A", u: "https://a.example", s: "A", d: "2026-01-01", sn: "snip", c: "body" },
      { u: "https://b.example" },
      "not-an-object",
    ],
    { title: "t", url: "u", site: "s", time: "d", snippet: "sn", content: "c" },
  );
  assert.equal(
    rendered,
    [
      "## 1. Title A",
      "URL: https://a.example",
      "Site: A",
      "Time: 2026-01-01",
      "Snippet: snip",
      "Content: body",
      "",
      "## 2. Untitled",
      "URL: https://b.example",
      "",
      "## 3. Untitled",
    ].join("\n"),
  );
});
