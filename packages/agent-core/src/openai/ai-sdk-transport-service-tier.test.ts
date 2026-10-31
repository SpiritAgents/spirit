import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { isJsonObject } from "../tool-agent.js";
import type { JsonValue } from "../ports.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

function chatCompletionResponse(text: string, model = "gpt-5.4"): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-service-tier",
      object: "chat.completion",
      created: 0,
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function googleGenerateContentResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function gatewayV3Response(text: string): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function runChatRound(config: OpenAiTransportConfig): Promise<{
  result: Awaited<ReturnType<AiSdkOpenAiCompatibleTransport["startToolAgentRound"]>>;
  requests: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "request",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    if (config.sdk === "@ai-sdk/gateway") {
      return gatewayV3Response("GATEWAY_OK");
    }
    if (config.sdk === "@ai-sdk/google" || config.sdk === "@ai-sdk/google-vertex") {
      return googleGenerateContentResponse("GOOGLE_OK");
    }
    return chatCompletionResponse("CHAT_OK", config.model);
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      config,
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    return { result, requests: captured };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function lastBody(requests: CapturedRequest[]): Record<string, unknown> {
  const last = requests.at(-1);
  assert.ok(last, "expected at least one captured request");
  return last.body;
}

test("chat sends the declared tier as top-level service_tier for flex", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    sdk: "@ai-sdk/openai-compatible",
    serviceTier: "flex",
    serviceTiers: ["default", "flex"],
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.match(requests.at(-1)?.url ?? "", /openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.equal(lastBody(requests).service_tier, "flex");
});

test("chat sends an explicit default tier when one is selected", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "google/gemini-2.5-flash",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceTier: "default",
    serviceTiers: ["default", "priority"],
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal(lastBody(requests).service_tier, "default");
});

test("chat omits service_tier when unset", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal("service_tier" in lastBody(requests), false);
});

test("chat service_tier coexists with the declared reasoning effort", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceTier: "priority",
    serviceTiers: ["default", "priority"],
    reasoningEffort: "high",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const body = lastBody(requests);
  assert.equal(body.service_tier, "priority");
  assert.equal(body.reasoning_effort, "high");
});

test("chat sends ultrafast verbatim when declared", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-6-astra",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceTier: "ultrafast",
    serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal(lastBody(requests).service_tier, "ultrafast");
});

test("literal serviceTiers merge the declared headers and body onto the Gemini wire", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    sdk: "@ai-sdk/google",
    serviceTier: "flex",
    serviceTiers: {
      flex: {
        headers: { "x-tier": "flex" },
        body: { serviceTier: "flex" },
      },
    },
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const request = requests.at(-1);
  assert.ok(request);
  assert.equal(request.body.serviceTier, "flex");
  assert.equal(request.headers.get("x-tier"), "flex");
});

test("Gemini adapters carry no simple-form tier field on the generateContent wire", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    sdk: "@ai-sdk/google",
    serviceTier: "priority",
    serviceTiers: ["default", "priority"],
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const body = lastBody(requests);
  assert.equal("service_tier" in body, false);
  assert.equal("serviceTier" in body, false);
});

test("gateway chat maps flex and priority into the gateway provider-options namespace", async () => {
  for (const tier of ["flex", "priority"] as const) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      sdk: "@ai-sdk/gateway",
      serviceTier: tier,
      serviceTiers: ["default", "flex", "priority"],
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    const providerOptions = lastBody(requests).providerOptions;
    assert.ok(isJsonObject(providerOptions as JsonValue));
    const namespaces = providerOptions as Record<string, Record<string, unknown>>;
    assert.equal(namespaces.gateway?.serviceTier, tier);
  }
});

test("gateway chat writes nothing for tiers outside the unified enum", async () => {
  for (const serviceTier of ["default", "fast", "ultrafast"] as const) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      sdk: "@ai-sdk/gateway",
      serviceTier,
      serviceTiers: ["default", "fast", "ultrafast"],
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    const providerOptions = lastBody(requests).providerOptions as
      | Record<string, Record<string, unknown>>
      | undefined;
    assert.equal(providerOptions?.gateway?.serviceTier, undefined);
  }
});

test("chat request trace records the configured service tier", async () => {
  const { result } = await runChatRound({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceTier: "priority",
    serviceTiers: ["default", "priority"],
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const trace = result.kind === "success" ? result.result.requestTrace[0] : undefined;
  assert.ok(trace && isJsonObject(trace));
  assert.equal(trace.serviceTier, "priority");
});

test("flex chat requests construct the extended-wait dispatcher; standard requests do not", async () => {
  // Fresh module graph: dispatcher constructions are process-global singletons, so a pristine
  // log makes the standard-vs-flex selection exactly observable.
  vi.resetModules();
  const { AiSdkOpenAiCompatibleTransport: FreshTransport } = await import("./ai-sdk-transport.js");
  const llmFetchModule = await import("../llm-fetch.js");

  const requests: CapturedRequest[] = [];
  llmFetchModule.setLlmFetchTransportOverrideForTests(async (input, init) => {
    requests.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "request",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return googleGenerateContentResponse("GOOGLE_OK");
  });

  const transport = new FreshTransport();
  try {
    const standard = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "gemini-2.5-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        sdk: "@ai-sdk/google",
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(standard.kind, "success");
    assert.equal(
      llmFetchModule.getLlmDispatcherConstructionsForTests().some((entry) => entry.kind === "flex"),
      false,
    );

    const flex = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "gemini-2.5-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        sdk: "@ai-sdk/google",
        serviceTier: "flex",
        serviceTiers: ["default", "flex"],
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(flex.kind, "success");
    const flexConstructions = llmFetchModule
      .getLlmDispatcherConstructionsForTests()
      .filter((entry) => entry.kind === "flex");
    assert.equal(flexConstructions.length, 1);
    assert.equal(
      flexConstructions[0]?.options.headersTimeout,
      llmFetchModule.FLEX_SERVICE_TIER_WAIT_MS,
    );
    assert.equal(
      flexConstructions[0]?.options.bodyTimeout,
      llmFetchModule.FLEX_SERVICE_TIER_WAIT_MS,
    );
    assert.equal(llmFetchModule.FLEX_SERVICE_TIER_WAIT_MS, 1_800_000);
  } finally {
    llmFetchModule.setLlmFetchTransportOverrideForTests(undefined);
    vi.resetModules();
  }
});

test("code-completion profile preserves the declared serviceTier and serviceTiers", () => {
  const profiled = applyCodeCompletionTransportProfile({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceTier: "flex",
    serviceTiers: ["default", "flex"],
    workspaceRoot: process.cwd(),
  }) as OpenAiTransportConfig;

  assert.equal(profiled.transportRequestProfile, "code-completion");
  assert.equal(profiled.serviceTier, "flex");
  assert.deepEqual(profiled.serviceTiers, ["default", "flex"]);
});

test("chat maps the declared outputLimit to max_tokens", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    outputLimit: 4096,
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal(lastBody(requests).max_tokens, 4096);
});
