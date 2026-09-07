import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildFormattedDisplayTitlesFromIds,
  formatTitleFromId,
  resolveModelDisplayTitle,
} from "./id-display-title.js";

test("formatTitleFromId replaces separators and title-cases words", () => {
  assert.equal(formatTitleFromId("gpt-4o-mini"), "Gpt 4o Mini");
  assert.equal(formatTitleFromId("anthropic/claude-sonnet-4"), "Anthropic Claude Sonnet 4");
  assert.equal(formatTitleFromId("foo:bar/baz"), "Foo Bar Baz");
  assert.equal(formatTitleFromId("  spaced--id  "), "Spaced Id");
  assert.equal(formatTitleFromId("fetch_mcp_resource"), "Fetch Mcp Resource");
  assert.equal(formatTitleFromId("system-prompt"), "System Prompt");
  assert.equal(formatTitleFromId("@example/spirit-extension"), "Example Spirit Extension");
});

test("formatTitleFromId merges consecutive numeric version segments", () => {
  assert.equal(formatTitleFromId("claude-opus-4-8"), "Claude Opus 4.8");
  assert.equal(formatTitleFromId("claude-3-5-sonnet"), "Claude 3.5 Sonnet");
  assert.equal(formatTitleFromId("gemini-2-5-flash"), "Gemini 2.5 Flash");
  assert.equal(formatTitleFromId("llama-3-1-8b"), "Llama 3.1 8b");
});

test("formatTitleFromId keeps empty input as-is", () => {
  assert.equal(formatTitleFromId(""), "");
  assert.equal(formatTitleFromId("   "), "   ");
});

test("formatTitleFromId applies whole-token casing overrides", () => {
  const casingOverrides = { foo: "FOO", barbaz: "BarBaz" };
  assert.equal(formatTitleFromId("foo-bar", { casingOverrides }), "FOO Bar");
  assert.equal(formatTitleFromId("FOO-bar", { casingOverrides }), "FOO Bar");
  assert.equal(formatTitleFromId("foobar", { casingOverrides }), "Foobar");
  assert.equal(formatTitleFromId("barbaz-4-8", { casingOverrides }), "BarBaz 4.8");
});

test("formatTitleFromId applies multi-token phrase overrides with longest match first", () => {
  const casingOverrides = { foo: "FOO", "foo bar": "FooBar" };
  assert.equal(formatTitleFromId("foo-bar-baz", { casingOverrides }), "FooBar Baz");
  assert.equal(formatTitleFromId("foo-qux", { casingOverrides }), "FOO Qux");
  assert.equal(formatTitleFromId("foo-barista", { casingOverrides }), "FOO Barista");
  assert.equal(formatTitleFromId("foo-bar-4-8", { casingOverrides }), "FooBar 4.8");
});

test("resolveModelDisplayTitle prefers catalog displayName", () => {
  assert.equal(
    resolveModelDisplayTitle({
      modelId: "openai/gpt-5",
      catalogDisplayName: "GPT-5",
      preserveRawIdWithoutCatalogDisplayName: true,
    }),
    "GPT-5",
  );
});

test("resolveModelDisplayTitle preserves raw id for catalog providers without displayName", () => {
  assert.equal(
    resolveModelDisplayTitle({
      modelId: "openai/gpt-5",
      preserveRawIdWithoutCatalogDisplayName: true,
    }),
    "openai/gpt-5",
  );
});

test("resolveModelDisplayTitle formats non-catalog model ids", () => {
  assert.equal(
    resolveModelDisplayTitle({
      modelId: "gpt-4o-mini",
    }),
    "GPT 4o Mini",
  );
});

test("resolveModelDisplayTitle applies well-known casing overrides", () => {
  assert.equal(resolveModelDisplayTitle({ modelId: "my-mcp-helper" }), "My MCP Helper");
});

test("buildFormattedDisplayTitlesFromIds only includes changed titles", () => {
  assert.deepEqual(buildFormattedDisplayTitlesFromIds(["gpt-4o-mini", "Foo"]), {
    "gpt-4o-mini": "GPT 4o Mini",
  });
});
