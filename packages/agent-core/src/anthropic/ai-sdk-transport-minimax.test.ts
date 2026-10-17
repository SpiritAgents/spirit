import assert from "node:assert/strict";
import { test } from "vitest";

import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import {
  AiSdkAnthropicTransport,
  convertAnthropicToolStateMessagesForTests,
} from "./ai-sdk-transport.js";
import { ANTHROPIC_ASSISTANT_CONTENT_BLOCKS_KEY } from "./minimax-web-search-stream.js";

test("MiniMax anthropic transport uses minimax anthropic endpoint", async () => {
  const capturedUrls: string[] = [];
  setLlmFetchTransportOverrideForTests(async (input) => {
    capturedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "MiniMax-M3",
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkAnthropicTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        transportKind: "anthropic",
        apiKey: "test-key",
        model: "MiniMax-M3",
        baseUrl: "https://api.minimax.io/anthropic/v1",
        sdk: "@ai-sdk/minimax",
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hi" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    assert.ok(capturedUrls.some((url) => url.includes("api.minimax.io/anthropic/v1/messages")));
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("MiniMax anthropic code-completion profile turns thinking off via the declared switch", () => {
  const profiled = applyCodeCompletionTransportProfile({
    transportKind: "anthropic",
    apiKey: "test-key",
    model: "MiniMax-M3",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    sdk: "@ai-sdk/minimax",
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  });

  assert.equal(profiled.transportRequestProfile, "code-completion");
  if (profiled.transportKind === "anthropic") {
    assert.equal(profiled.vendorExtendedThinking, false);
  }
});

test("MiniMax web search replay keeps reasoning parts in follow-up AI SDK messages", () => {
  const minimaxConfig = {
    transportKind: "anthropic" as const,
    apiKey: "test-key",
    model: "MiniMax-M3",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    llmVendor: "minimax" as const,
    workspaceRoot: process.cwd(),
  };

  const converted = convertAnthropicToolStateMessagesForTests(
    [
      { role: "user", content: "Beijing weather" },
      {
        role: "assistant",
        content: "Here is the weather summary.",
        reasoning_parts: [
          {
            type: "reasoning",
            text: "I should search for current weather first.",
          },
        ],
        [ANTHROPIC_ASSISTANT_CONTENT_BLOCKS_KEY]: [
          {
            type: "server_tool_use",
            id: "call_search",
            name: "web_search",
            input: { query: "Beijing weather" },
          },
          { type: "text", text: "ignored block text" },
        ],
      },
      { role: "user", content: "Thanks, what about tomorrow?" },
    ],
    minimaxConfig,
  );

  const replayedAssistant = converted.find((message) => message.role === "assistant");
  assert.ok(replayedAssistant);
  assert.ok(Array.isArray(replayedAssistant.content));
  const content = replayedAssistant.content as Array<Record<string, unknown>>;
  assert.equal(content.length, 2);
  assert.equal(content[0]?.type, "reasoning");
  assert.match(String(content[0]?.text), /search for current weather/);
  assert.equal(content[1]?.type, "text");
  assert.match(String(content[1]?.text), /weather summary/);
});
