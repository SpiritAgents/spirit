import assert from "node:assert/strict";
import { test } from "vitest";

import {
  accumulateResponsesBuiltInToolPreviewsFromRawChunk,
  buildGatewaySdkProviderBuiltinToolResultArgumentsJson,
  buildResponsesBuiltInToolArgumentsJson,
  buildResponsesBuiltInToolCardData,
  formatDeepSeekInternalWebSearchDetail,
  isGenericProviderWebSearchQuery,
  isResponsesBuiltInToolName,
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhase,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
  responsesBuiltInToolNameFromOutputItemType,
} from "./responses-built-in-tools.js";

test("responsesBuiltInToolNameFromOutputItemType maps Responses output items", () => {
  assert.equal(responsesBuiltInToolNameFromOutputItemType("web_search_call"), "web_search");
  assert.equal(responsesBuiltInToolNameFromOutputItemType("web_extractor_call"), undefined);
  assert.equal(
    responsesBuiltInToolNameFromOutputItemType("code_interpreter_call"),
    "code_interpreter",
  );
  assert.equal(responsesBuiltInToolNameFromOutputItemType("function_call"), undefined);
});

test("isResponsesBuiltInToolName recognizes builtin tool names", () => {
  assert.equal(isResponsesBuiltInToolName("web_search"), true);
  assert.equal(isResponsesBuiltInToolName("web_fetch"), false);
});

test("buildResponsesBuiltInToolArgumentsJson extracts query and _spiritUi", () => {
  const json = buildResponsesBuiltInToolArgumentsJson(
    {
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "DeepSeek latest generation" },
    },
    "web_search",
  );
  const parsed = JSON.parse(json) as {
    query?: string;
    status?: string;
    _spiritUi?: { headlineDetail?: string; inputExcerpt?: string; suppressExpand?: boolean };
  };
  assert.equal(parsed.query, "DeepSeek latest generation");
  assert.equal(parsed.status, "completed");
  assert.equal(parsed._spiritUi?.headlineDetail, "DeepSeek latest generation");
  assert.equal(parsed._spiritUi?.suppressExpand, true);
  assert.equal(parsed._spiritUi?.inputExcerpt, "DeepSeek latest generation");
});

test("isGenericProviderWebSearchQuery detects Bailian placeholder query", () => {
  assert.equal(isGenericProviderWebSearchQuery("Web search"), true);
  assert.equal(isGenericProviderWebSearchQuery("DeepSeek V4"), false);
});

test("buildResponsesBuiltInToolCardData formats web_search sources", () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "Web search",
        sources: [
          { type: "url", url: "https://www.deepseek.com/" },
          { type: "url", url: "https://example.com/page" },
        ],
      },
    },
    "web_search",
  );
  assert.equal(card.sourceCount, 2);
  assert.equal(card.headlineDetail, undefined);
  assert.match(card.outputExcerpt ?? "", /deepseek\.com/);
  assert.equal(card.detailLines?.length, 2);
});

test("buildResponsesBuiltInToolCardData formats code_interpreter logs", () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: "code_interpreter_call",
      status: "completed",
      code: 'print("hello")',
      outputs: [{ type: "logs", logs: "hello\n" }],
    },
    "code_interpreter",
  );
  assert.equal(card.headlineDetail, 'print("hello")');
  assert.match(card.outputExcerpt ?? "", /hello/);
  assert.match(card.inputExcerpt, /print/);
});

test("parseResponsesBuiltInToolUiFromArgumentsJson reads embedded ui", () => {
  const json = buildResponsesBuiltInToolArgumentsJson(
    {
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "test query" },
    },
    "web_search",
  );
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(json);
  assert.equal(ui?.headlineDetail, "test query");
  assert.equal(ui?.suppressExpand, true);
});

