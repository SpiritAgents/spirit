import assert from "node:assert/strict";
import { test } from "vitest";

import {
  declaredProviderToolWirePatches,
  peekDeclaredProviderTools,
  resolveDeclaredProviderTools,
} from "./runtime.js";
import type { ProviderToolEntry } from "./types.js";

const EXECUTE_ENTRY: ProviderToolEntry = {
  label: "Web Search",
  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    },
  ],
  execute: { path: "/search", body: { text_query: "{arg.query}" } },
};

test("resolveDeclaredProviderTools merges literal function tools and recognizes execute bindings", async () => {
  const config = { apiKey: "k", baseUrl: "https://example.com/v1", providerTools: [EXECUTE_ENTRY] };
  const resolved = await resolveDeclaredProviderTools(config, new Set());

  assert.deepEqual([...resolved.recognizedNames], ["web_search"]);
  assert.equal(resolved.functionTools.length, 1);
  assert.equal(resolved.literalEntries.length, 0);
  assert.ok(resolved.executions.has("web_search"));
  assert.equal(resolved.executions.get("web_search")?.execute.path, "/search");
  assert.equal(resolved.display.get("web_search")?.label, "Web Search");
  assert.equal(resolved.display.get("web_search")?.suppressExpand, false);
  // The completed resolution is synchronously peekable.
  assert.equal(peekDeclaredProviderTools(config), resolved);
});

test("resolveDeclaredProviderTools merges literal transport-native entries and entry bodies", async () => {
  const config = {
    apiKey: "k",
    baseUrl: "https://example.com/anthropic/v1",
    providerTools: [
      {
        label: "Web Search",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
      {
        label: "Switch",
        body: { enable_search: true },
      },
    ] as ProviderToolEntry[],
  };
  const resolved = await resolveDeclaredProviderTools(config, new Set());

  assert.deepEqual(resolved.literalEntries, [{ type: "web_search_20250305", name: "web_search" }]);
  // The no-execute literal entry is recognized but not host-executed.
  assert.equal(resolved.executions.has("web_search"), false);
  assert.equal(resolved.recognizedNames.has("web_search"), true);
  assert.deepEqual(resolved.bodyPatches, [{ enable_search: true }]);
});

test("resolveDeclaredProviderTools preserves literal schemas and suppressExpand display", async () => {
  const config = { providerTools: [{ ...EXECUTE_ENTRY, ui: { expand: false } }] };
  const resolved = await resolveDeclaredProviderTools(config, new Set());

  assert.deepEqual([...resolved.executions.keys()], ["web_search"]);
  assert.deepEqual(resolved.executions.get("web_search")?.parameters, {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  });
  assert.equal(resolved.display.get("web_search")?.suppressExpand, true);
});

test("resolveDeclaredProviderTools applies the per-name collision filter (local wins)", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const config = {
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      providerTools: [
        {
          label: "Web Search",
          tools: [
            {
              type: "function",
              function: { name: "web_search", parameters: { type: "object", properties: {} } },
            },
            {
              type: "function",
              function: { name: "lookup", parameters: { type: "object", properties: {} } },
            },
          ],
          execute: { path: "/search" },
        },
      ] as ProviderToolEntry[],
    };
    const resolved = await resolveDeclaredProviderTools(config, new Set(["web_search"]));

    // web_search collides with a local tool and is skipped per-name; lookup survives on the same entry.
    assert.deepEqual([...resolved.recognizedNames], ["lookup"]);
    assert.equal(resolved.executions.has("web_search"), false);
    assert.equal(resolved.executions.has("lookup"), true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /web_search/);
  } finally {
    console.warn = originalWarn;
  }
});

test("resolveDeclaredProviderTools resolves to empty when providerToolsEnabled is false", async () => {
  const config = {
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    providerToolsEnabled: false,
    providerTools: [EXECUTE_ENTRY],
  };
  const resolved = await resolveDeclaredProviderTools(config, new Set());
  assert.equal(resolved.recognizedNames.size, 0);
  assert.equal(peekDeclaredProviderTools(config), undefined);
  assert.deepEqual(declaredProviderToolWirePatches(config), {
    literalEntries: [],
    bodyPatches: [],
  });
});

test("declaredProviderToolWirePatches reads literal entries and bodies synchronously", () => {
  const config = {
    apiKey: "k",
    providerTools: [
      {
        tools: [
          { type: "web_search_20250305", name: "web_search" },
          {
            type: "function",
            function: { name: "web_search", parameters: { type: "object", properties: {} } },
          },
        ],
        body: { enable_search: true },
      },
    ] as ProviderToolEntry[],
  };
  const patches = declaredProviderToolWirePatches(config);
  // Only non-function wire literals pass through here; function-shaped tools ride tools[] assembly.
  assert.deepEqual(patches.literalEntries, [{ type: "web_search_20250305", name: "web_search" }]);
  assert.deepEqual(patches.bodyPatches, [{ enable_search: true }]);
});
