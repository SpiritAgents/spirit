import assert from "node:assert/strict";
import { test } from "vitest";

import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesAnthropicModelCatalogMetadata,
  usesProviderListedModelCatalogMetadata,
} from "../../dist-electron/src/host/model-catalog-metadata.js";

const GPT5_EFFORTS = ["minimal", "low", "medium", "high"];
const OPENAI_FLEX_FAST_TIERS = ["auto", "default", "flex", "fast"];
const OPENAI_LIMITED_FAST_TIERS = {
  auto: { body: { service_tier: "auto" } },
  default: { body: { service_tier: "default" } },
  flex: { body: { service_tier: "flex" } },
  fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
};

test("siliconflow provider uses listed model catalog metadata", () => {
  assert.equal(
    usesProviderListedModelCatalogMetadata({
      providerId: "siliconflow",
      transportKind: "openai-compatible",
    }),
    true,
  );

  const preview = previewModelCatalogForTransport({
    providerId: "siliconflow",
    transportKind: "openai-compatible",
    listedModels: [
      { id: "deepseek-ai/DeepSeek-V3" },
      { id: "black-forest-labs/FLUX.1-schnell", supportsImageGeneration: true },
      { id: "Wan-AI/Wan2.2-T2V-A14B", supportsVideoGeneration: true },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "deepseek-ai/DeepSeek-V3",
      displayName: "DeepSeek AI DeepSeek V3",
      capabilities: ["languageModel"],
    },
    {
      id: "black-forest-labs/FLUX.1-schnell",
      displayName: "Black Forest Labs FLUX.1 Schnell",
      capabilities: ["imageGeneration"],
    },
    {
      id: "Wan-AI/Wan2.2-T2V-A14B",
      displayName: "Wan AI Wan2.2 T2V A14B",
      capabilities: ["videoGeneration"],
    },
  ]);
});

test("custom anthropic transport consumes Anthropic model catalog metadata", () => {
  assert.equal(usesAnthropicModelCatalogMetadata({ transportKind: "anthropic" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "custom",
    transportKind: "anthropic",
    listedModels: [
      {
        id: "claude-sonnet-4-20250514",
        supportsImageInput: false,
        supportedReasoningEfforts: ["low", "high", "high", "default", "max"],
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4.20250514",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "high", "max"],
      // Folded from the anthropic-claude model-knowledge record for claude-sonnet-4-* (switch + encoding).
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "enabled", budget_tokens: 12000 } },
          providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    providerId: "custom",
    transportKind: "anthropic",
    modelCatalog: preview,
  });

  assert.deepEqual(catalogMap.get("claude-sonnet-4-20250514"), preview[0]);
});

test("moonshot-ai provider consumes Moonshot model catalog metadata", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "moonshot-ai" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "moonshot-ai",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "kimi-k2.6",
        supportsImageInput: true,
        supportsVideoInput: false,
        supportedReasoningEfforts: [],
        contextLength: 256000,
      },
      {
        id: "kimi-k2.7-code",
        supportedReasoningEfforts: [],
      },
      {
        id: "kimi-k2-turbo-preview",
        supportsImageInput: false,
        supportsVideoInput: false,
        supportedReasoningEfforts: [],
      },
      {
        id: "kimi-k3.1-pro",
        supportsImageInput: true,
        supportsVideoInput: true,
        supportedReasoningEfforts: ["low", "high", "max"],
        contextLength: 1048576,
      },
      {
        id: "kimi-k3.2-pro",
        supportedReasoningEfforts: ["low", "high", "max"],
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "kimi-k2.6",
      displayName: "Kimi K2.6",
      capabilities: ["languageModel", "image"],
      supportedReasoningEfforts: [],
      contextLength: 256000,
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "enabled" } },
          providerOptions: { moonshotai: { thinking: { type: "enabled" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { moonshotai: { thinking: { type: "disabled" } } },
        },
      },
    },
    {
      id: "kimi-k2.7-code",
      displayName: "Kimi K2.7 Code",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: [],
    },
    {
      id: "kimi-k2-turbo-preview",
      displayName: "Kimi K2 Turbo Preview",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: [],
    },
    {
      id: "kimi-k3.1-pro",
      displayName: "Kimi K3.1 Pro",
      capabilities: ["languageModel", "image", "video"],
      supportedReasoningEfforts: ["low", "high", "max"],
      contextLength: 1048576,
      supportsThinkingType: "only",
    },
    {
      id: "kimi-k3.2-pro",
      displayName: "Kimi K3.2 Pro",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "high", "max"],
      supportsThinkingType: "only",
    },
  ]);
});

