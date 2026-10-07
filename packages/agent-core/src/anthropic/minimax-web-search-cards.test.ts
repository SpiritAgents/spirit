import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from "../open-responses/responses-built-in-tools.js";
import {
  buildMinimaxWebSearchServerToolEntry,
  createMinimaxAnthropicServerToolsFetch,
  MINIMAX_WEB_SEARCH_SERVER_TOOL_TYPE,
} from "./minimax-server-tools.js";
import {
  buildMinimaxWebSearchPreviewArgumentsJson,
  buildMinimaxWebSearchSucceededArgumentsJson,
  mapMinimaxWebSearchResultsToActionSources,
  parseMinimaxWebSearchResults,
} from "./minimax-web-search-cards.js";

const liveProbeResults = [
  {
    type: "web_search_result",
    title: "Release Notes for the Example Engine",
    url: "https://example.dev/docs/engine/release-notes",
    page_age: "2026-06-09 02:31:19",
    content: "Highlights of the latest engine release and upgrade notes.",
  },
  {
    type: "web_search_result",
    title: "Engine Changelog",
    url: "http://docs.example.dev/engine/changelog",
    page_age: "2026-07-20 18:05:00",
    content: "Full changelog covering every engine version.",
  },
];

test("buildMinimaxWebSearchServerToolEntry includes doc-versioned type", () => {
  assert.deepEqual(buildMinimaxWebSearchServerToolEntry(), {
    type: MINIMAX_WEB_SEARCH_SERVER_TOOL_TYPE,
    name: "web_search",
  });
});

test("createMinimaxAnthropicServerToolsFetch injects web_search tool into messages body", async () => {
  let capturedBody: string | undefined;

  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = typeof init?.body === "string" ? init.body : undefined;
    return new Response("{}", { status: 200 });
  };

  const patched = createMinimaxAnthropicServerToolsFetch(fetchImpl, { webSearchEnabled: true });
  await patched("https://api.minimax.cn/anthropic/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "MiniMax-M3", messages: [] }),
  });

  assert.ok(capturedBody);
  const parsed = JSON.parse(capturedBody) as { tools?: unknown[] };
  assert.deepEqual(parsed.tools, [buildMinimaxWebSearchServerToolEntry()]);
});

test("mapMinimaxWebSearchResultsToActionSources maps title url snippet", () => {
  const sources = mapMinimaxWebSearchResultsToActionSources(
    parseMinimaxWebSearchResults(liveProbeResults),
  );
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.type, "url");
  assert.equal(sources[0]?.url, "https://example.dev/docs/engine/release-notes");
  assert.match(String(sources[0]?.title), /Release Notes/);
  assert.match(String(sources[0]?.snippet), /engine release/);
});

test("buildMinimaxWebSearchSucceededArgumentsJson produces Gateway-compatible _spiritUi", () => {
  const argumentsJson = buildMinimaxWebSearchSucceededArgumentsJson(
    "engine release notes",
    parseMinimaxWebSearchResults(liveProbeResults),
  );
  const parsed = JSON.parse(argumentsJson) as { query?: string; action?: { query?: string } };

  assert.equal(parsed.query, "engine release notes");
  assert.equal(parsed.action?.query, "engine release notes");
  assert.equal(resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(argumentsJson), "succeeded");

  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(argumentsJson);
  assert.ok(ui);
  assert.match(ui!.inputExcerpt, /engine release notes/);
  assert.equal(ui!.sourceCount, 2);
  assert.ok(ui!.outputExcerpt?.includes("example.dev"));
  assert.ok(ui!.detailLines && ui!.detailLines.length >= 2);
});

test("buildMinimaxWebSearchPreviewArgumentsJson exposes query for streaming preview", () => {
  assert.equal(
    buildMinimaxWebSearchPreviewArgumentsJson("engine release notes"),
    '{"query":"engine release notes"}',
  );
});
