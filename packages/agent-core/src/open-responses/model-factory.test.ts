import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildResponsesGenerateTools,
  buildResponsesProviderOptions,
  buildResponsesProviderOptionsWithServiceTier,
} from "./model-factory.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import type { ResolvedProviderTools } from "../provider-tools/runtime.js";

const hostTool = {
  type: "function",
  function: {
    name: "grep",
    description: "search",
    parameters: { type: "object", properties: {} },
  },
} as const;

const declaredWebSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web.",
    parameters: { type: "object", properties: {} },
  },
} as const;

function providerToolsWith(
  functionTools: readonly (typeof declaredWebSearchTool)[],
): Pick<ResolvedProviderTools, "functionTools"> {
  return { functionTools: [...functionTools] };
}

test("buildResponsesGenerateTools merges declared provider function tools", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5.4",
      sdk: "@ai-sdk/openai",
    },
    [hostTool],
    providerToolsWith([declaredWebSearchTool]),
  );

  assert.ok("web_search" in tools);
  assert.ok("grep" in tools);
});

test("buildResponsesGenerateTools uses the flat function apply_patch for the SigV4 surface", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      sdk: "@ai-sdk/openai",
      options: { auth: "aws-sigv4", applyPatch: true },
    },
    [hostTool],
  );

  assert.ok("apply_patch" in tools);
  assert.equal("grep" in tools, true);
});

test("buildResponsesGenerateTools uses the SDK apply_patch tool on the openai adapter", () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: "open-responses",
      apiKey: "test-key",
      model: "gpt-5.4",
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
    reasoningEffort: "low",
    store: false,
    options: { reasoningSummary: true },
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
      options: { reasoningSummary: true },
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
    options: { reasoningSummary: true },
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
      options: { reasoningSummary: true },
    }),
    {
      spirit: {
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    },
  );
});

test("buildResponsesProviderOptions generic adapter suppresses summary without the declaration", () => {
  // DeepSeek-shaped: the generic adapter with no reasoningSummary declaration sends no summary.
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
        options: { storedState: true, reasoningSummary: true },
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
        options: { reasoningSummary: true },
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

test("gateway provider options honor input-limited fast without leaking metadata", () => {
  const config = {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-5.4",
    sdk: "@ai-sdk/gateway",
    serviceTier: "fast",
    serviceTiers: {
      default: {},
      fast: {
        providerOptions: { gateway: { serviceTier: "fast" } },
        maxInputTokens: 278528,
      },
    },
  } as const;

  const below = buildResponsesProviderOptionsWithServiceTier({
    ...config,
    lastInputTokens: 1000,
  });
  assert.equal(below.gateway?.serviceTier, "fast");
  assert.equal("maxInputTokens" in below.gateway!, false);

  const above = buildResponsesProviderOptionsWithServiceTier({
    ...config,
    lastInputTokens: 278529,
  });
  assert.equal(above.gateway?.serviceTier, undefined);
});