test("openrouter provider passes through display metadata and pricing", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "anthropic/claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        description: "Balanced reasoning model.",
        pricing: {
          inputPerTokenUsd: "0.000003",
          outputPerTokenUsd: "0.000015",
        },
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "anthropic/claude-sonnet-4",
      displayName: "Claude Sonnet 4",
      description: "Balanced reasoning model.",
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
      },
      capabilities: ["languageModel"],
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "enabled", budget_tokens: 12000 } },
          providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    modelCatalog: preview,
  });

  assert.deepEqual(catalogMap.get("anthropic/claude-sonnet-4"), preview[0]);
});

test("openrouter provider maps output_modalities to catalog capabilities", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "openrouter" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "openai/gpt-4o",
      },
      {
        id: "google/imagen-4",
        supportsImageGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "openai/gpt-4o",
      capabilities: ["languageModel"],
      serviceTiers: ["auto", "default", "fast"],
    },
    {
      id: "google/imagen-4",
      capabilities: ["imageGeneration"],
    },
  ]);
});

test("vercel-ai-gateway provider maps language and image model types to catalog capabilities", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "vercel-ai-gateway" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "vercel-ai-gateway",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "openai/gpt-5",
      },
      {
        id: "google/imagen-4",
        supportsImageGeneration: true,
      },
      {
        id: "alibaba/wan-v2.6-text-to-video",
        supportsVideoGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "openai/gpt-5",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: GPT5_EFFORTS,
      serviceTiers: OPENAI_FLEX_FAST_TIERS,
    },
    {
      id: "google/imagen-4",
      capabilities: ["imageGeneration"],
    },
    {
      id: "alibaba/wan-v2.6-text-to-video",
      capabilities: ["videoGeneration"],
    },
  ]);
});

test("vercel-ai-gateway folds anthropic claude knowledge declarations into catalog entries", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "vercel-ai-gateway",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "anthropic/claude-sonnet-4.6",
      },
      {
        id: "openai/gpt-5",
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "anthropic/claude-sonnet-4.6",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "adaptive" } },
          providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
    {
      id: "openai/gpt-5",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: GPT5_EFFORTS,
      serviceTiers: OPENAI_FLEX_FAST_TIERS,
    },
  ]);
});

test("openrouter folds anthropic claude knowledge declarations into catalog entries", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "anthropic/claude-sonnet-4.6",
      },
      {
        id: "openai/gpt-5",
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "anthropic/claude-sonnet-4.6",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "adaptive" } },
          providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
    {
      id: "openai/gpt-5",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: GPT5_EFFORTS,
      serviceTiers: OPENAI_FLEX_FAST_TIERS,
    },
  ]);
});

test("knowledge declarations win over empty catalog effort lists", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "anthropic/claude-sonnet-4.6",
        supportedReasoningEfforts: [],
      },
    ],
  });

  // The curated knowledge record is the single source of truth for declared efforts; an empty
  // upstream list is treated as a stale fact and replaced.
  assert.deepEqual(preview, [
    {
      id: "anthropic/claude-sonnet-4.6",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "adaptive" } },
          providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
  ]);
});

test("moonshot-ai video input maps to video capability not videoGeneration", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "moonshot-ai",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "moonshot-v1-128k-vision-preview",
        supportsVideoInput: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "moonshot-v1-128k-vision-preview",
      displayName: "Moonshot V1 128k Vision Preview",
      capabilities: ["languageModel", "video"],
    },
  ]);
});

test("xiaomi provider consumes Xiaomi model catalog metadata", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "xiaomi" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "xiaomi",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "mimo-v2.5",
        supportsImageInput: true,
        supportsVideoInput: true,
      },
      {
        id: "mimo-v2-flash",
        supportsImageInput: false,
        supportsVideoInput: false,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "mimo-v2.5",
      displayName: "MiMo V2.5",
      capabilities: ["languageModel", "image", "video"],
      // mimo-v2.5 carries a model-knowledge thinking-switch declaration (v2-flash is excluded).
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: { body: { thinking: { type: "enabled" } } },
        off: { body: { thinking: { type: "disabled" } } },
      },
    },
    {
      id: "mimo-v2-flash",
      displayName: "MiMo V2 Flash",
      capabilities: ["languageModel"],
    },
  ]);
});

