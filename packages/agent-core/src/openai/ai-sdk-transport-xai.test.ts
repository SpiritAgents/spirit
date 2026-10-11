import assert from "node:assert/strict";
import { test } from "vitest";

import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("xAI chat transport fails with guidance toward open-responses", async () => {
  // @ai-sdk/xai 5 removed the Chat Completions implementation; the route now fails fast and
  // points at the Responses transport instead of silently falling back to the generic
  // OpenAI-compatible provider.
  const transport = new AiSdkOpenAiCompatibleTransport();
  const result = await transport.startToolAgentRound(
    {
      apiKey: "test-key",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      llmVendor: "xai",
      reasoningEffort: "high",
      workspaceRoot: process.cwd(),
    },
    { messages: [{ role: "user", content: "hello" }], steps: 0 },
    [],
  );

  assert.equal(result.kind, "failure");
  assert.match(result.kind === "failure" ? result.error : "", /open-responses/);
});

test("xAI code-completion profile on the chat transport gets the same guidance", async () => {
  const transport = new AiSdkOpenAiCompatibleTransport();
  const config = applyCodeCompletionTransportProfile({
    apiKey: "test-key",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
    llmVendor: "xai",
    reasoningEffort: "high",
    workspaceRoot: process.cwd(),
  }) as import("./openai-compat.js").OpenAiTransportConfig;

  const result = await transport.startToolAgentRound(
    config,
    { messages: [{ role: "user", content: "hello" }], steps: 0 },
    [],
  );

  assert.equal(result.kind, "failure");
  assert.match(result.kind === "failure" ? result.error : "", /open-responses/);
});
