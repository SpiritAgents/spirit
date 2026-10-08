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
    if (config.llmVendor === "vercel-ai-gateway") {
      return gatewayV3Response("GATEWAY_OK");
    }
    if (config.llmVendor === "google" || config.llmVendor === "google-vertex-ai") {
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

test("OpenRouter chat sends top-level service_tier for flex", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    serviceTier: "flex",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.match(requests.at(-1)?.url ?? "", /openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.equal(lastBody(requests).service_tier, "flex");
});

test("OpenRouter chat sends explicit default to override variant admission", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "google/gemini-2.5-flash",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "google",
    serviceTier: "default",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal(lastBody(requests).service_tier, "default");
});

test("OpenRouter chat omits service_tier when unset", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal("service_tier" in lastBody(requests), false);
});

test("OpenRouter chat service_tier survives the Claude early-return provider options branch", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "anthropic",
    serviceTier: "priority",
    reasoningEffort: "high",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const body = lastBody(requests);
  assert.equal(body.service_tier, "priority");
  // The OpenRouter Claude reasoning body from the vendor extras coexists with the tier.
  assert.ok(isJsonObject(body.reasoning as JsonValue));
});

test("OpenRouter chat allows ultrafast for openai-upstream astra models", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-6-astra",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    serviceTier: "ultrafast",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const body = lastBody(requests);
  assert.equal(body.service_tier, "ultrafast");
  // The direct-OpenAI-only header is never sent to aggregators.
  assert.equal(requests.at(-1)?.headers.get("OpenAI-Service-Tier"), null);
});

test("xAI chat serializes service_tier default and priority", async () => {
  for (const tier of ["default", "priority"] as const) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      llmVendor: "xai",
      serviceTier: tier,
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    assert.match(requests.at(-1)?.url ?? "", /api\.x\.ai\/v1/);
    assert.equal(lastBody(requests).service_tier, tier);
  }
});

test("xAI chat without a tier sends no service_tier", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
    llmVendor: "xai",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal("service_tier" in lastBody(requests), false);
});

test("Google chat maps tiers to top-level body serviceTier", async () => {
  const expectations = { default: "standard", flex: "flex", priority: "priority" } as const;
  for (const [tier, wire] of Object.entries(expectations)) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      llmVendor: "google",
      serviceTier: tier as "default" | "flex" | "priority",
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    assert.equal(lastBody(requests).serviceTier, wire);
  }
});

test("Google chat without a tier sends no serviceTier", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    llmVendor: "google",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal("serviceTier" in lastBody(requests), false);
});

function vertexConfig(serviceTier?: "default" | "flex" | "priority"): OpenAiTransportConfig {
  return {
    apiKey: "",
    model: "gemini-2.5-flash",
    llmVendor: "google-vertex-ai",
    vertexProject: "test-project",
    vertexLocation: "global",
    vertexGoogleAuthOptions: {
      authClient: {
        getAccessToken: async () => ({ token: "test-token" }),
      },
    },
    ...(serviceTier ? { serviceTier } : {}),
    workspaceRoot: process.cwd(),
  };
}

test("Vertex global sends the shared capacity headers for flex and priority", async () => {
  for (const tier of ["flex", "priority"] as const) {
    const { result, requests } = await runChatRound(vertexConfig(tier));

    assert.equal(result.kind, "success");
    const request = requests.at(-1);
    assert.ok(request);
    assert.equal(request.headers.get("X-Vertex-AI-LLM-Shared-Request-Type"), tier);
    assert.equal(request.headers.get("X-Vertex-AI-LLM-Request-Type"), "shared");
    assert.equal("serviceTier" in request.body, false);
  }
});

test("Vertex global default and unset send no shared capacity headers", async () => {
  for (const config of [vertexConfig("default"), vertexConfig()]) {
    const { result, requests } = await runChatRound(config);

    assert.equal(result.kind, "success");
    const request = requests.at(-1);
    assert.ok(request);
    assert.equal(request.headers.get("X-Vertex-AI-LLM-Shared-Request-Type"), null);
    assert.equal(request.headers.get("X-Vertex-AI-LLM-Request-Type"), null);
    assert.equal("serviceTier" in request.body, false);
  }
});