test("minimax provider consumes MiniMax model catalog metadata", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "minimax" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "minimax",
    transportKind: "anthropic",
    listedModels: [
      {
        id: "MiniMax-M3",
        supportsImageInput: true,
        supportsVideoInput: true,
      },
      {
        id: "MiniMax-M2.5",
        supportsImageInput: false,
        supportsVideoInput: false,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "MiniMax-M3",
      displayName: "MiniMax M3",
      capabilities: ["languageModel", "image", "video"],
      // minimax-m3 knowledge record: thinking switch.
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "adaptive" } },
          providerOptions: { minimax: { thinking: { type: "adaptive" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { minimax: { thinking: { type: "disabled" } } },
        },
      },
    },
    {
      id: "MiniMax-M2.5",
      displayName: "MiniMax M2.5",
      capabilities: ["languageModel"],
      // minimax-m2.5 knowledge record: thinking is always on.
      supportsThinkingType: "only",
    },
  ]);
});

test("volcengine provider maps domain-derived traits to catalog capabilities", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "volcengine" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "volcengine",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "doubao-1-5-pro-32k-250115",
        displayName: "doubao-1-5-pro-32k",
        contextLength: 131072,
      },
      {
        id: "doubao-seed-1-6-250615",
        supportsImageInput: true,
        supportsVideoInput: true,
      },
      {
        id: "doubao-seedance-2-0-260128",
        supportsVideoGeneration: true,
      },
      {
        id: "doubao-seedream-4-0-250828",
        supportsImageGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "doubao-1-5-pro-32k-250115",
      displayName: "doubao-1-5-pro-32k",
      capabilities: ["languageModel"],
      contextLength: 131072,
    },
    {
      id: "doubao-seed-1-6-250615",
      displayName: "Doubao Seed 1.6 250615",
      capabilities: ["languageModel", "image", "video"],
    },
    {
      id: "doubao-seedance-2-0-260128",
      displayName: "Doubao Seedance 2.0 260128",
      capabilities: ["videoGeneration"],
    },
    {
      id: "doubao-seedream-4-0-250828",
      displayName: "Doubao Seedream 4.0 250828",
      capabilities: ["imageGeneration"],
    },
  ]);
});

test("byteplus provider uses the Ark catalog parser", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "byteplus" }), true);
});

test("meituan provider maps LongCat catalog metadata to preview entries", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "meituan" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "meituan",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "LongCat-2.0",
        displayName: "LongCat-2.0",
        contextLength: 1048576,
        supportsThinkingSwitch: true,
        pricing: {
          inputPerTokenUsd: "0.000002",
          outputPerTokenUsd: "0.000008",
        },
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "LongCat-2.0",
      displayName: "LongCat-2.0",
      capabilities: ["languageModel"],
      contextLength: 1048576,
      supportsThinkingSwitch: true,
      pricing: {
        inputPerTokenUsd: "0.000002",
        outputPerTokenUsd: "0.000008",
      },
    },
  ]);
});

test("tencent-tokenhub provider preserves upstream displayName from models catalog", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "tencent-tokenhub" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "tencent-tokenhub",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek-V4-Pro",
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "deepseek-v4-pro",
      displayName: "DeepSeek-V4-Pro",
      capabilities: ["languageModel"],
      // deepseek-v4-* knowledge record: hybrid thinking tiers.
      supportedReasoningEfforts: ["high", "max"],
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "enabled" } },
          providerOptions: { deepseek: { thinking: { type: "enabled" } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { deepseek: { thinking: { type: "disabled" } } },
        },
      },
    },
  ]);
});

test("mistral provider maps catalog metadata including vision and context length", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "mistral" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "mistral",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "pixtral-large-latest",
        displayName: "Pixtral Large",
        description: "Vision chat model",
        contextLength: 128000,
        supportsImageInput: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "pixtral-large-latest",
      displayName: "Pixtral Large",
      description: "Vision chat model",
      contextLength: 128000,
      capabilities: ["languageModel", "image"],
    },
  ]);
});

