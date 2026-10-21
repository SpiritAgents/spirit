import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import {
  clearProviderToolsFromCacheForTests,
  fetchProviderToolsFrom,
  PROVIDER_TOOLS_FROM_CACHE_TTL_MS,
} from "./tools-from.js";

afterEach(() => {
  clearProviderToolsFromCacheForTests();
  vi.useRealTimers();
});

const FUNCTION_TOOL = {
  type: "function",
  function: { name: "web_search", parameters: { type: "object" } },
};

test("fetchProviderToolsFrom GETs apiBase+path with Bearer and filters to function-shaped entries", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        tools: [
          FUNCTION_TOOL,
          { type: "moonshot_formula", formula_uri: "moonshot/web-search:latest" },
          { type: "function", function: { name: "" } },
        ],
      }),
      { status: 200 },
    );
  };

  const tools = await fetchProviderToolsFrom(
    { path: "/formulas/moonshot/web-search:latest/tools" },
    { apiBase: "https://api.example.com/v1/", apiKey: "k", fetchImpl: fetchImpl as typeof fetch },
  );

  assert.equal(capturedUrl, "https://api.example.com/v1/formulas/moonshot/web-search:latest/tools");
  assert.equal(capturedInit?.method, "GET");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer k");
  assert.deepEqual(tools, [FUNCTION_TOOL]);
});

test("fetchProviderToolsFrom prefers the absolute url and reads a custom listPath", async () => {
  let capturedUrl = "";
  const fetchImpl = async (input: RequestInfo | URL) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ data: { list: [FUNCTION_TOOL] } }), { status: 200 });
  };

  const tools = await fetchProviderToolsFrom(
    { path: "/ignored", url: "https://tools.example.com/list", listPath: "data.list" },
    { apiBase: "https://api.example.com/v1", apiKey: "k", fetchImpl: fetchImpl as typeof fetch },
  );

  assert.equal(capturedUrl, "https://tools.example.com/list");
  assert.deepEqual(tools, [FUNCTION_TOOL]);
});

test("fetchProviderToolsFrom yields an empty list when listPath is not an array", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ tools: { nope: true } }), { status: 200 });
  const tools = await fetchProviderToolsFrom(
    { path: "/tools" },
    { apiBase: "https://api.example.com/v1", apiKey: "k", fetchImpl: fetchImpl as typeof fetch },
  );
  assert.deepEqual(tools, []);
});

test("fetchProviderToolsFrom caches per URL+key within the TTL and refetches after expiry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ tools: [FUNCTION_TOOL] }), { status: 200 });
  };
  const options = {
    apiBase: "https://api.example.com/v1",
    apiKey: "k",
    fetchImpl: fetchImpl as typeof fetch,
  };

  await fetchProviderToolsFrom({ path: "/tools" }, options);
  await fetchProviderToolsFrom({ path: "/tools" }, options);
  assert.equal(calls, 1);

  await fetchProviderToolsFrom({ path: "/tools" }, { ...options, apiKey: "other" });
  assert.equal(calls, 2);

  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + PROVIDER_TOOLS_FROM_CACHE_TTL_MS + 1);
  await fetchProviderToolsFrom({ path: "/tools" }, options);
  assert.equal(calls, 3);
});

test("fetchProviderToolsFrom throws on a non-OK response", async () => {
  const fetchImpl = async () => new Response("boom", { status: 500 });
  await assert.rejects(
    fetchProviderToolsFrom(
      { path: "/tools" },
      { apiBase: "https://api.example.com/v1", apiKey: "k", fetchImpl: fetchImpl as typeof fetch },
    ),
    /failed \(500\): boom/,
  );
});
