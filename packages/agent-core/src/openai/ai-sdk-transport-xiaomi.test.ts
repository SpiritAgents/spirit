import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import {
  clearVideoPassthroughMessages,
  openAiMessagesContainVideoUrl,
  peekVideoPassthroughMessages,
  stashVideoPassthroughMessages,
} from "./video-message-stash.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("the fetch layer restores stashed video_url messages (adapter drops them)", async () => {
  const requestMessages = [
    {
      role: "user",
      content: [
        { type: "text", text: "describe the video" },
        { type: "video_url", video_url: { url: "ms://file-abc" } },
      ],
    },
  ];
  assert.equal(openAiMessagesContainVideoUrl(requestMessages), true);
  stashVideoPassthroughMessages(requestMessages);
  assert.ok(peekVideoPassthroughMessages());

  const capturedBodies: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBodies.push(body);
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "mimo-v2.5",
        baseUrl: "https://api.xiaomimimo.com/v1",
        workspaceRoot: process.cwd(),
        modelCapabilities: { imageInput: true, videoInput: true },
      },
      { messages: [{ role: "user", content: "describe the video" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    const chatCompletionBody = capturedBodies.find(
      (body) => Array.isArray(body.messages) && JSON.stringify(body.messages).includes("video_url"),
    );
    assert.ok(chatCompletionBody);
    assert.deepEqual(chatCompletionBody.messages, requestMessages);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearVideoPassthroughMessages();
  }
});