test("google provider uses upstream display metadata from native models catalog", () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ providerId: "google" }), true);

  const preview = previewModelCatalogForTransport({
    providerId: "google",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        description: "Preview model for advanced reasoning.",
        contextLength: 1048576 + 8192,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "gemini-3.1-pro-preview",
      displayName: "Gemini 3.1 Pro Preview",
      description: "Preview model for advanced reasoning.",
      capabilities: ["languageModel"],
      contextLength: 1048576 + 8192,
      // gemini-3+ knowledge record: effort tiers.
      supportedReasoningEfforts: ["low", "medium", "high"],
      // The gemini knowledge records declare the literal tier map (Gemini serviceTier wire enum).
      serviceTiers: {
        default: { body: { serviceTier: "standard" } },
        flex: { body: { serviceTier: "flex" } },
        priority: { body: { serviceTier: "priority" } },
      },
    },
  ]);
});

test("custom openai-compatible entries produce generic catalog metadata", () => {
  assert.equal(usesAnthropicModelCatalogMetadata({ transportKind: "openai-compatible" }), false);

  // Custom entries list via the generic openai-models shape; metadata (display name synthesis +
  // knowledge declarations) applies to any listing.
  assert.deepEqual(
    previewModelCatalogForTransport({
      providerId: "custom",
      transportKind: "openai-compatible",
      listedModels: [
        { id: "some-model", supportsImageInput: true, supportedReasoningEfforts: ["low"] },
      ],
    }),
    [
      {
        id: "some-model",
        displayName: "Some Model",
        capabilities: ["languageModel", "image"],
        supportedReasoningEfforts: ["low"],
      },
    ],
  );

  assert.equal(
    previewCatalogMapForTransport({
      providerId: "custom",
      transportKind: "openai-compatible",
      modelCatalog: [{ id: "some-model", capabilities: ["languageModel", "image"] }],
    }).size,
    1,
  );
});

test("openrouter provider passes contextLength through catalog metadata", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "anthropic/claude-sonnet-4",
        contextLength: 200000,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "anthropic/claude-sonnet-4",
      capabilities: ["languageModel"],
      contextLength: 200000,
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "enabled", budget_tokens: 12000 } },
          providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
        },
        off: {
          body: { thinking: { type: "disabled" } },
          providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        },
      },
    },
  ]);
});

test("kimi-code provider maps catalog traits including displayName and supportsThinkingType", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "kimi-code",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "kimi-for-coding",
        displayName: "K2.7 Code",
        supportsImageInput: true,
        supportsVideoInput: true,
        supportsReasoning: true,
        supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
        contextLength: 262144,
        supportsThinkingType: "only",
      },
      {
        id: "k3",
        displayName: "K3",
        supportsImageInput: true,
        supportedReasoningEfforts: ["low", "high", "max"],
        defaultReasoningEffort: "high",
        contextLength: 262144,
        supportsThinkingType: "only",
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "kimi-for-coding",
      displayName: "K2.7 Code",
      capabilities: ["languageModel", "image", "video"],
      supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
      contextLength: 262144,
      supportsThinkingType: "only",
    },
    {
      id: "k3",
      displayName: "K3",
      capabilities: ["languageModel", "image"],
      supportedReasoningEfforts: ["low", "high", "max"],
      defaultReasoningEffort: "high",
      contextLength: 262144,
      supportsThinkingType: "only",
    },
  ]);
});

test("hugging-face provider preserves inferenceProvider in preview catalog", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "hugging-face",
    transportKind: "open-responses",
    listedModels: [
      {
        id: "org/flux-model",
        supportsImageGeneration: true,
        inferenceProvider: "fal-ai",
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "org/flux-model",
      displayName: "Org Flux Model",
      capabilities: ["imageGeneration"],
      inferenceProvider: "fal-ai",
    },
  ]);
});

test("aggregator providers preserve upstreamProvider through preview and catalog map", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "vercel-ai-gateway",
    transportKind: "open-responses",
    listedModels: [
      { id: "openai/gpt-5.4", upstreamProvider: "OpenAI" },
      { id: "meta/llama-4-maverick" },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: "openai/gpt-5.4",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
      serviceTiers: OPENAI_LIMITED_FAST_TIERS,
      upstreamProvider: "OpenAI",
    },
    {
      id: "meta/llama-4-maverick",
      capabilities: ["languageModel"],
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    providerId: "openrouter",
    transportKind: "openai-compatible",
    modelCatalog: [{ id: "x-ai/grok-4.3", upstreamProvider: "x-ai" }],
  });

  assert.equal(catalogMap.get("x-ai/grok-4.3")?.upstreamProvider, "x-ai");
});

