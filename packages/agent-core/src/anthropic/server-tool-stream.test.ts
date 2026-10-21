import assert from "node:assert/strict";
import { test } from "vitest";
import type { TextStreamPart } from "ai";

import {
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from "../open-responses/responses-built-in-tools.js";
import {
  createAnthropicServerToolStreamState,
  filterAnthropicServerToolCalls,
  handleAnthropicServerToolStreamPart,
  resolveAnthropicServerToolAssistantReplayText,
  shouldSuppressAnthropicServerToolStreamError,
} from "./server-tool-stream.js";

const SERVER_TOOL_NAMES = new Set(["web_search"]);

const probeResults = [
  {
    type: "web_search_result",
    title: "Shanghai weather today",
    url: "https://www.tianqi.com/shanghai/today/",
    content: "多云 28 ~ 36℃",
  },
];

test("server tool stream part emits preview then the succeeded card", () => {
  const state = createAnthropicServerToolStreamState(SERVER_TOOL_NAMES);
  const events: Array<{ kind: string; toolName?: string; argumentsJson?: string }> = [];

  const push = (part: TextStreamPart<any>) => {
    handleAnthropicServerToolStreamPart(part, state, events as never);
  };

  push({
    type: "tool-input-start",
    id: "call_search",
    toolName: "web_search",
  });
  push({
    type: "tool-input-delta",
    id: "call_search",
    delta: '{"query":"Shanghai weather today"}',
  });
  push({
    type: "tool-call",
    toolCallId: "call_search",
    toolName: "web_search",
    input: { query: "Shanghai weather today" },
  });
  push({
    type: "raw",
    rawValue: {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "call_search",
        content: probeResults,
      },
    },
  });
  push({
    type: "tool-error",
    toolCallId: "call_search",
    toolName: "web_search",
    input: { query: "Shanghai weather today" },
    error: new Error("web_search_tool_result validation failed"),
  });

  assert.equal(events.length, 3);
  assert.equal(events[0]?.kind, "streaming-tool-preview");
  assert.equal(events[0]?.toolName, "web_search");
  assert.match(events[0]?.argumentsJson ?? "", /Shanghai weather today/);
  assert.equal(events[2]?.kind, "streaming-tool-preview");
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(events[2]?.argumentsJson ?? ""),
    "succeeded",
  );
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(events[2]?.argumentsJson ?? "");
  assert.ok(ui?.sourceCount === 1);
  assert.ok(state.executedProviderBuiltinToolCallIds.has("call_search"));
  assert.equal(
    shouldSuppressAnthropicServerToolStreamError(
      new Error("web_search_tool_result validation failed"),
      state,
    ),
    true,
  );
});

test("server tool stream part ignores undeclared tool names", () => {
  const state = createAnthropicServerToolStreamState(SERVER_TOOL_NAMES);
  const events: Array<{ kind: string }> = [];

  const result = handleAnthropicServerToolStreamPart(
    { type: "tool-call", toolCallId: "call_other", toolName: "code_interpreter", input: {} },
    state,
    events as never,
  );

  assert.equal(result.handled, false);
  assert.equal(events.length, 0);
  assert.equal(state.executedProviderBuiltinToolCallIds.size, 0);
});

test("server tool stream part records anthropic content blocks", () => {
  const state = createAnthropicServerToolStreamState(SERVER_TOOL_NAMES);
  const events: never[] = [];

  handleAnthropicServerToolStreamPart(
    {
      type: "raw",
      rawValue: {
        type: "content_block_start",
        content_block: {
          type: "server_tool_use",
          id: "call_search",
          name: "web_search",
          input: { query: "Beijing weather today" },
        },
      },
    },
    state,
    events,
  );

  handleAnthropicServerToolStreamPart(
    {
      type: "raw",
      rawValue: {
        type: "content_block_start",
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "call_search",
          content: probeResults,
        },
      },
    },
    state,
    events,
  );

  assert.equal(state.anthropicContentBlocks.length, 2);
  assert.equal((state.anthropicContentBlocks[0] as { type?: string }).type, "server_tool_use");
});

test("filterAnthropicServerToolCalls drops executed server tool calls by name", () => {
  const state = createAnthropicServerToolStreamState(SERVER_TOOL_NAMES);
  state.executedProviderBuiltinToolCallIds.add("call_search");

  const calls = [
    { id: "call_search", name: "web_search" },
    { id: "call_shell", name: "shell" },
  ];
  assert.deepEqual(filterAnthropicServerToolCalls(calls, state), [
    { id: "call_shell", name: "shell" },
  ]);
});

test("resolveAnthropicServerToolAssistantReplayText prefers message.content", () => {
  assert.match(
    resolveAnthropicServerToolAssistantReplayText(
      { role: "assistant", content: "Full merged answer." },
      [{ type: "text", text: "partial" }],
    ),
    /Full merged answer/,
  );
});
