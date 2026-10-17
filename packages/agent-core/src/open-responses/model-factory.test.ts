import assert from "node:assert/strict";
import { test } from "vitest";

import { buildResponsesGenerateTools, buildResponsesProviderOptions } from "./model-factory.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";

const hostTool = {
  type: "function",
  function: {
    name: "grep",
    description: "search",
    parameters: { type: "object", properties: {} },
  },
} as const;

test("buildResponsesGenerateTools adds web_search for the openai adapter when enabled", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5.4",
      llmVendor: "openai",
      sdk: "@ai-sdk/openai",
    },
    [hostTool],
  );

  assert.ok("web_search" in tools);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools adds web_search for the gateway adapter route", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
      sdk: "@ai-sdk/gateway",
    },
    [hostTool],
  );

  assert.ok("web_search" in tools);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools uses the flat function apply_patch for declared Bedrock Mantle", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      sdk: "@ai-sdk/openai",
      options: { applyPatch: true },
    },
    [hostTool],
  );

  assert.ok("apply_patch" in tools);
  assert.equal("grep" in tools, true);
});

test("buildResponsesGenerateTools omits sdk web_search for Bedrock Mantle", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      sdk: "@ai-sdk/openai",
      options: { applyPatch: true },
    },
    [hostTool],
  );

  assert.equal("web_search" in tools, false);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools uses the SDK apply_patch tool on the openai adapter", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5.4",
      llmVendor: "openai",
      sdk: "@ai-sdk/openai",
      options: { applyPatch: true },
    },
    [hostTool],
  );

  assert.ok("apply_patch" in tools);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools adds no apply_patch without the options declaration", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5.4",
      sdk: "@ai-sdk/openai",
    },
    [hostTool],
  );

  assert.equal("apply_patch" in tools, false);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools adds web_search for the xai adapter", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "grok-4",
      llmVendor: "xai",
      sdk: "@ai-sdk/xai",
    },
    [hostTool],
  );

  assert.ok("web_search" in tools);
});

test("buildResponsesProviderOptions passes the declared reasoning effort verbatim on xai", () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "grok-4.3",
      sdk: "@ai-sdk/xai",
      reasoningEffort: "none",
    }),
    {
      xai: {
        reasoningEffort: "none",
      },
    },
  );
});

test("buildResponsesProviderOptions maps azure provider options", () => {
  const options = buildResponsesProviderOptions({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "my-deploy",
    sdk: "@ai-sdk/azure",
    azureResourceName: "my-resource",
    reasoningEffort: "low",
    store: false,
  });

  assert.deepEqual(options, {
    azure: {
      store: false,
      truncation: "disabled",
      reasoningEffort: "low",
      reasoningSummary: "auto",
    },
  });
});

test("buildResponsesProviderOptions passes effort, pro mode, and summary on the openai adapter", () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-6-astra",
      sdk: "@ai-sdk/openai",
      reasoningEffort: "max",
      reasoningMode: "pro",
      reasoningSummary: "detailed",
    }),
    {
      openai: {
        store: true,
        truncation: "disabled",
        reasoningEffort: "max",
        reasoningMode: "pro",
        reasoningSummary: "detailed",
      },
    },
  );
});

test("buildResponsesProviderOptions attaches previousResponseId for openai stored state", () => {
  const options = buildResponsesProviderOptions(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5",
      sdk: "@ai-sdk/openai",
    },
    "resp_chain_1",
  );

  assert.equal(options.openai?.store, true);
  assert.equal(options.openai?.previousResponseId, "resp_chain_1");
});

test("buildResponsesProviderOptions omits reasoning for the code-completion profile", () => {
  const config = applyCodeCompletionTransportProfile({
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "gpt-5",
    sdk: "@ai-sdk/openai",
    reasoningEffort: "high",
    reasoningSummary: "detailed",
  });

  assert.deepEqual(
    buildResponsesProviderOptions(
      config as import("./responses-compat.js").OpenResponsesTransportConfig,
    ),
    {
      openai: {
        store: true,
        truncation: "disabled",
        reasoningEffort: "none",
      },
    },
  );
});

test("buildResponsesProviderOptions maps huggingface reasoningEffort to the huggingface namespace", () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: "open-responses",
      apiKey: "hf_test",
      model: "deepseek-ai/DeepSeek-R1",
      baseUrl: "https://router.huggingface.co/v1",
      sdk: "@ai-sdk/huggingface",
      reasoningEffort: "high",
    }),
    {
      huggingface: {
        reasoningEffort: "high",
      },
    },
  );
});

test("buildResponsesProviderOptions uses the generic adapter namespace verbatim declarations", () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "some-model",
      sdk: "@ai-sdk/open-responses",
      reasoningEffort: "medium",
    }),
    {
      spirit: {
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    },
  );
});

test("buildResponsesProviderOptions generic adapter suppresses summary where the wire drops it", () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "some-model",
      sdk: "@ai-sdk/minimax",
      reasoningEffort: "medium",
    }),
    {
      spirit: {
        reasoningEffort: "medium",
      },
    },
  );
});

test("buildResponsesProviderOptions generic adapter honors options.storedState", () => {
  assert.deepEqual(
    buildResponsesProviderOptions(
      {
        transportKind: "open-responses",
        apiKey: "test-key",
        model: "some-model",
        sdk: "@ai-sdk/open-responses",
        options: { storedState: true },
      },
      "resp_prev",
    ),
    {
      spirit: {
        reasoningSummary: "auto",
        store: true,
        previousResponseId: "resp_prev",
      },
    },
  );
});

test("buildResponsesProviderOptions generic adapter omits store without the storedState declaration", () => {
  assert.deepEqual(
    buildResponsesProviderOptions(
      {
        transportKind: "open-responses",
        apiKey: "test-key",
        model: "some-model",
        sdk: "@ai-sdk/open-responses",
      },
      "resp_prev",
    ),
    {
      spirit: {
        reasoningSummary: "auto",
      },
    },
  );
});
