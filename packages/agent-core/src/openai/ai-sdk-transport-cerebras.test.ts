import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("Cerebras uses the official SDK chat endpoint and request serialization", async () => {
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      ...(init !== undefined ? { init } : {}),
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const result = await new AiSdkOpenAiCompatibleTransport().startToolAgentRound(
      {
        apiKey: "test-key",
        model: "gpt-oss-120b",
        baseUrl: "https://api.cerebras.ai/v1",
        sdk: "@ai-sdk/cerebras",
        outputLimit: 1024,
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.url, "https://api.cerebras.ai/v1/chat/completions");
    const body = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-oss-120b");
    assert.equal(body.max_completion_tokens, 1024);
    assert.equal("max_tokens" in body, false);
    const headers = new Headers(captured[0]?.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-key");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