test("resolveResponsesBuiltInToolStreamPhase maps terminal statuses", () => {
  assert.equal(
    resolveResponsesBuiltInToolStreamPhase({ type: "web_search_call", status: "completed" }),
    "succeeded",
  );
  assert.equal(
    resolveResponsesBuiltInToolStreamPhase({ type: "web_search_call", status: "in_progress" }),
    "preview",
  );
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(
      JSON.stringify({ status: "completed", query: "test" }),
    ),
    "succeeded",
  );
});

test("buildGatewaySdkProviderBuiltinToolResultArgumentsJson marks completed with output", () => {
  const json = buildGatewaySdkProviderBuiltinToolResultArgumentsJson(
    "web_search",
    { query: "latest models", max_results: 10 },
    {
      results: [{ title: "Example", url: "https://example.com/page", snippet: "hello" }],
      id: "search-1",
    },
    false,
  );
  assert.ok(json);
  assert.equal(resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(json!), "succeeded");
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(json!);
  assert.match(ui?.outputExcerpt ?? "", /example\.com/);
  assert.equal(ui?.sourceCount, 1);
});

test("buildGatewaySdkProviderBuiltinToolResultArgumentsJson marks failed on tool-error", () => {
  const json = buildGatewaySdkProviderBuiltinToolResultArgumentsJson(
    "web_search",
    { query: "latest models" },
    { error: "search failed" },
    true,
  );
  assert.ok(json);
  assert.equal(resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(json!), "failed");
});

test("accumulateResponsesBuiltInToolPreviewsFromRawChunk marks completed on output_item.done", () => {
  const result = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: "response.output_item.done",
      item: {
        type: "web_search_call",
        id: "ws_done",
        status: "completed",
        action: { type: "search", query: "DeepSeek generation" },
      },
    },
    0,
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.kind, "streaming-tool-preview");
  if (result.events[0]?.kind !== "streaming-tool-preview") {
    return;
  }
  const args = JSON.parse(result.events[0].argumentsJson) as {
    status?: string;
    _spiritUi?: { outputExcerpt?: string };
  };
  assert.equal(args.status, "completed");
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(result.events[0].argumentsJson),
    "succeeded",
  );
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(result.events[0].argumentsJson);
  assert.equal(ui?.headlineDetail, "DeepSeek generation");
  assert.equal(ui?.suppressExpand, true);
  assert.equal(ui?.sourceCount, undefined);
});

test("formatDeepSeekInternalWebSearchDetail joins search queries and strips call ids", () => {
  assert.equal(
    formatDeepSeekInternalWebSearchDetail({
      type: "search",
      queries: ["What is DeepSeek", "Which generation is GPT up to", "ws_call_id=call_00_abc"],
    }),
    "What is DeepSeek Which generation is GPT up to",
  );
});

test("formatDeepSeekInternalWebSearchDetail shows open_page url without ws_call_id suffix", () => {
  assert.equal(
    formatDeepSeekInternalWebSearchDetail({
      type: "open_page",
      url: "https://example.com/page#ws_call_id=call_01_xyz",
    }),
    "https://example.com/page",
  );
});

test("buildResponsesBuiltInToolCardData sets internalActionType for open_page", () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "open_page",
        url: "https://spirit.dev#ws_call_id=call_01",
      },
    },
    "web_search",
  );
  assert.equal(card.internalActionType, "open_page");
  assert.equal(card.headlineDetail, "https://spirit.dev");
  assert.equal(card.suppressExpand, true);
});

test("buildResponsesBuiltInToolCardData sets internalActionType for find_in_page", () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "find_in_page",
        url: "https://example.com/doc#ws_call_id=call_02",
      },
    },
    "web_search",
  );
  assert.equal(card.internalActionType, "find_in_page");
  assert.equal(card.headlineDetail, "https://example.com/doc");
});

test("buildResponsesBuiltInToolCardData keeps expandable sources for Bailian-style payloads", () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "Web search",
        sources: [{ type: "url", url: "https://example.com/" }],
      },
    },
    "web_search",
  );
  assert.equal(card.suppressExpand, undefined);
  assert.match(card.outputExcerpt ?? "", /example\.com/);
});
