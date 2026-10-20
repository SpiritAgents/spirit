import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

const ADAPTIVE_SWITCH = {
  on: {
    body: { thinking: { type: "adaptive" } },
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
  },
  off: {
    body: { thinking: { type: "disabled" } },
    providerOptions: { anthropic: { thinking: { type: "disabled" } } },
  },
} as const;

const BUDGET_SWITCH = {
  on: {
    body: { thinking: { type: "enabled", budget_tokens: 12000 } },
    providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
  },
  off: {
    body: { thinking: { type: "disabled" } },
    providerOptions: { anthropic: { thinking: { type: "disabled" } } },
  },
} as const;

function chatCompletionResponse(model: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-openrouter-anthropic",
      object: "chat.completion",
      created: 0,
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function runChatRound(config: OpenAiTransportConfig): Promise<CapturedRequest[]> {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "request",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return chatCompletionResponse(config.model);
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      config,
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(result.kind, "success");
    return captured;
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function openRouterConfig(
  model: string,
  extra?: Partial<OpenAiTransportConfig>,
): OpenAiTransportConfig {
  return {
    apiKey: "test-key",
    model,
    baseUrl: "https://openrouter.ai/api/v1",
    sdk: "@ai-sdk/openai-compatible",
    options: { openRouterAnthropicReasoning: true },
    workspaceRoot: process.cwd(),
    ...extra,
  };
}

test("openrouter anthropic routes send the unified reasoning shape and drop reasoning_effort/thinking", async () => {
  const requests = await runChatRound(
    openRouterConfig("anthropic/claude-opus-4.8", {
      reasoningEffort: "high",
      thinkingSwitch: ADAPTIVE_SWITCH,
    }),
  );

  const body = requests.at(-1)?.body ?? {};
  assert.deepEqual(body.reasoning, { enabled: true, effort: "high" });
  assert.equal("reasoning_effort" in body, false);
  assert.equal("thinking" in body, false);
});

test("openrouter anthropic routes map the thinking off state to enabled false", async () => {
  const requests = await runChatRound(
    openRouterConfig("anthropic/claude-opus-4.8", {
      vendorExtendedThinking: false,
      thinkingSwitch: ADAPTIVE_SWITCH,
    }),
  );

  const body = requests.at(-1)?.body ?? {};
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.equal("reasoning_effort" in body, false);
  assert.equal("thinking" in body, false);
});

test("openrouter budget-era anthropic routes send the declared budget as max_tokens", async () => {
  const requests = await runChatRound(
    openRouterConfig("anthropic/claude-sonnet-4-5", {
      reasoningEffort: "medium",
      thinkingSwitch: BUDGET_SWITCH,
    }),
  );

  const body = requests.at(-1)?.body ?? {};
  assert.deepEqual(body.reasoning, { enabled: true, max_tokens: 12000 });
  assert.equal("reasoning_effort" in body, false);
  assert.equal("thinking" in body, false);
});

test("openrouter non-anthropic routes keep the generic reasoning_effort encoding", async () => {
  const requests = await runChatRound(
    openRouterConfig("openai/gpt-5", { reasoningEffort: "high" }),
  );

  const body = requests.at(-1)?.body ?? {};
  assert.equal(body.reasoning_effort, "high");
  assert.equal("reasoning" in body, false);
});

test("anthropic routes without the declaration keep reasoning_effort and the thinking merge", async () => {
  const config = openRouterConfig("anthropic/claude-opus-4.8", {
    reasoningEffort: "high",
    thinkingSwitch: ADAPTIVE_SWITCH,
  });
  delete config.options;
  const requests = await runChatRound(config);

  const body = requests.at(-1)?.body ?? {};
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.equal("reasoning" in body, false);
});
