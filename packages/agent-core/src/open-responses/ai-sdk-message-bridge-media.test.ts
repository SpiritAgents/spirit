import assert from "node:assert/strict";

import { generateText } from "ai";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { openAiMessagesToResponsesAiSdkMessages } from "./ai-sdk-message-bridge.js";
import { createResponsesLanguageModel } from "./model-factory.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

test("Responses keeps confirmed image input as an AI SDK file part", () => {
  const messages = openAiMessagesToResponsesAiSdkMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
        ],
      },
    ],
    {
      transportKind: "open-responses",
      model: "example/vision-chat",
      modelCapabilities: { imageInput: true },
    },
  );
  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect this image." },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: "AAEC" },
        },
      ],
    },
  ]);
});

test("Responses rejects unsupported video input explicitly instead of dropping it", () => {
  assert.throws(
    () =>
      openAiMessagesToResponsesAiSdkMessages(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "Keep this attachment visible." },
              { type: "video_url", video_url: { url: "data:video/mp4;base64,AAEC" } },
            ],
          },
        ],
        {
          transportKind: "open-responses",
          model: "example/video-chat",
          modelCapabilities: { imageInput: true },
        },
      ),
    /does not support video input on the Responses transport.*Remove the video attachment/u,
  );
});

test("Nebius Responses serializes confirmed image input as input_image without hosted controls", async () => {
  const config: OpenResponsesTransportConfig = {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "example/vision-chat",
    baseUrl: "http://127.0.0.1:19092/v1",
    sdk: "@ai-sdk/open-responses",
    modelCapabilities: { languageModel: true, imageInput: true },
  };
  const messages = openAiMessagesToResponsesAiSdkMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
        ],
      },
    ],
    config,
  );
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    captured.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 1_700_000_000,
        model: "example/vision-chat",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_test",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    const result = await generateText({
      model: createResponsesLanguageModel(config) as never,
      messages: messages as never,
    });
    assert.equal(result.text, "ok");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, "http://127.0.0.1:19092/v1/responses");
  const body = captured[0]!.body;
  const input = body.input as Array<{
    content: Array<Record<string, unknown>>;
  }>;
  assert.deepEqual(input[0]?.content, [
    { type: "input_text", text: "Inspect this image." },
    { type: "input_image", image_url: "data:image/png;base64,AAEC", detail: "auto" },
  ]);
  assert.equal("tools" in body, false);
  assert.equal("reasoning" in body, false);
  assert.equal("service_tier" in body, false);
});
