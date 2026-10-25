import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "../openai/ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "../openai/openai-compat.js";
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from "../openai/tool-agent-helpers.js";
import type { JsonObject } from "../ports.js";
import { isOpenAiFunctionToolEntry } from "../provider-tools/types.js";
import { validateProviderToolArguments } from "../provider-tools/validate.js";
import { AgentRuntime } from "../runtime.js";
import { DemoToolExecutor } from "../smoke/shared/demo-tool.js";
import { materializeProviderPreset } from "./materialize.js";

const MOONSHOT_BASE_URL = "https://moonshot.test/v1";
const SEARCH_CALL_ID = "call_provider_search";
const FINAL_ASSISTANT_TEXT = "SEARCH_COMPLETE";

const MOONSHOT_SEARCH_PAYLOAD = {
  search_results: [
    {
      authority: "high",
      date: "2026-10-24",
      icon: "https://assets.example/favicon.ico",
      mime: "text/html",
      site_name: "Example",
      snippet: "A complete search snippet.",
      title: "Example result",
      url: "https://example.com/result",
      chunks: [{ text: "The full chunk text.", score: 0.98 }],
    },
  ],
  future_metadata: { opaque: ["preserved", 42] },
};
const MOONSHOT_RAW_RESULT = JSON.stringify(MOONSHOT_SEARCH_PAYLOAD);

