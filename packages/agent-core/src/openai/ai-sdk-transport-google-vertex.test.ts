import assert from "node:assert/strict";
import { test } from "vitest";

import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";
import { buildAiSdkProviderOptionsForTests } from "./ai-sdk-transport.js";

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