test("Vertex regional endpoint injects nothing for non-default tiers", async () => {
  const config = { ...vertexConfig("flex"), vertexLocation: "us-central1" };
  const { result, requests } = await runChatRound(config);

  assert.equal(result.kind, "success");
  const request = requests.at(-1);
  assert.ok(request);
  assert.equal(request.headers.get("X-Vertex-AI-LLM-Shared-Request-Type"), null);
  assert.equal("serviceTier" in request.body, false);
});

test("Vercel gateway chat maps upstream openai flex/fast to the gateway namespace", async () => {
  for (const tier of ["flex", "fast"] as const) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
      upstreamProvider: "openai",
      serviceTier: tier,
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    const providerOptions = lastBody(requests).providerOptions;
    assert.ok(isJsonObject(providerOptions as JsonValue));
    const namespaces = providerOptions as Record<string, Record<string, unknown>>;
    assert.equal(namespaces.gateway?.serviceTier, tier);
    assert.equal(namespaces.openai?.serviceTier, undefined);
  }
});

test("Vercel gateway chat astra ultrafast uses the openai namespace only", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "openai/gpt-6-astra",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "openai",
    serviceTier: "ultrafast",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const providerOptions = lastBody(requests).providerOptions;
  assert.ok(isJsonObject(providerOptions as JsonValue));
  const namespaces = providerOptions as Record<string, Record<string, unknown>>;
  assert.equal(namespaces.openai?.serviceTier, "ultrafast");
  assert.equal(namespaces.gateway?.serviceTier, undefined);
});

test("Vercel gateway chat default and unset write no service tier", async () => {
  for (const serviceTier of ["default", undefined] as const) {
    const { result, requests } = await runChatRound({
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
      upstreamProvider: "openai",
      ...(serviceTier ? { serviceTier } : {}),
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    const providerOptions = lastBody(requests).providerOptions as
      | Record<string, Record<string, unknown>>
      | undefined;
    assert.equal(providerOptions?.gateway?.serviceTier, undefined);
    assert.equal(providerOptions?.openai?.serviceTier, undefined);
  }
});

test("Vercel gateway chat maps google flex and xai priority to the gateway namespace", async () => {
  const google = await runChatRound({
    apiKey: "test-key",
    model: "google/gemini-2.5-flash",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "google",
    serviceTier: "flex",
    workspaceRoot: process.cwd(),
  });
  assert.equal(google.result.kind, "success");
  const googleOptions = lastBody(google.requests).providerOptions as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(googleOptions.gateway?.serviceTier, "flex");

  const xai = await runChatRound({
    apiKey: "test-key",
    model: "xai/grok-4.3",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "xai",
    serviceTier: "priority",
    workspaceRoot: process.cwd(),
  });
  assert.equal(xai.result.kind, "success");
  const xaiOptions = lastBody(xai.requests).providerOptions as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(xaiOptions.gateway?.serviceTier, "priority");
});

test("Vercel gateway chat injects nothing for anthropic upstreams", async () => {
  const { result, requests } = await runChatRound({
    apiKey: "test-key",
    model: "anthropic/claude-opus-4-8",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "anthropic",
    serviceTier: "fast",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const providerOptions = lastBody(requests).providerOptions as
    | Record<string, Record<string, unknown>>
    | undefined;
  assert.equal(providerOptions?.gateway?.serviceTier, undefined);
});

test("chat request trace records the configured service tier", async () => {
  const { result } = await runChatRound({
    apiKey: "test-key",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
    llmVendor: "xai",
    serviceTier: "priority",
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
        llmVendor: "google",
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
        llmVendor: "google",
        serviceTier: "flex",
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

test("code-completion profile preserves serviceTier and upstreamProvider", () => {
  const profiled = applyCodeCompletionTransportProfile({
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    serviceTier: "flex",
    workspaceRoot: process.cwd(),
  }) as OpenAiTransportConfig;

  assert.equal(profiled.transportRequestProfile, "code-completion");
  assert.equal(profiled.serviceTier, "flex");
  assert.equal(profiled.upstreamProvider, "openai");
});
