import assert from "node:assert/strict";
import { test } from "vitest";
import type { TextStreamPart } from "ai";

import type { ToolAgentRoundCompletion } from "../ports.js";
import { extractLastAssistantText, isJsonObject, type ToolAgentState } from "../tool-agent.js";
import {
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from "./responses-built-in-tools.js";
import { createDeferred, responsesEventStreamToRuntimeEvents } from "./streaming.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test",
  model: "deepseek/deepseek-v4-pro",
  sdk: "@ai-sdk/gateway",
};

async function collectGatewayToolRound(
  stream: AsyncIterable<TextStreamPart<any>>,
): Promise<Extract<ToolAgentRoundCompletion<ToolAgentState>, { kind: "success" }>> {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream,
    {},
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  return result;
}

test("gateway sdk stream skips resume when single-step metadata already has full answer", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "text-delta", id: "text-0", text: "Searching now." };
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("Searching now.\n\nLatest models include Example."),
    steps: Promise.resolve([{ text: "Searching now.\n\nLatest models include Example." }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, undefined);
  assert.equal(
    extractLastAssistantText(result.result.state),
    "Searching now.\n\nLatest models include Example.",
  );
});

test("gateway sdk stream merges final step text after executed web_search", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "text-delta", id: "text-0", text: "Searching now." };
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("Latest models include Example."),
    steps: Promise.resolve([
      { text: "Searching now." },
      { text: "Latest models include Example." },
    ]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, undefined);
  assert.equal(
    extractLastAssistantText(result.result.state),
    "Searching now.\n\nLatest models include Example.",
  );
});

test("gateway sdk stream persists provider search results before synthesis follow-up", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "text-delta", id: "text-0", text: "OK, let me search." };
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
  }

  const state: ToolAgentState = { messages: [{ role: "user", content: "search" }], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("OK, let me search."),
    steps: Promise.resolve([{ text: "OK, let me search." }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, true);
  assert.equal(result.result.state.messages.length, 3);
  const assistantMessage = result.result.state.messages.at(1);
  assert.ok(isJsonObject(assistantMessage));
  assert.equal(assistantMessage.content, "OK, let me search.");
  const toolMessage = result.result.state.messages.at(-1);
  assert.ok(isJsonObject(toolMessage));
  assert.equal(toolMessage.role, "tool");
  assert.match(String(toolMessage.content), /Example/);
});

test("gateway sdk stream skips resume when answer text follows web_search in same stream", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "text-delta", id: "text-0", text: "OK, let me search." };
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
    yield { type: "text-delta", id: "text-1", text: "\n\nThe final answer is here." };
  }

  const state: ToolAgentState = { messages: [{ role: "user", content: "search" }], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("OK, let me search.\n\nThe final answer is here."),
    steps: Promise.resolve([{ text: "OK, let me search.\n\nThe final answer is here." }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, undefined);
  assert.equal(
    extractLastAssistantText(result.result.state),
    "OK, let me search.\n\nThe final answer is here.",
  );
  assert.deepEqual(
    result.result.state.messages.map((message) =>
      isJsonObject(message) && typeof message.role === "string" ? message.role : "unknown",
    ),
    ["user", "assistant", "tool", "assistant"],
  );
  const providerCallMessage = result.result.state.messages.at(1);
  assert.ok(isJsonObject(providerCallMessage));
  assert.equal(providerCallMessage.content, null);
  assert.equal(Array.isArray(providerCallMessage.tool_calls), true);
  const providerResultMessage = result.result.state.messages.at(2);
  assert.ok(isJsonObject(providerResultMessage));
  assert.match(String(providerResultMessage.content), /Example/);
});

test("gateway sdk stream omits executed web_search from host tool-calls step", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
    yield { type: "text-delta", id: "text-0", text: "Latest models include Example." };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("Latest models include Example."),
    steps: Promise.resolve([{ text: "" }, { text: "Latest models include Example." }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("expected success completion");
  }
  const round = result.result;
  assert.equal(round.step.kind, "final-response-ready");
  assert.equal(extractLastAssistantText(round.state), "Latest models include Example.");
  const lastMessage = round.state.messages.at(-1);
  assert.ok(lastMessage && typeof lastMessage === "object" && !Array.isArray(lastMessage));
  assert.equal("tool_calls" in lastMessage, false);
});

test("gateway sdk stream emits succeeded web_search preview on tool-result", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: "tool-call",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
    };
    yield {
      type: "tool-result",
      toolCallId: "call_search",
      toolName: "web_search",
      input: { query: "latest models" },
      output: {
        results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
        id: "search-1",
      },
    };
    yield { type: "text-delta", id: "text-0", text: "Latest models include Example." };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve("Latest models include Example."),
    steps: Promise.resolve([{ text: "" }, { text: "Latest models include Example." }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  const previewEvents: Array<{
    toolCallId: string;
    argumentsJson: string;
  }> = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    if (event.kind === "streaming-tool-preview" && event.toolName === "web_search") {
      previewEvents.push({
        toolCallId: event.toolCallId,
        argumentsJson: event.argumentsJson,
      });
    }
  }

  assert.ok(previewEvents.length >= 2);
  const succeededPreview = previewEvents.find(
    (preview) =>
      resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(preview.argumentsJson) ===
      "succeeded",
  );
  assert.ok(succeededPreview);
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(succeededPreview!.argumentsJson);
  assert.match(ui?.outputExcerpt ?? "", /example\.com/);
});

test("gateway sdk stream aggregates tool-input/tool-call without Open Responses raw items", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "reasoning-delta", id: "reasoning-0", text: "Plan to run shell." };
    yield { type: "tool-input-start", id: "call_gateway_shell", toolName: "shell" };
    yield {
      type: "tool-input-delta",
      id: "call_gateway_shell",
      delta: '{"reason":"Echo","command":"echo nb"}',
    };
    yield { type: "tool-input-end", id: "call_gateway_shell" };
    yield {
      type: "tool-call",
      toolCallId: "call_gateway_shell",
      toolName: "shell",
      input: { reason: "Echo", command: "echo nb" },
    };
  }

  const completion = await collectGatewayToolRound(stream());
  const round = completion.result;
  assert.equal(round.step.kind, "tool-calls");
  if (round.step.kind !== "tool-calls") {
    throw new Error("expected tool-calls step");
  }

  assert.equal(round.step.calls.length, 1);
  assert.equal(round.step.calls[0]?.id, "call_gateway_shell");
  assert.equal(round.step.calls[0]?.name, "shell");
  assert.equal(extractLastAssistantText(round.state), undefined);
});
