import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { isJsonObject } from "../tool-agent.js";
import type { JsonValue } from "../ports.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { resolveServiceTierRequestPlan } from "../service-tier-request.js";
import { AiSdkOpenResponsesTransport } from "./ai-sdk-transport.js";
import { createServiceTierResponsesFetch } from "./service-tier-responses-fetch.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

function openResponsesFinalTextResponse(text: string, model: string): Response {
  return new Response(
    JSON.stringify({
      id: "resp-service-tier",
      object: "response",
      created_at: 0,
      model,
      status: "completed",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
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

async function runResponsesRound(
  config: OpenResponsesTransportConfig,
  messages: JsonValue[] = [{ role: "user", content: "hello" }],
  tools: JsonValue = [],
): Promise<{
  result: Awaited<ReturnType<AiSdkOpenResponsesTransport["startToolAgentRound"]>>;
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
    return openResponsesFinalTextResponse("RESPONSES_OK", config.model);
  });

  const transport = new AiSdkOpenResponsesTransport();
  try {
    const result = await transport.startToolAgentRound(config, { messages, steps: 0 }, tools);
    return { result, requests: captured };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function lastRequest(requests: CapturedRequest[]): CapturedRequest {
  const last = requests.at(-1);
  assert.ok(last, "expected at least one captured request");
  return last;
}

const openAiConfig = (
  serviceTier?: "auto" | "default" | "flex" | "fast" | "ultrafast",
  model = "gpt-5.4",
): OpenResponsesTransportConfig => ({
  transportKind: "open-responses",
  apiKey: "test-key",
  model,
  llmVendor: "openai",
  ...(serviceTier ? { serviceTier } : {}),
  workspaceRoot: process.cwd(),
});

test("OpenAI responses maps auto/default/flex/fast to body service_tier", async () => {
  for (const tier of ["auto", "default", "flex", "fast"] as const) {
    const { result, requests } = await runResponsesRound(openAiConfig(tier));

    assert.equal(result.kind, "success");
    assert.match(lastRequest(requests).url, /\/v1\/responses/);
    assert.equal(lastRequest(requests).body.service_tier, tier);
  }
});

test("OpenAI responses without a tier sends no service_tier key", async () => {
  const { result, requests } = await runResponsesRound(openAiConfig());

  assert.equal(result.kind, "success");
  assert.equal("service_tier" in lastRequest(requests).body, false);
});

test("OpenAI responses ultrafast patches body and adds the direct-only header", async () => {
  const { result, requests } = await runResponsesRound(openAiConfig("ultrafast", "gpt-6-astra"));

  assert.equal(result.kind, "success");
  const request = lastRequest(requests);
  assert.equal(request.body.service_tier, "ultrafast");
  assert.equal(request.headers.get("OpenAI-Service-Tier"), "ultrafast");
});

test("OpenAI responses ultrafast on an ineligible model injects nothing", async () => {
  const { result, requests } = await runResponsesRound(openAiConfig("ultrafast", "gpt-5.4"));

  assert.equal(result.kind, "success");
  const request = lastRequest(requests);
  assert.equal("service_tier" in request.body, false);
  assert.equal(request.headers.get("OpenAI-Service-Tier"), null);
});

test("OpenAI responses tier coexists with reasoning, store, previous_response_id, and tools", async () => {
  const { result, requests } = await runResponsesRound(
    {
      ...openAiConfig("flex"),
      reasoningEffort: "high",
    },
    [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "earlier answer",
        openAiResponses: { responseId: "resp_prev_1" },
      },
      { role: "user", content: "second" },
    ],
    [
      {
        type: "function",
        function: {
          name: "grep",
          description: "search",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
  );

  assert.equal(result.kind, "success");
  const body = lastRequest(requests).body;
  assert.equal(body.service_tier, "flex");
  assert.equal(body.store, true);
  assert.equal(body.previous_response_id, "resp_prev_1");
  const reasoning = body.reasoning;
  assert.ok(isJsonObject(reasoning as JsonValue));
  assert.equal((reasoning as Record<string, unknown>).effort, "high");
  const tools = body.tools;
  assert.ok(Array.isArray(tools));
  assert.ok(
    tools.some(
      (tool) =>
        isJsonObject(tool as JsonValue) && (tool as Record<string, unknown>).name === "grep",
    ),
  );
});

test("xAI responses serializes service_tier default and priority", async () => {
  for (const tier of ["default", "priority"] as const) {
    const { result, requests } = await runResponsesRound({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      llmVendor: "xai",
      serviceTier: tier,
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    assert.match(lastRequest(requests).url, /api\.x\.ai\/v1\/responses/);
    assert.equal(lastRequest(requests).body.service_tier, tier);
  }
});

test("xAI responses without a tier sends no service_tier", async () => {
  const { result, requests } = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
    llmVendor: "xai",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.equal("service_tier" in lastRequest(requests).body, false);
});

test("OpenRouter responses patches top-level body service_tier", async () => {
  const { result, requests } = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    serviceTier: "flex",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  assert.match(lastRequest(requests).url, /openrouter\.ai\/api\/v1\/responses/);
  assert.equal(lastRequest(requests).body.service_tier, "flex");
});

test("OpenRouter responses sends explicit default and omits unset", async () => {
  const explicitDefault = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "google/gemini-2.5-flash",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "google",
    serviceTier: "default",
    workspaceRoot: process.cwd(),
  });
  assert.equal(explicitDefault.result.kind, "success");
  assert.equal(lastRequest(explicitDefault.requests).body.service_tier, "default");

  const unset = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    baseUrl: "https://openrouter.ai/api/v1",
    llmVendor: "openrouter",
    upstreamProvider: "openai",
    workspaceRoot: process.cwd(),
  });
  assert.equal(unset.result.kind, "success");
  assert.equal("service_tier" in lastRequest(unset.requests).body, false);
});

test("Vercel v3 responses path maps flex to the gateway providerOptions namespace", async () => {
  const { result, requests } = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "openai",
    serviceTier: "flex",
    reasoningEffort: "medium",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const providerOptions = lastRequest(requests).body.providerOptions;
  assert.ok(isJsonObject(providerOptions as JsonValue));
  const namespaces = providerOptions as Record<string, Record<string, unknown>>;
  assert.equal(namespaces.gateway?.serviceTier, "flex");
  // The existing reasoning options in the openai namespace survive the merge.
  assert.equal(namespaces.openai?.reasoningEffort, "medium");
  assert.equal(namespaces.openai?.serviceTier, undefined);
});

test("Vercel v3 responses path astra ultrafast uses the openai namespace only", async () => {
  const { result, requests } = await runResponsesRound({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-6-astra",
    llmVendor: "vercel-ai-gateway",
    upstreamProvider: "openai",
    serviceTier: "ultrafast",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.kind, "success");
  const providerOptions = lastRequest(requests).body.providerOptions;
  assert.ok(isJsonObject(providerOptions as JsonValue));
  const namespaces = providerOptions as Record<string, Record<string, unknown>>;
  assert.equal(namespaces.openai?.serviceTier, "ultrafast");
  assert.equal(namespaces.gateway?.serviceTier, undefined);
  // Ultrafast is not patched into the body or headers on aggregator routes.
  assert.equal(lastRequest(requests).body.service_tier, undefined);
  assert.equal(lastRequest(requests).headers.get("OpenAI-Service-Tier"), null);
});

test("Vercel v3 responses path default and unset write no service tier", async () => {
  for (const serviceTier of ["default", undefined] as const) {
    const { result, requests } = await runResponsesRound({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
      upstreamProvider: "openai",
      ...(serviceTier ? { serviceTier } : {}),
      workspaceRoot: process.cwd(),
    });

    assert.equal(result.kind, "success");
    const body = lastRequest(requests).body;
    const namespaces = body.providerOptions as Record<string, Record<string, unknown>> | undefined;
    assert.equal(namespaces?.gateway?.serviceTier, undefined);
    assert.equal(namespaces?.openai?.serviceTier, undefined);
    assert.equal("service_tier" in body, false);
  }
});

test("Vercel generic responses surface resolves a top-level body patch", () => {
  // The native-compatible Responses route is selected only when the v3 language-model path is not;
  // its injection contract is the top-level body service_tier.
  const plan = resolveServiceTierRequestPlan({
    provider: "vercel-ai-gateway",
    model: "openai/gpt-5.4",
    upstreamProvider: "openai",
    serviceTier: "fast",
    surface: "responses",
  });
  assert.deepEqual(plan, { bodyServiceTier: "fast" });
});

test("createServiceTierResponsesFetch patches body service_tier and merges headers", async () => {
  let captured: CapturedRequest | undefined;
  const fetchFn = createServiceTierResponsesFetch(
    { bodyServiceTier: "ultrafast", headers: { "OpenAI-Service-Tier": "ultrafast" } },
    async (input, init) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      };
      return new Response("{}", { status: 200 });
    },
  );

  await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Existing": "keep" },
    body: JSON.stringify({ model: "gpt-6-astra", input: [] }),
  });

  assert.ok(captured);
  assert.equal(captured.body.service_tier, "ultrafast");
  assert.equal(captured.body.model, "gpt-6-astra");
  assert.equal(captured.headers.get("OpenAI-Service-Tier"), "ultrafast");
  assert.equal(captured.headers.get("X-Existing"), "keep");
  assert.equal(captured.headers.get("Content-Type"), "application/json");
});

test("createServiceTierResponsesFetch leaves non-JSON bodies and other requests untouched", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchFn = createServiceTierResponsesFetch(
    { bodyServiceTier: "flex" },
    async (_input, init) => {
      capturedInit = init;
      return new Response("{}", { status: 200 });
    },
  );

  await fetchFn("https://example.com/upload", { method: "POST", body: "not json" });
  assert.equal(capturedInit?.body, "not json");
});

test("createServiceTierResponsesFetch is a pass-through for empty plans", () => {
  const base = async () => new Response("{}", { status: 200 });
  assert.equal(createServiceTierResponsesFetch({}, base), base);
});

test("responses request trace records the configured service tier", async () => {
  const { result } = await runResponsesRound(openAiConfig("fast"));

  assert.equal(result.kind, "success");
  const trace = result.kind === "success" ? result.result.requestTrace[0] : undefined;
  assert.ok(trace && isJsonObject(trace));
  assert.equal(trace.serviceTier, "fast");
});

test("code-completion profile preserves serviceTier and upstreamProvider on open-responses", () => {
  const profiled = applyCodeCompletionTransportProfile({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "gpt-5.4",
    llmVendor: "openai",
    serviceTier: "flex",
    upstreamProvider: "openai",
    workspaceRoot: process.cwd(),
  }) as OpenResponsesTransportConfig;

  assert.equal(profiled.transportRequestProfile, "code-completion");
  assert.equal(profiled.serviceTier, "flex");
  assert.equal(profiled.upstreamProvider, "openai");
});
