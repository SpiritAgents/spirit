import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("Moonshot official provider sends native video_url from AI SDK file parts", async () => {
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
        model: "kimi-k2.6",
        baseUrl: "https://api.moonshot.cn/v1",
        sdk: "@ai-sdk/moonshotai",
        workspaceRoot: process.cwd(),
        modelCapabilities: { videoInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe the video" },
              { type: "video_url", video_url: { url: "ms://fafwrkbfykqi11gdyfwi" } },
            ],
          },
        ],
        steps: 0,
      },
      [],
    );

    assert.equal(result.kind, "success");
    const chatCompletionBody = capturedBodies.find(
      (body) => Array.isArray(body.messages) && JSON.stringify(body.messages).includes("video_url"),
    );
    assert.ok(chatCompletionBody);
    const messages = chatCompletionBody.messages as Array<{
      content: Array<{ type: string; video_url?: { url: string } }>;
    }>;
    const videoPart = messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === "video_url");
    assert.equal(videoPart?.video_url?.url, "ms://fafwrkbfykqi11gdyfwi");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
