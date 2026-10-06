import assert from "node:assert/strict";
import { test } from "vitest";

import { formatLazyToolCallDetail } from "../../src/lib/lazy-tool-call-display.ts";

test("MCP detail formats server and tool in UI casing and drops the provider", () => {
  assert.equal(formatLazyToolCallDetail("mcp", "notes", "search_notes"), "Notes Search Notes");
  assert.equal(
    formatLazyToolCallDetail("mcp", "microsoft-learn", "microsoft_docs_search"),
    "Microsoft Learn Microsoft Docs Search",
  );
});

test("well-known casing overrides apply to server and tool tokens", () => {
  assert.equal(formatLazyToolCallDetail("mcp", "github", "search_code"), "GitHub Search Code");
  assert.equal(
    formatLazyToolCallDetail("mcp", "ai_assistant", "ai_search"),
    "AI Assistant AI Search",
  );
});

test("non-MCP providers keep the provider as a raw prefix", () => {
  assert.equal(
    formatLazyToolCallDetail("custom", "notes", "search_notes"),
    "custom / Notes Search Notes",
  );
  assert.equal(
    formatLazyToolCallDetail("built-in", "desktop", "create_automation"),
    "built-in / Desktop Create Automation",
  );
});

test("empty segments collapse without stray separators", () => {
  assert.equal(formatLazyToolCallDetail("mcp", "", ""), "");
  assert.equal(formatLazyToolCallDetail("mcp", "notes", ""), "Notes");
  assert.equal(formatLazyToolCallDetail("", "notes", "search_notes"), "Notes Search Notes");
});
