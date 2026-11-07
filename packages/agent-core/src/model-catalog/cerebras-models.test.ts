import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import {
  cerebrasPublicModelsListUrl,
  listCerebrasModels,
  mergeCerebrasModelEntries,
  parseCerebrasModelEntriesPayload,
  parseCerebrasPublicModelEntriesPayload,
} from "./cerebras-models.js";

const AUTHENTICATED_LIST = {
  object: "list",
  data: [
    { id: "gpt-oss-120b", object: "model", created: 0, owned_by: "Cerebras" },
    { id: "qwen-3.8-27b", object: "model", created: 0, owned_by: "Cerebras" },
    { id: "dedicated-endpoint-id", object: "model", created: 0, owned_by: "Cerebras" },
    { id: "gemma-4-31b", object: "model", created: 0, owned_by: "Cerebras" },
  ],
};

const PUBLIC_LIST = {
  object: "list",
  data: [
    {
      id: "gpt-oss-120b",
      object: "model",
      created: 1754438400,
      owned_by: "OpenAI",
      name: "OpenAI GPT OSS",
      description: "Efficient reasoning for science, math, and coding applications.",
      hugging_face_id: "openai/gpt-oss-120b",
      pricing: { prompt: "0.00000035", completion: "0.00000075" },
      capabilities: {
        streaming: true,
        function_calling: true,
        structured_outputs: true,
        vision: false,
        json_mode: true,
        tools: true,
        tool_choice: true,
        parallel_tool_calls: false,
        response_format: true,
        reasoning: true,
      },
      supported_parameters: { temperature: true, top_p: true, repetition_penalty: false },
      architecture: { modality: "text", tokenizer: "GPT", instruct_type: "harmony" },
      limits: {
        max_context_length: 131072,
        max_completion_tokens: 40960,
        requests_per_minute: null,
        tokens_per_minute: null,
      },
      datacenter_locations: [],
      deprecated: false,
      preview: false,
      quantization: "FP16/8 (weights only)",
    },
    {
      id: "qwen-3.8-27b",
      name: "Qwen 3.8 27B",
      description: "Shared multilingual reasoning model.",
      pricing: { prompt: "0.000001", completion: "0.000002" },
      capabilities: { vision: true, reasoning: true },
      limits: { max_context_length: 131072, max_completion_tokens: 32768 },
    },
    {
      id: "gemma-4-31b",
      name: "Dedicated metadata must not enter the Shared catalog",
      capabilities: { vision: true, reasoning: true },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test("authenticated Cerebras parsing keeps only documented Shared Inference ids", () => {
  assert.deepEqual(parseCerebrasModelEntriesPayload(AUTHENTICATED_LIST), [
    { id: "gpt-oss-120b" },
    { id: "qwen-3.8-27b" },
  ]);
  assert.deepEqual(parseCerebrasModelEntriesPayload({ data: "invalid" }), []);
});

test("public Cerebras parsing reads API-sourced display, pricing, modalities, and limits", () => {
  assert.deepEqual(parseCerebrasPublicModelEntriesPayload(PUBLIC_LIST), [
    {
      id: "gpt-oss-120b",
      displayName: "OpenAI GPT OSS",
      description: "Efficient reasoning for science, math, and coding applications.",
      pricing: { inputPerTokenUsd: "0.00000035", outputPerTokenUsd: "0.00000075" },
      supportsImageInput: false,
      supportsReasoning: true,
      contextLength: 131072,
      maxCompletionTokens: 40960,
    },
    {
      id: "qwen-3.8-27b",
      displayName: "Qwen 3.8 27B",
      description: "Shared multilingual reasoning model.",
      pricing: { inputPerTokenUsd: "0.000001", outputPerTokenUsd: "0.000002" },
      supportsImageInput: true,
      supportsReasoning: true,
      contextLength: 131072,
      maxCompletionTokens: 32768,
    },
  ]);
});

test("Cerebras metadata joins by id without importing public-only models", () => {
  const merged = mergeCerebrasModelEntries(
    parseCerebrasModelEntriesPayload(AUTHENTICATED_LIST),
    parseCerebrasPublicModelEntriesPayload(PUBLIC_LIST),
  );
  assert.deepEqual(
    merged.map((entry) => entry.id),
    ["gpt-oss-120b", "qwen-3.8-27b"],
  );
  assert.equal(merged[0]?.contextLength, 131072);
  assert.equal(merged[1]?.supportsImageInput, true);
});

test("Cerebras listing fetches authenticated inventory and unauthenticated rich metadata", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(
        JSON.stringify(url.includes("/public/") ? PUBLIC_LIST : AUTHENTICATED_LIST),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }),
  );

  const entries = await listCerebrasModels({
    baseUrl: "https://api.cerebras.ai/v1",
    apiKey: "test-key",
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(requests, [
    { url: "https://api.cerebras.ai/v1/models", authorization: "Bearer test-key" },
    { url: "https://api.cerebras.ai/public/v1/models", authorization: null },
  ]);
  assert.equal(
    cerebrasPublicModelsListUrl("https://api.cerebras.ai"),
    "https://api.cerebras.ai/public/v1/models",
  );
});

test("Cerebras rich metadata failure retains only the authenticated Shared entries", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/public/")
        ? new Response("blocked", { status: 403 })
        : new Response(JSON.stringify(AUTHENTICATED_LIST), { status: 200 }),
    ),
  );
  assert.deepEqual(
    await listCerebrasModels({ baseUrl: "https://api.cerebras.ai/v1", apiKey: "test-key" }),
    [{ id: "gpt-oss-120b" }, { id: "qwen-3.8-27b" }],
  );
});

test("Cerebras never uses the public catalog as an authentication fallback", async () => {
  const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  await assert.rejects(
    listCerebrasModels({ baseUrl: "https://api.cerebras.ai/v1", apiKey: "bad-key" }),
    /HTTP 401/,
  );
  assert.equal(fetchMock.mock.calls.length, 1);
});
