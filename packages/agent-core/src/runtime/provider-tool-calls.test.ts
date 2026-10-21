import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { llmMessageTextContent } from "../ports.js";
import type { JsonValue, LlmMessage, ToolCallRequest } from "../ports.js";
import type { LlmTransportConfig } from "../provider-config.js";
import type { RuntimeEvent, RuntimeTurnContext } from "./types.js";
import { handleDeclaredProviderToolCallInTurn } from "./provider-tool-calls.js";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown> | undefined;
}

function providerToolsConfig(): LlmTransportConfig {
  return {
    transportKind: "openai-compatible",
    apiKey: "test-key",
    model: "k3",
    baseUrl: "https://api.example.com/v1",
    providerTools: [
      {
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
                additionalProperties: false,
              },
            },
          },
        ],
        execute: {
          path: "/search",
          body: { text_query: "{arg.query}" },
          resultsPath: "search_results",
          fields: { title: "title", url: "url" },
        },
      },
    ],
  };
}

function createRuntimeStub(config: LlmTransportConfig) {
  const historyStore: LlmMessage[] = [];
  const events: RuntimeEvent<unknown>[] = [];
  const runtime = {
    options: {
      config,
      toolExecutor: {
        toolDefinitionsJson: () => [] as JsonValue,
      },
      appendToolResultMessage: (
        state: { messages: JsonValue[]; steps: number },
        toolCallId: string,
        content: string,
      ) => {
        historyStore.push({
          role: "tool",
          toolCallId,
          content: [{ type: "text", text: content }],
        });
        return {
          messages: [
            ...state.messages,
            { role: "tool", tool_call_id: toolCallId, content } as JsonValue,
          ],
          steps: state.steps,
        };
      },
      extractAssistantText: () => "done",
      llmTransport: {
        startToolAgentRound: async (_config: unknown, state: { messages: JsonValue[] }) => ({
          kind: "success" as const,
          result: {
            state,
            step: { kind: "final-response-ready" as const },
            requestTrace: [],
          },
        }),
      },
    },
    historyStore,
    pendingUserTurnStore: undefined,
    loopEnabled: () => false,
    isBusy: () => false,
    appendTrace: () => {},
    completeTurn: () => {},
    clearStreamingUiState: () => {},
    emitEvent: (event: RuntimeEvent<unknown>) => events.push(event),
  };
  return { runtime, events, historyStore };
}

function createTurn(): RuntimeTurnContext<unknown> {
  return {
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
    autoCompactAttempts: 0,
    deferredUserGuidances: [],
    autoReviewCache: new Map(),
  } as unknown as RuntimeTurnContext<unknown>;
}

const SEARCH_CALL: ToolCallRequest = {
  id: "call_search",
  name: "web_search",
  argumentsJson: '{"query":"spirit agent"}',
};

test("a declared execute provider tool call is intercepted, executed, and committed", async () => {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({
      url,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    });
    return new Response(
      JSON.stringify({
        search_results: [{ title: "Spirit", url: "https://spirit.dev", content: "agent" }],
      }),
      { status: 200 },
    );
  });

  const config = providerToolsConfig();
  const { runtime, events, historyStore } = createRuntimeStub(config);
  try {
    const outcome = await handleDeclaredProviderToolCallInTurn(
      runtime as never,
      "search please",
      { messages: [], steps: 0 },
      SEARCH_CALL,
      [],
      createTurn(),
    );

    assert.equal(outcome.kind, "turn-result");
    // The declared execute endpoint was called with the interpolated body.
    assert.equal(captured[0]?.url, "https://api.example.com/v1/search");
    assert.deepEqual(captured[0]?.body, { text_query: "spirit agent" });
    // The result is committed into history as the tool result.
    const toolMessage = historyStore.find((message) => message.role === "tool");
    assert.match(toolMessage ? llmMessageTextContent(toolMessage.content) : "", /Spirit/);
    // Preview events bracket the execution (in_progress then completed).
    const previews = events.filter((event) => event.kind === "streaming-tool-preview");
    assert.equal(previews.length, 2);
    const finished = events.find((event) => event.kind === "tool-execution-finished");
    assert.ok(finished);
    assert.equal(finished.kind === "tool-execution-finished" && finished.execution.failed, false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("a schema violation returns the validation error as the tool result without an HTTP call", async () => {
  let httpCalls = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    httpCalls += 1;
    return new Response("{}", { status: 200 });
  });

  const config = providerToolsConfig();
  const { runtime, historyStore } = createRuntimeStub(config);
  try {
    const outcome = await handleDeclaredProviderToolCallInTurn(
      runtime as never,
      "search please",
      { messages: [], steps: 0 },
      { id: "call_bad", name: "web_search", argumentsJson: '{"max_results": 5}' },
      [],
      createTurn(),
    );

    assert.equal(outcome.kind, "turn-result");
    assert.equal(httpCalls, 0);
    const toolMessage = historyStore.find((message) => message.role === "tool");
    assert.match(
      toolMessage ? llmMessageTextContent(toolMessage.content) : "",
      /missing required argument "query"/,
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("an undeclared tool name is not intercepted", async () => {
  const config = providerToolsConfig();
  const { runtime } = createRuntimeStub(config);
  const outcome = await handleDeclaredProviderToolCallInTurn(
    runtime as never,
    "hi",
    { messages: [], steps: 0 },
    { id: "call_shell", name: "shell", argumentsJson: "{}" },
    [],
    createTurn(),
  );
  assert.equal(outcome.kind, "not-handled");
});

test("providerToolsEnabled=false intercepts nothing", async () => {
  const config = { ...providerToolsConfig(), providerToolsEnabled: false };
  const { runtime } = createRuntimeStub(config);
  const outcome = await handleDeclaredProviderToolCallInTurn(
    runtime as never,
    "hi",
    { messages: [], steps: 0 },
    SEARCH_CALL,
    [],
    createTurn(),
  );
  assert.equal(outcome.kind, "not-handled");
});
