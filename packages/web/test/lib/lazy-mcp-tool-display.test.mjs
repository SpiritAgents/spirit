import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveLazyMcpToolCallInputJson } from "../../src/lib/lazy-mcp-tool-display.ts";

test("MCP tool_call input extracts the model arguments as pretty JSON", () => {
  const excerpt = JSON.stringify(
    {
      provider: "mcp",
      server: "notes",
      tool: "search_notes",
      arguments: { query: "approval preview", limit: 5 },
    },
    null,
    2,
  );
  assert.equal(
    resolveLazyMcpToolCallInputJson(excerpt),
    '{\n  "query": "approval preview",\n  "limit": 5\n}',
  );
});

test("non-MCP providers keep the generic body", () => {
  const builtIn = JSON.stringify({
    provider: "built-in",
    server: "desktop",
    tool: "create_automation",
    arguments: { title: "x" },
  });
  assert.equal(resolveLazyMcpToolCallInputJson(builtIn), undefined);
});

test("truncated or malformed excerpts keep the generic body", () => {
  assert.equal(
    resolveLazyMcpToolCallInputJson('{\n  "provider": "mcp",\n  "server": "no...<truncated>'),
    undefined,
  );
  assert.equal(resolveLazyMcpToolCallInputJson("not json"), undefined);
  assert.equal(resolveLazyMcpToolCallInputJson('["mcp"]'), undefined);
});

test("missing arguments or missing excerpt keeps the generic body", () => {
  assert.equal(
    resolveLazyMcpToolCallInputJson(JSON.stringify({ provider: "mcp", server: "s", tool: "t" })),
    undefined,
  );
  assert.equal(resolveLazyMcpToolCallInputJson(undefined), undefined);
  assert.equal(resolveLazyMcpToolCallInputJson("  "), undefined);
});
