import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import {
  collectDeclaredProviderToolNames,
  resolveProviderEndpointUrl,
  resolveProviderToolNamesAgainstLocal,
} from "./resolve.js";

afterEach(() => {
  vi.restoreAllMocks();
});

test("collectDeclaredProviderToolNames collects function names and skips other shapes", () => {
  const names = collectDeclaredProviderToolNames([
    {
      tools: [
        { type: "function", function: { name: "web_search" } },
        { type: "web_search_20250305", name: "web_search" },
        { type: "function", function: { name: "web_search" } },
      ],
    },
    { body: { enable_search: true } },
    { tools: [{ type: "function", function: { name: "run_code" } }] },
  ]);
  assert.deepEqual([...names], ["web_search", "run_code"]);
});

test("resolveProviderToolNamesAgainstLocal passes through non-colliding names", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { names, skipped } = resolveProviderToolNamesAgainstLocal(
    ["web_search", "run_code"],
    new Set(["read_file"]),
  );
  assert.deepEqual([...names], ["web_search", "run_code"]);
  assert.deepEqual(skipped, []);
  assert.equal(warn.mock.calls.length, 0);
});

test("resolveProviderToolNamesAgainstLocal skips collisions per-name, local wins, one warning each", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { names, skipped } = resolveProviderToolNamesAgainstLocal(
    ["web_search", "run_code", "web_search"],
    new Set(["web_search"]),
  );
  assert.deepEqual([...names], ["run_code"]);
  assert.deepEqual(skipped, ["web_search"]);
  assert.equal(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0]?.[0]), /"web_search"/);
});

test("resolveProviderEndpointUrl joins path onto apiBase and honors url override", () => {
  assert.equal(
    resolveProviderEndpointUrl("https://api.example.com/v1", { path: "/search" }),
    "https://api.example.com/v1/search",
  );
  assert.equal(
    resolveProviderEndpointUrl("https://api.example.com/v1/", { path: "search" }),
    "https://api.example.com/v1/search",
  );
  assert.equal(
    resolveProviderEndpointUrl("https://api.example.com/v1", {
      path: "/search",
      url: "https://other.example.com/execute",
    }),
    "https://other.example.com/execute",
  );
});

test("resolveProviderEndpointUrl throws without a resolvable endpoint", () => {
  assert.throws(() => resolveProviderEndpointUrl("", { path: "/search" }), /Cannot resolve/);
  assert.throws(
    () => resolveProviderEndpointUrl("https://api.example.com/v1", {}),
    /Cannot resolve/,
  );
});