interface CapturedRequest {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function moonshotMaterializedEntry() {
  return materializeProviderPreset({
    presetId: "moonshot-ai",
    apiBaseOverride: MOONSHOT_BASE_URL,
  });
}

function moonshotConfig(): OpenAiTransportConfig {
  const entry = moonshotMaterializedEntry();
  return {
    apiKey: "test-key",
    model: "kimi-k3",
    baseUrl: entry.apiBase,
    ...(entry.sdk !== undefined ? { sdk: entry.sdk } : {}),
    ...(entry.providerTools !== undefined ? { providerTools: entry.providerTools } : {}),
    workspaceRoot: process.cwd(),
  };
}

function moonshotParameters(): JsonObject {
  const tool = moonshotMaterializedEntry().providerTools?.[0]?.tools?.[0];
  assert.ok(tool && isOpenAiFunctionToolEntry(tool));
  const parameters = tool.function.parameters;
  assert.ok(parameters);
  return parameters;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function runProviderSearchTurn(options: {
  config: OpenAiTransportConfig;
  arguments: JsonObject;
  searchPath: string;
  searchPayload: JsonObject;
}) {
  const requests: CapturedRequest[] = [];
  const baseUrl = options.config.baseUrl;
  assert.ok(baseUrl);
  let chatRound = 0;

  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({ url, method, ...(body !== undefined ? { body } : {}) });

    if (method === "POST" && url === `${baseUrl}/chat/completions`) {
      chatRound += 1;
      if (chatRound === 1) {
        return jsonResponse({
          id: "chatcmpl-provider-search-call",
          object: "chat.completion",
          created: 0,
          model: options.config.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: SEARCH_CALL_ID,
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: JSON.stringify(options.arguments),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      if (chatRound === 2) {
        return jsonResponse({
          id: "chatcmpl-provider-search-final",
          object: "chat.completion",
          created: 0,
          model: options.config.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: FINAL_ASSISTANT_TEXT },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
    }

    if (method === "POST" && url === `${baseUrl}${options.searchPath}`) {
      return jsonResponse(options.searchPayload);
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  const runtime = new AgentRuntime({
    config: options.config,
    llmTransport: new AiSdkOpenAiCompatibleTransport(),
    toolExecutor: new DemoToolExecutor(),
    createToolAgentState: (messages, userInput) =>
      startOpenAiToolAgentState(messages, userInput, process.cwd(), [], [], options.config.model),
    appendToolResultMessage: appendOpenAiToolResultMessage,
    extractAssistantText: extractLastOpenAiAssistantText,
  });

  try {
    const result = await runtime.submitUserTurn("Search and summarize the result.");
    return { requests, result };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function runMoonshotSearch(argumentsJson: JsonObject) {
  return runProviderSearchTurn({
    config: moonshotConfig(),
    arguments: argumentsJson,
    searchPath: "/tools/search_pro",
    searchPayload: MOONSHOT_SEARCH_PAYLOAD,
  });
}

test("Moonshot Pro search preserves argument types and the complete response in the next Chat round", async () => {
  const { requests, result } = await runMoonshotSearch({
    query: "Spirit standalone search",
    max_results: 7,
    sites: ["example.com", "docs.example.org"],
    time_window: { start: "2026-01", end: "2026-10-25" },
  });

  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
      { method: "POST", url: `${MOONSHOT_BASE_URL}/tools/search_pro` },
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
    ],
  );
  assert.deepEqual(requests[1]?.body, {
    text_query: "Spirit standalone search",
    limit: 7,
    sites: ["example.com", "docs.example.org"],
    time_window: { start: "2026-01", end: "2026-10-25" },
  });
  assert.equal(Number.isInteger(requests[1]?.body?.limit), true);
  assert.equal(Array.isArray(requests[1]?.body?.sites), true);

  const chatRequests = requests.filter((request) => request.url.endsWith("/chat/completions"));
  const firstChatBody = chatRequests[0]?.body;
  assert.ok(firstChatBody);
  const tools = firstChatBody.tools;
  assert.ok(Array.isArray(tools));
  const searchTool = tools.find(
    (tool) =>
      typeof tool === "object" &&
      tool !== null &&
      (tool as { function?: { name?: string } }).function?.name === "web_search",
  ) as { type?: string; function?: { parameters?: unknown } } | undefined;
  assert.ok(searchTool);
  assert.equal(searchTool.type, "function");
  assert.deepEqual(searchTool.function?.parameters, moonshotParameters());

  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") {
    return;
  }
  assert.equal(result.assistantText, FINAL_ASSISTANT_TEXT);
  const execution = result.toolExecutions.find((item) => item.toolName === "web_search");
  assert.equal(execution?.failed, false);
  assert.equal(execution?.output, MOONSHOT_RAW_RESULT);

  const secondChatBody = chatRequests[1]?.body;
  assert.ok(secondChatBody);
  const messages = secondChatBody.messages;
  assert.ok(Array.isArray(messages));
  const toolMessage = messages.find(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: string }).role === "tool" &&
      (message as { tool_call_id?: string }).tool_call_id === SEARCH_CALL_ID,
  ) as { content?: unknown } | undefined;
  assert.equal(toolMessage?.content, MOONSHOT_RAW_RESULT);
  assert.deepEqual(
    result.requestTrace.map((trace) =>
      typeof trace === "object" && trace !== null && !Array.isArray(trace) ? trace.kind : undefined,
    ),
    ["openai_sdk_chat_completions", "openai_sdk_chat_completions"],
  );
});

test("Moonshot Pro search omits every optional field when only query is provided", async () => {
  const { requests, result } = await runMoonshotSearch({ query: "Spirit" });

  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
      { method: "POST", url: `${MOONSHOT_BASE_URL}/tools/search_pro` },
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
    ],
  );
  assert.deepEqual(requests[1]?.body, { text_query: "Spirit" });
  assert.equal("timeout_seconds" in (requests[1]?.body ?? {}), false);
  assert.equal("include_content" in (requests[1]?.body ?? {}), false);
  assert.equal(result.kind, "completed");
});

test("Moonshot Pro search schema enforces required arguments, bounds, and unknown keys", () => {
  const parameters = moonshotParameters();
  const validate = (argumentsJson: JsonObject) =>
    validateProviderToolArguments("web_search", JSON.stringify(argumentsJson), parameters);

  assert.match(validate({}) ?? "", /missing required argument "query"/);
  assert.equal(validate({ query: "q", max_results: 1 }), undefined);
  assert.equal(validate({ query: "q", max_results: 20 }), undefined);
  assert.match(validate({ query: "q", max_results: 0 }) ?? "", /must be >= 1/);
  assert.match(validate({ query: "q", max_results: 21 }) ?? "", /must be <= 20/);
  assert.match(validate({ query: "q", extra: true }) ?? "", /unknown argument "extra"/);
});

test("Moonshot Pro search rejects timeout_seconds without calling the search endpoint", async () => {
  const { requests, result } = await runMoonshotSearch({ query: "Spirit", timeout_seconds: 5 });

  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
      { method: "POST", url: `${MOONSHOT_BASE_URL}/chat/completions` },
    ],
  );
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") {
    return;
  }
  const execution = result.toolExecutions.find((item) => item.toolName === "web_search");
  assert.equal(execution?.failed, true);
  assert.match(execution?.output ?? "", /unknown argument "timeout_seconds"/);
});