test("legacy OpenAI knowledge folds exact efforts and tiers into direct catalog entries", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "openai",
    transportKind: "open-responses",
    listedModels: [{ id: "gpt-5.4" }, { id: "gpt-5.3-codex" }, { id: "gpt-4.1" }],
  });
  const byId = new Map(preview?.map((entry) => [entry.id, entry]));

  assert.deepEqual(byId.get("gpt-5.4")?.supportedReasoningEfforts, [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(byId.get("gpt-5.4")?.serviceTiers, OPENAI_LIMITED_FAST_TIERS);
  assert.deepEqual(byId.get("gpt-5.3-codex")?.supportedReasoningEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(byId.get("gpt-5.3-codex")?.serviceTiers, ["auto", "default"]);
  assert.deepEqual(byId.get("gpt-4.1")?.serviceTiers, ["auto", "default", "fast"]);
  assert.equal(byId.get("gpt-4.1")?.supportedReasoningEfforts, undefined);
});

test("parser-materialized serviceTiers win over the provider-agnostic knowledge record", () => {
  // The vercel parser declares the route-specific literal map for openai-upstream routes; the
  // provider-agnostic gpt-5.6+ knowledge list (with the OpenAI-native auto tier) must not win.
  const preview = previewModelCatalogForTransport({
    providerId: "vercel-ai-gateway",
    transportKind: "open-responses",
    listedModels: [
      {
        id: "openai/gpt-5.6",
        upstreamProvider: "OpenAI",
        serviceTiers: {
          default: {},
          flex: { providerOptions: { gateway: { serviceTier: "flex" } } },
          fast: { providerOptions: { gateway: { serviceTier: "fast" } } },
        },
      },
    ],
  });

  assert.deepEqual(preview?.[0]?.serviceTiers, {
    default: {},
    flex: { providerOptions: { gateway: { serviceTier: "flex" } } },
    fast: { providerOptions: { gateway: { serviceTier: "fast" } } },
  });
});

test("an explicit empty parser declaration suppresses the knowledge tier fold", () => {
  // anthropic/claude-opus-4.8 matches the Opus 4.8 knowledge record (native Fast); the vercel
  // parser declares no tiers for anthropic upstreams, and the explicit empty list must hold.
  const preview = previewModelCatalogForTransport({
    providerId: "vercel-ai-gateway",
    transportKind: "open-responses",
    listedModels: [
      { id: "anthropic/claude-opus-4.8", upstreamProvider: "Anthropic", serviceTiers: [] },
    ],
  });

  assert.deepEqual(preview?.[0]?.serviceTiers, []);
});

test("bedrock listings withhold the provider-agnostic knowledge tier declaration", () => {
  // Converse has no service tier parameter, so the Claude Opus Fast declaration must not fold
  // onto a Bedrock entry (it would be a no-op control).
  const preview = previewModelCatalogForTransport({
    providerId: "amazon-bedrock",
    transportKind: "bedrock",
    listedModels: [{ id: "anthropic.claude-opus-5-5-v1" }],
  });

  assert.equal(preview?.[0]?.serviceTiers, undefined);

  // Direct anthropic listings do fold it.
  const direct = previewModelCatalogForTransport({
    providerId: "anthropic",
    transportKind: "anthropic",
    listedModels: [{ id: "claude-opus-5.5" }],
  });

  assert.deepEqual(direct?.[0]?.serviceTiers, ["fast"]);
});

test("muse model ids override stale catalog reasoning efforts on any provider", () => {
  const preview = previewModelCatalogForTransport({
    providerId: "custom",
    transportKind: "openai-compatible",
    listedModels: [
      {
        id: "meta/muse-spark-1.3-contributor",
        supportedReasoningEfforts: ["none", "max"],
      },
      { id: "muse-wonder-1.0" },
    ],
  });

  assert.deepEqual(preview?.[0]?.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(preview?.[1]?.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});
