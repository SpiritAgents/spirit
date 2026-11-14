import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("OpenAI-compatible declares apply_patch as a custom function", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const result = await new AiSdkOpenAiCompatibleTransport().startToolAgentRound(
      {
        transportKind: "openai-compatible",
        apiKey: "test-key",
        model: "openai/gpt-5.4",
        baseUrl: "https://router.test/v1",
        sdk: "@ai-sdk/openai-compatible",
        options: { applyPatch: true },
      },
      { messages: [{ role: "user", content: "edit a file" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    assert.ok(capturedBody);
    const tools = capturedBody.tools as Array<{
      type: string;
      function: { name: string; description: string };
    }>;
    const applyPatch = tools.find((tool) => tool.function.name === "apply_patch");
    assert.ok(applyPatch);
    assert.equal(applyPatch.type, "function");
    assert.match(applyPatch.function.description, /V4A/);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
