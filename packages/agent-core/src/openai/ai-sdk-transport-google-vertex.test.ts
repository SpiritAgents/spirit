import assert from "node:assert/strict";
import { test } from "vitest";

import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";
import {
  AiSdkOpenAiCompatibleTransport,
  buildAiSdkProviderOptionsForTests,
} from "./ai-sdk-transport.js";

test("google-vertex adapter maps a declared reasoning effort onto thinkingConfig", () => {
  assert.deepEqual(
    buildAiSdkProviderOptionsForTests({
      apiKey: "k",
      model: "gemini-3.1-pro",
      sdk: "@ai-sdk/google-vertex",
      reasoningEffort: "high",
    }),
    { vertex: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } },
  );
  assert.deepEqual(
    buildAiSdkProviderOptionsForTests({
      apiKey: "k",
      model: "gemini-4-neon",
      sdk: "@ai-sdk/google-vertex",
      reasoningEffort: "xhigh",
    }),
    { vertex: { thinkingConfig: { thinkingLevel: "xhigh", includeThoughts: true } } },
  );
});

test("Google Vertex Gemini 4 Neon sends thinkingLevel xhigh on the wire", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "VERTEX_XHIGH_OK" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
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
        apiKey: "test-vertex-key",
        model: "gemini-4-neon",
        baseUrl:
          "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/publishers/google",
        sdk: "@ai-sdk/google-vertex",
        reasoningEffort: "xhigh",
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    const generationConfig = capturedBody?.generationConfig;
    assert.ok(
      generationConfig && typeof generationConfig === "object" && !Array.isArray(generationConfig),
    );
    assert.deepEqual((generationConfig as Record<string, unknown>).thinkingConfig, {
      thinkingLevel: "xhigh",
      includeThoughts: true,
    });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Google Vertex code-completion profile maps reasoningEffort none to thinkingBudget 0", () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: "k",
    model: "gemini-2.5-flash",
    sdk: "@ai-sdk/google-vertex",
    reasoningEffort: "high",
  }) as OpenAiTransportConfig;

  assert.equal(config.transportRequestProfile, "code-completion");
  assert.equal(config.reasoningEffort, "none");
  assert.deepEqual(buildAiSdkProviderOptionsForTests(config), {
    vertex: { thinkingConfig: { thinkingBudget: 0 } },
  });
});
