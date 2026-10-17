import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { JsonValue, LlmStreamEvent } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import { AiSdkAnthropicTransport } from "./ai-sdk-transport.js";
import {
  buildAnthropicProviderOptions,
  buildAnthropicRequestTrace,
  type AnthropicTransportConfig,
} from "./anthropic-compat.js";

const FAST_MODE_BETA = "fast-mode-2026-02-01";
const TEST_MODEL = "claude-opus-4-8";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

function anthropicMessagesResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      id: "msg_service_tier",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      model: TEST_MODEL,
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function anthropicStreamingResponse(text: string): Response {
  const events = [
    {
      type: "message_start",
      message: { id: "msg_service_tier_stream", model: TEST_MODEL, usage: { input_tokens: 1 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(`${lines}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function baseConfig(): AnthropicTransportConfig {
  return {
    transportKind: "anthropic",
    apiKey: "test-key",
    model: TEST_MODEL,
    workspaceRoot: process.cwd(),
  };
}

async function runRound(
  config: AnthropicTransportConfig,
  tools: JsonValue = [],
): Promise<{
  completion: Awaited<ReturnType<AiSdkAnthropicTransport["startToolAgentRound"]>>;
  requests: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "request",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return anthropicMessagesResponse("ANTHROPIC_OK");
  });

  const transport = new AiSdkAnthropicTransport();
  try {
    const completion = await transport.startToolAgentRound(
      config,
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      tools,
    );
    return { completion, requests: captured };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

type StreamingCompletion = Awaited<
  Awaited<ReturnType<AiSdkAnthropicTransport["startToolAgentRoundStreaming"]>>["completion"]
>;

async function runStreamingRound(
  config: AnthropicTransportConfig,
  tools: JsonValue = [],
): Promise<{
  completion: StreamingCompletion;
  requests: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    captured.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "request",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return anthropicStreamingResponse("ANTHROPIC_STREAM_OK");
  });

  const transport = new AiSdkAnthropicTransport();
  try {
    const started = await transport.startToolAgentRoundStreaming(
      config,
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      tools,
    );
    for await (const event of started.eventStream as AsyncIterable<LlmStreamEvent>) {
      assert.notEqual(event.kind, "error");
    }
    return { completion: await started.completion, requests: captured };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function lastRequest(requests: CapturedRequest[]): CapturedRequest {
  const last = requests.at(-1);
  assert.ok(last, "expected at least one captured request");
  return last;
}

function betaList(request: CapturedRequest): string[] {
  return (request.headers.get("anthropic-beta") ?? "").split(",").filter(Boolean);
}

test("buildAnthropicProviderOptions maps fast onto native speed", () => {
  const options = buildAnthropicProviderOptions({
    serviceTier: "fast",
  });
  assert.equal(options.anthropic?.speed, "fast");
  assert.equal(options.anthropic?.toolStreaming, true);
});

test("buildAnthropicProviderOptions sends nothing for default and unset tiers", () => {
  for (const serviceTier of [undefined, "default", "flex", "ultrafast"] as const) {
    const options = buildAnthropicProviderOptions(serviceTier === undefined ? {} : { serviceTier });
    assert.equal(options.anthropic?.speed, undefined, `speed must stay unset for ${serviceTier}`);
  }
});

test("anthropic round sends speed fast and the fast-mode beta header", async () => {
  const { completion, requests } = await runRound({ ...baseConfig(), serviceTier: "fast" });

  assert.equal(completion.kind, "success");
  const request = lastRequest(requests);
  assert.match(request.url, /\/v1\/messages$/);
  assert.equal(request.body.speed, "fast");
  assert.ok(
    betaList(request).includes(FAST_MODE_BETA),
    `expected ${FAST_MODE_BETA} in anthropic-beta, got ${request.headers.get("anthropic-beta")}`,
  );
});

test("anthropic round without serviceTier sends no speed and no fast-mode beta", async () => {
  const { completion, requests } = await runRound(baseConfig());

  assert.equal(completion.kind, "success");
  const request = lastRequest(requests);
  assert.equal(request.body.speed, undefined);
  assert.ok(!betaList(request).includes(FAST_MODE_BETA));
});

test("anthropic default tier sends no speed (never speed standard)", async () => {
  const { completion, requests } = await runRound({ ...baseConfig(), serviceTier: "default" });

  assert.equal(completion.kind, "success");
  const request = lastRequest(requests);
  assert.equal(request.body.speed, undefined);
  assert.ok(!betaList(request).includes(FAST_MODE_BETA));
});

test("anthropic streaming fast keeps tool streaming enabled", async () => {
  const tools: JsonValue = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
        },
      },
    },
  ];
  const { completion, requests } = await runStreamingRound(
    { ...baseConfig(), serviceTier: "fast" },
    tools,
  );

  assert.equal(completion.kind, "success");
  const request = lastRequest(requests);
  assert.equal(request.body.stream, true);
  assert.equal(request.body.speed, "fast");
  assert.ok(betaList(request).includes(FAST_MODE_BETA));

  const bodyTools = request.body.tools;
  assert.ok(Array.isArray(bodyTools) && bodyTools.length === 1, "expected one captured tool");
  const tool = bodyTools[0];
  assert.ok(isJsonObject(tool));
  assert.equal(tool.eager_input_streaming, true);
});

test("anthropic request trace records the configured serviceTier", async () => {
  const { completion } = await runRound({ ...baseConfig(), serviceTier: "fast" });
  assert.equal(completion.kind, "success");
  if (completion.kind !== "success") {
    return;
  }

  const trace = completion.result.requestTrace[0];
  assert.ok(isJsonObject(trace));
  assert.equal(trace.kind, "anthropic_sdk_messages");
  assert.equal(trace.serviceTier, "fast");

  const providerOptions = trace.providerOptions;
  assert.ok(isJsonObject(providerOptions));
  const anthropic = providerOptions.anthropic;
  assert.ok(isJsonObject(anthropic));
  assert.equal(anthropic.speed, "fast");
});

test("buildAnthropicRequestTrace omits serviceTier when unset", () => {
  const [trace] = buildAnthropicRequestTrace(baseConfig(), 1, [], []);
  assert.ok(isJsonObject(trace));
  assert.equal("serviceTier" in trace, false);
});

test("anthropic literal serviceTiers merge the declared header and body verbatim", async () => {
  const { completion, requests } = await runRound({
    ...baseConfig(),
    serviceTier: "fast",
    serviceTiers: {
      fast: {
        headers: { "anthropic-beta": FAST_MODE_BETA },
        body: { speed: "fast" },
      },
    },
  });

  assert.equal(completion.kind, "success");
  const request = lastRequest(requests);
  assert.equal(request.body.speed, "fast");
  assert.ok(betaList(request).includes(FAST_MODE_BETA));
});

test("anthropic thinkingSwitch on patch merges into the serialized body", async () => {
  const { completion, requests } = await runRound({
    ...baseConfig(),
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive", display: "summarized" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  });

  assert.equal(completion.kind, "success");
  assert.deepEqual(lastRequest(requests).body.thinking, {
    type: "adaptive",
    display: "summarized",
  });
});

test("anthropic thinkingSwitch off patch wins over the transport default disable encoding", async () => {
  const { completion, requests } = await runRound({
    ...baseConfig(),
    supportsThinkingSwitch: true,
    vendorExtendedThinking: false,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  });

  assert.equal(completion.kind, "success");
  assert.deepEqual(lastRequest(requests).body.thinking, { type: "disabled" });
});

test("anthropic off state without a declared off patch uses the transport default encoding", async () => {
  const { completion, requests } = await runRound({
    ...baseConfig(),
    supportsThinkingSwitch: true,
    vendorExtendedThinking: false,
  });

  assert.equal(completion.kind, "success");
  assert.deepEqual(lastRequest(requests).body.thinking, { type: "disabled" });
});

test("anthropic sends no thinking field when nothing is declared", async () => {
  const { completion, requests } = await runRound(baseConfig());

  assert.equal(completion.kind, "success");
  assert.equal(lastRequest(requests).body.thinking, undefined);
});

test("anthropic maps the declared outputLimit to max_tokens", async () => {
  const { completion, requests } = await runRound({ ...baseConfig(), outputLimit: 8192 });

  assert.equal(completion.kind, "success");
  assert.equal(lastRequest(requests).body.max_tokens, 8192);
});
