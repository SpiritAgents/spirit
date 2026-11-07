import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

async function runCerebrasChatRound(overrides: Partial<OpenAiTransportConfig> = {}) {
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
        workspaceRoot: process.cwd(),
        ...overrides,
      },
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(result.kind, "success");
    const body = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
    return { captured, body };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

test("Cerebras uses the official SDK chat endpoint and request serialization", async () => {
  const { captured, body } = await runCerebrasChatRound({
    outputLimit: 1024,
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, "https://api.cerebras.ai/v1/chat/completions");
  assert.equal(body.model, "gpt-oss-120b");
  assert.equal(body.max_completion_tokens, 1024);
  assert.equal("max_tokens" in body, false);
  assert.equal("reasoning_effort" in body, false);
  const headers = new Headers(captured[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-key");
});

test("Cerebras Qwen Thinking off sends reasoning_effort none", async () => {
  const { body } = await runCerebrasChatRound({
    model: "qwen-3.8-27b",
    supportsThinkingSwitch: true,
    vendorExtendedThinking: false,
    thinkingSwitch: { off: { body: { reasoning_effort: "none" } } },
  });
  assert.equal(body.reasoning_effort, "none");
});

test("Cerebras Qwen Thinking on leaves the provider default unchanged", async () => {
  const { body } = await runCerebrasChatRound({
    model: "qwen-3.8-27b",
    supportsThinkingSwitch: true,
    vendorExtendedThinking: true,
    thinkingSwitch: { off: { body: { reasoning_effort: "none" } } },
  });
  assert.equal("reasoning_effort" in body, false);
});
