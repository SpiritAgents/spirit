import assert from "node:assert/strict";
import { test } from "vitest";

import { createLlmMessageContentFromText, type LlmMessage } from "../ports.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkAnthropicTransport } from "./ai-sdk-transport.js";

test("image input survives capability filtering when video input is undeclared", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "msg_image_input",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const result = await new AiSdkAnthropicTransport().startToolAgentRound(
      {
        transportKind: "anthropic",
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "http://127.0.0.1:18080/v1",
        modelCapabilities: { languageModel: true, imageInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
            ],
          },
        ],
        steps: 0,
      },
      [],
    );
    assert.equal(result.kind, "success");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }

  const messages = capturedBody?.messages as Array<Record<string, unknown>>;
  const content = messages[0]?.content as Array<Record<string, unknown>>;
  assert.equal(content[0]?.type, "text");
  assert.equal(content[1]?.type, "image");
  assert.deepEqual(content[1]?.source, {
    type: "base64",
    media_type: "image/png",
    data: "aGVsbG8=",
  });
});

test("llmHistoryAsApiMessages serializes image and video user parts", () => {
  const transport = new AiSdkAnthropicTransport();
  const history: LlmMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image", path: "shot.png" },
        { type: "video", path: "clip.mp4" },
      ],
    },
  ];

  const messages = transport.llmHistoryAsApiMessages(history);
  assert.equal(messages.length, 1);

  const user = messages[0] as {
    role: string;
    content: Array<Record<string, unknown>>;
  };
  assert.equal(user.role, "user");
  assert.equal(user.content.length, 3);
  assert.equal(user.content[0]?.type, "text");
  assert.equal(user.content[1]?.type, "image_url");
  assert.equal(user.content[2]?.type, "video_url");
});

test("llmHistoryAsApiMessages preserves anthropic providerState for assistant tool calls", () => {
  const transport = new AiSdkAnthropicTransport();
  const history: LlmMessage[] = [
    {
      role: "assistant",
      content: createLlmMessageContentFromText("calling weather"),
      toolCalls: [
        {
          id: "call_weather",
          name: "get_weather",
          argumentsJson: '{"city":"Paris"}',
        },
      ],
      providerState: {
        reasoning_parts: [
          {
            type: "reasoning",
            text: "Let me verify the tool input first.",
            providerOptions: {
              anthropic: {
                signature: "sig_demo",
              },
            },
          },
        ],
        reasoning_content: "Let me verify the tool input first.",
      },
    },
  ];

  const messages = transport.llmHistoryAsApiMessages(history);
  assert.equal(messages.length, 1);

  const assistant = messages[0] as {
    role: string;
    content: string;
    reasoning_parts: Array<Record<string, unknown>>;
    tool_calls: Array<Record<string, unknown>>;
  };
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, "calling weather");
  assert.deepEqual(assistant.reasoning_parts, [
    {
      type: "reasoning",
      text: "Let me verify the tool input first.",
      providerOptions: {
        anthropic: {
          signature: "sig_demo",
        },
      },
    },
  ]);
  assert.deepEqual(assistant.tool_calls, [
    {
      id: "call_weather",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"city":"Paris"}',
      },
    },
  ]);
});
