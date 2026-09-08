import assert from "node:assert/strict";
import { test } from "vitest";

import {
  moonshotK3SupportedReasoningEfforts,
  moonshotSupportedReasoningEfforts,
  parseAnthropicModelEntriesPayload,
  parseGoogleModelEntriesPayload,
  parseOpenAiCompatibleModelEntriesPayload,
  parseMoonshotModelEntriesPayload,
  parseKimiCodeModelEntriesPayload,
  parseOpenRouterModelEntriesPayload,
  parseSiliconFlowModelEntriesPayload,
  parseVercelAiGatewayModelEntriesPayload,
  parseArkModelEntriesPayload,
  parseXiaomiModelEntriesPayload,
  parseMinimaxModelEntriesPayload,
  parseMeituanModelDetailPayload,
  parseTencentTokenHubModelEntriesPayload,
  parseMistralModelEntriesPayload,
  openAiCompatibleModelDetailUrl,
  mergeFireworksAiGatewayModelPages,
  parseFireworksAiGatewayModelsPayload,
  fireworksAiGatewayModelsListUrl,
  parseTogetherAiModelEntriesPayload,
  parseHuggingFaceRouterModelsPayload,
  parseHuggingFaceHubMediaModelsPayload,
  parseHuggingFaceHubLinkHeaderNextUrl,
  mergeHuggingFaceListedModelEntries,
  resolveHuggingFaceDisplayNameFromId,
  parseBasetenModelEntriesPayload,
  parseGroqModelEntriesPayload,
  resolveGroqDisplayNameFromId,
  cohereModelsListUrl,
  mergeCohereModelPages,
  parseCohereModelEntriesPayload,
  parseDeepInfraModelEntriesPayload,
  minimaxOpenAiCompatibleListingBaseFromConnectBase,
} from "./openai-models.js";

test("minimaxOpenAiCompatibleListingBaseFromConnectBase preserves site from anthropic connect base", () => {
  assert.equal(
    minimaxOpenAiCompatibleListingBaseFromConnectBase("https://api.minimaxi.com/anthropic/v1"),
    "https://api.minimaxi.com/v1",
  );
  assert.equal(
    minimaxOpenAiCompatibleListingBaseFromConnectBase("https://api.minimax.io/anthropic/v1"),
    "https://api.minimax.io/v1",
  );
  assert.equal(
    minimaxOpenAiCompatibleListingBaseFromConnectBase("https://api.minimaxi.com/v1"),
    "https://api.minimaxi.com/v1",
  );
});

test("parseAnthropicModelEntriesPayload extracts image input and supported effort levels", () => {
  const entries = parseAnthropicModelEntriesPayload({
    data: [
      {
        id: "claude-sonnet-4-5",
        capabilities: {
          image_input: { supported: true },
          effort: {
            supported: true,
            low: { supported: true },
            medium: { supported: true },
            high: { supported: true },
            xhigh: { supported: false },
            max: { supported: false },
          },
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "claude-sonnet-4-5",
      supportsImageInput: true,
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ]);
});

test("parseAnthropicModelEntriesPayload keeps explicit no-effort support as empty list", () => {
  const entries = parseAnthropicModelEntriesPayload({
    data: [
      {
        id: "claude-haiku-no-effort",
        capabilities: {
          image_input: { supported: false },
          effort: { supported: false },
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "claude-haiku-no-effort",
      supportsImageInput: false,
      supportedReasoningEfforts: [],
    },
  ]);
});

test("parseMoonshotModelEntriesPayload maps Moonshot model trait fields", () => {
  const entries = parseMoonshotModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "kimi-k2.5",
        object: "model",
        supports_image_in: true,
        supports_video_in: false,
        supports_reasoning: true,
        context_length: 256000,
      },
      {
        id: "kimi-k2-turbo-preview",
        supports_image_in: false,
        supports_video_in: false,
        supports_reasoning: false,
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "kimi-k2.5",
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsReasoning: true,
      supportedReasoningEfforts: moonshotSupportedReasoningEfforts(true),
      contextLength: 256000,
    },
    {
      id: "kimi-k2-turbo-preview",
      supportsImageInput: false,
      supportsVideoInput: false,
      supportsReasoning: false,
      supportedReasoningEfforts: [],
    },
  ]);
});

test("moonshotSupportedReasoningEfforts uses k3 low/high/max efforts for kimi-k3", () => {
  assert.deepEqual(
    moonshotSupportedReasoningEfforts(true, "kimi-k3"),
    moonshotK3SupportedReasoningEfforts(),
  );
  assert.deepEqual(
    moonshotSupportedReasoningEfforts(true, "moonshotai/kimi-k3"),
    moonshotK3SupportedReasoningEfforts(),
  );
  assert.deepEqual(moonshotSupportedReasoningEfforts(true, "kimi-k2.5"), [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload infers kimi-k3 reasoning efforts", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "moonshotai/kimi-k3",
        type: "language",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "moonshotai/kimi-k3",
      supportedReasoningEfforts: moonshotK3SupportedReasoningEfforts(),
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload infers max effort for gpt-5.6 openai models", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "openai/gpt-5.6-sol",
        type: "language",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "openai/gpt-5.6-sol",
      supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload infers max effort for direct gpt-5.6 models", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    data: [{ id: "gpt-5.6-sol" }],
  });

  assert.deepEqual(entries, [
    {
      id: "gpt-5.6-sol",
      supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload leaves gpt-5.5 without gpt56 effort list", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    data: [{ id: "gpt-5.5" }],
  });

  assert.deepEqual(entries, [{ id: "gpt-5.5" }]);
});

test("parseKimiCodeModelEntriesPayload maps Kimi Code model trait fields", () => {
  const entries = parseKimiCodeModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "kimi-for-coding",
        display_name: "K2.7 Code",
        context_length: 262144,
        supports_reasoning: true,
        supports_image_in: true,
        supports_video_in: true,
        supports_thinking_type: "only",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "kimi-for-coding",
      displayName: "K2.7 Code",
      supportsImageInput: true,
      supportsVideoInput: true,
      supportsReasoning: true,
      supportedReasoningEfforts: moonshotSupportedReasoningEfforts(true),
      contextLength: 262144,
      supportsThinkingType: "only",
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes kimi-code to Kimi parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        {
          id: "kimi-for-coding",
          display_name: "K2.7 Code",
          supports_image_in: true,
          supports_thinking_type: "only",
        },
      ],
    },
    "kimi-code",
  );

  assert.deepEqual(entries, [
    {
      id: "kimi-for-coding",
      displayName: "K2.7 Code",
      supportsImageInput: true,
      supportsThinkingType: "only",
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload keeps xAI models as plain ids", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: "list",
      data: [
        { id: "grok-4.3", object: "model" },
        { id: " grok-code-fast-1 " },
        { object: "model" },
      ],
    },
    "xai",
  );

  assert.deepEqual(entries, [{ id: "grok-4.3" }, { id: "grok-code-fast-1" }]);
});

test("parseVercelAiGatewayModelEntriesPayload maps language and image types", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "openai/gpt-5",
        type: "language",
        tags: ["vision", "tool-use"],
        context_window: 128000,
      },
      {
        id: "google/imagen-4",
        type: "image",
      },
      {
        id: "alibaba/wan-v2.6-text-to-video",
        type: "video",
      },
      {
        id: "openai/text-embedding-3-small",
        type: "embedding",
      },
      {
        id: "legacy/model-without-type",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "openai/gpt-5",
      contextLength: 128000,
      supportsImageInput: true,
    },
    {
      id: "google/imagen-4",
      supportsImageGeneration: true,
    },
    {
      id: "alibaba/wan-v2.6-text-to-video",
      supportsVideoGeneration: true,
    },
    {
      id: "legacy/model-without-type",
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload maps vision tag to supportsImageInput for language models", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "openai/gpt-4o",
        type: "language",
        tags: ["tool-use", "vision", "file-input"],
      },
      {
        id: "alibaba/qwen-3-14b",
        type: "language",
        tags: ["reasoning", "tool-use"],
      },
      {
        id: "google/gemini-2.5-flash-image",
        type: "language",
        tags: ["image-generation", "implicit-caching", "web-search"],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "openai/gpt-4o",
      supportsImageInput: true,
    },
    {
      id: "alibaba/qwen-3-14b",
    },
    {
      id: "google/gemini-2.5-flash-image",
      supportedReasoningEfforts: ["none", "low", "medium", "high"],
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload infers supportedReasoningEfforts for anthropic claude models", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-sonnet-4.6",
        type: "language",
      },
      {
        id: "anthropic/claude-opus-4.7",
        type: "language",
      },
      {
        id: "openai/gpt-5",
        type: "language",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4.6",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "anthropic/claude-opus-4.7",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "openai/gpt-5",
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload infers supportedReasoningEfforts for google gemini models", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "google/gemini-3.1-pro-preview",
        type: "language",
      },
      {
        id: "google/gemini-2.5-flash",
        type: "language",
      },
      {
        id: "google/imagen-4",
        type: "image",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "google/gemini-3.1-pro-preview",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "google/gemini-2.5-flash",
      supportedReasoningEfforts: ["none", "low", "medium", "high"],
    },
    {
      id: "google/imagen-4",
      supportsImageGeneration: true,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes vercel-ai-gateway to typed parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        { id: "openai/gpt-5", type: "language" },
        { id: "google/imagen-4", type: "image" },
        { id: "cohere/rerank-english-v3.0", type: "reranking" },
      ],
    },
    "vercel-ai-gateway",
  );

  assert.deepEqual(entries, [
    { id: "openai/gpt-5" },
    { id: "google/imagen-4", supportsImageGeneration: true },
  ]);
});

test("parseOpenRouterModelEntriesPayload classifies output_modalities", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "openai/gpt-4o",
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "google/imagen-4",
        architecture: { output_modalities: ["image"] },
      },
      {
        id: "openai/gpt-image-1",
        output_modalities: ["text", "image"],
      },
      {
        id: "openai/text-embedding-3-small",
        architecture: { output_modalities: ["embedding"] },
      },
      {
        id: "legacy/model-without-modalities",
      },
    ],
  });

  assert.deepEqual(entries, [
    { id: "openai/gpt-4o" },
    { id: "google/imagen-4", supportsImageGeneration: true },
    { id: "openai/gpt-image-1" },
    { id: "legacy/model-without-modalities" },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload extracts display metadata and pricing", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        description: "General-purpose language model.",
        type: "language",
        context_window: 128000,
        pricing: {
          input: "0.000001",
          output: "0.000002",
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "openai/gpt-5",
      displayName: "GPT-5",
      description: "General-purpose language model.",
      pricing: {
        inputPerTokenUsd: "0.000001",
        outputPerTokenUsd: "0.000002",
      },
      contextLength: 128000,
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload extracts video duration pricing", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "alibaba/wan-v2.6-t2v",
        name: "Wan v2.6 Text-to-Video",
        type: "video",
        pricing: {
          video_duration_pricing: [
            { resolution: "720p", cost_per_second: "0.1" },
            { resolution: "1080p", cost_per_second: "0.15" },
          ],
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "alibaba/wan-v2.6-t2v",
      displayName: "Wan v2.6 Text-to-Video",
      pricing: {
        videoDurationPricing: [
          { resolution: "720p", costPerSecondUsd: "0.1" },
          { resolution: "1080p", costPerSecondUsd: "0.15" },
        ],
      },
      supportsVideoGeneration: true,
    },
  ]);
});

test("parseVercelAiGatewayModelEntriesPayload extracts video duration pricing with audio tiers", () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: "google/veo-3.1-generate-001",
        name: "Veo 3.1",
        type: "video",
        pricing: {
          video_duration_pricing: [
            { resolution: "720p", audio: false, cost_per_second: "0.2" },
            { resolution: "720p", audio: true, cost_per_second: "0.4" },
            { resolution: "4k", audio: true, cost_per_second: "0.6" },
          ],
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "google/veo-3.1-generate-001",
      displayName: "Veo 3.1",
      pricing: {
        videoDurationPricing: [
          { resolution: "720p", costPerSecondUsd: "0.2" },
          { resolution: "720p", costPerSecondUsd: "0.4", audio: true },
          { resolution: "4k", costPerSecondUsd: "0.6", audio: true },
        ],
      },
      supportsVideoGeneration: true,
    },
  ]);
});

test("parseOpenRouterModelEntriesPayload extracts display metadata and pricing", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        description: "Balanced reasoning model.",
        architecture: { output_modalities: ["text"] },
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          request: "0",
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4",
      displayName: "Claude Sonnet 4",
      description: "Balanced reasoning model.",
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
        requestPerCallUsd: "0",
      },
    },
  ]);
});

test("parseOpenRouterModelEntriesPayload reads reasoning supported_efforts from api", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-sonnet-4.6",
        architecture: { output_modalities: ["text"] },
        reasoning: { supported_efforts: ["high", "medium", "low"] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4.6",
      supportedReasoningEfforts: ["high", "medium", "low"],
    },
  ]);
});

test("parseOpenRouterModelEntriesPayload keeps explicit empty supported_efforts without claude fallback", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-sonnet-4.6",
        architecture: { output_modalities: ["text"] },
        reasoning: { supported_efforts: [] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4.6",
      supportedReasoningEfforts: [],
    },
  ]);
});

test("parseOpenRouterModelEntriesPayload infers claude efforts when api omits reasoning", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-opus-4.8",
        architecture: { output_modalities: ["text"] },
      },
    ],
  });

  assert.deepEqual(entries[0]?.supportedReasoningEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("parseXiaomiModelEntriesPayload marks multimodal allowlist models", () => {
  const entries = parseXiaomiModelEntriesPayload({
    object: "list",
    data: [
      { id: "mimo-v2.5", object: "model", owned_by: "xiaomi" },
      { id: "mimo-v2-omni", object: "model", owned_by: "xiaomi" },
      { id: "mimo-v2-flash", object: "model", owned_by: "xiaomi" },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "mimo-v2.5",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: "mimo-v2-omni",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: "mimo-v2-flash",
      supportsImageInput: false,
      supportsVideoInput: false,
    },
  ]);
});

test("parseMinimaxModelEntriesPayload marks M3 multimodal models only", () => {
  const entries = parseMinimaxModelEntriesPayload({
    object: "list",
    data: [
      { id: "MiniMax-M3", object: "model" },
      { id: "minimax-m3", object: "model" },
      { id: "MiniMax-M2.5", object: "model" },
      { id: "MiniMax-M2.5-highspeed", object: "model" },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "MiniMax-M3",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: "minimax-m3",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: "MiniMax-M2.5",
      supportsImageInput: false,
      supportsVideoInput: false,
    },
    {
      id: "MiniMax-M2.5-highspeed",
      supportsImageInput: false,
      supportsVideoInput: false,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes minimax provider to minimax parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: "list",
      data: [{ id: "MiniMax-M3", object: "model" }],
    },
    "minimax",
  );

  assert.deepEqual(entries, [
    {
      id: "MiniMax-M3",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload without provider omits minimax multimodal flags", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    object: "list",
    data: [{ id: "MiniMax-M3", object: "model" }],
  });

  assert.deepEqual(entries, [{ id: "MiniMax-M3" }]);
});

test("parseOpenAiCompatibleModelEntriesPayload marks deepseek-v4-flash-vision-exp as image input", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: "list",
      data: [
        { id: "deepseek-v4-flash", object: "model" },
        { id: "deepseek-v4-flash-vision-exp", object: "model" },
        { id: "deepseek-v4-pro", object: "model" },
      ],
    },
    "deepseek",
  );

  assert.deepEqual(entries, [
    { id: "deepseek-v4-flash" },
    { id: "deepseek-v4-flash-vision-exp", supportsImageInput: true },
    { id: "deepseek-v4-pro" },
  ]);
});

test("parseSiliconFlowModelEntriesPayload marks capabilities by list kind", () => {
  const chatEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: "list",
      data: [
        { id: "Qwen/Qwen2.5-VL-7B-Instruct", object: "model" },
        { id: "deepseek-ai/DeepSeek-V3", object: "model" },
      ],
    },
    "chat",
  );
  assert.deepEqual(chatEntries, [
    { id: "Qwen/Qwen2.5-VL-7B-Instruct", supportsImageInput: true },
    { id: "deepseek-ai/DeepSeek-V3" },
  ]);

  const imageEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: "list",
      data: [{ id: "black-forest-labs/FLUX.1-schnell", object: "model" }],
    },
    "image",
  );
  assert.deepEqual(imageEntries, [
    { id: "black-forest-labs/FLUX.1-schnell", supportsImageGeneration: true },
  ]);

  const videoEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: "list",
      data: [{ id: "Wan-AI/Wan2.2-T2V-A14B", object: "model" }],
    },
    "video",
  );
  assert.deepEqual(videoEntries, [{ id: "Wan-AI/Wan2.2-T2V-A14B", supportsVideoGeneration: true }]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes xiaomi provider to xiaomi parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: "list",
      data: [{ id: "mimo-v2.5", object: "model" }],
    },
    "xiaomi",
  );

  assert.deepEqual(entries, [
    {
      id: "mimo-v2.5",
      supportsImageInput: true,
      supportsVideoInput: true,
    },
  ]);
});

test("parseArkModelEntriesPayload maps domain and skips shutdown models", () => {
  const entries = parseArkModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "doubao-1-5-pro-32k-250115",
        name: "doubao-1-5-pro-32k",
        domain: "LLM",
        token_limits: { context_window: 131072 },
      },
      {
        id: "doubao-seed-1-6-250615",
        name: "doubao-seed-1-6",
        domain: "VLM",
        modalities: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] },
        token_limits: { context_window: 262144 },
      },
      {
        id: "doubao-seedance-2-0-260128",
        name: "doubao-seedance-2-0",
        domain: "VideoGeneration",
      },
      {
        id: "doubao-seedream-4-0-250828",
        name: "doubao-seedream-4-0",
        domain: "ImageGeneration",
      },
      {
        id: "doubao-pro-32k-240828",
        name: "doubao-pro-32k",
        domain: "LLM",
        status: "Shutdown",
      },
      {
        id: "doubao-embedding-text-240515",
        name: "doubao-embedding",
        domain: "Embedding",
        status: "Retiring",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "doubao-1-5-pro-32k-250115",
      displayName: "doubao-1-5-pro-32k",
      contextLength: 131072,
    },
    {
      id: "doubao-seed-1-6-250615",
      displayName: "doubao-seed-1-6",
      supportsImageInput: true,
      supportsVideoInput: true,
      contextLength: 262144,
    },
    {
      id: "doubao-seedance-2-0-260128",
      displayName: "doubao-seedance-2-0",
      supportsVideoGeneration: true,
    },
    {
      id: "doubao-seedream-4-0-250828",
      displayName: "doubao-seedream-4-0",
      supportsImageGeneration: true,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes volcengine to Ark parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        {
          id: "doubao-seedance-2-0-260128",
          name: "doubao-seedance-2-0",
          domain: "VideoGeneration",
        },
      ],
    },
    "volcengine",
  );

  assert.deepEqual(entries, [
    {
      id: "doubao-seedance-2-0-260128",
      displayName: "doubao-seedance-2-0",
      supportsVideoGeneration: true,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes byteplus to Ark parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        {
          id: "seed-2-0-lite-260228",
          name: "seed-2-0-lite",
          domain: "LLM",
        },
      ],
    },
    "byteplus",
  );

  assert.deepEqual(entries, [
    {
      id: "seed-2-0-lite-260228",
      displayName: "seed-2-0-lite",
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes openrouter to typed parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        {
          id: "anthropic/claude-sonnet-4",
          architecture: { output_modalities: ["text"] },
        },
        {
          id: "stability/sdxl",
          architecture: { output_modalities: ["image"] },
        },
      ],
    },
    "openrouter",
  );

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4",
    },
    { id: "stability/sdxl", supportsImageGeneration: true },
  ]);
});

test("parseOpenRouterModelEntriesPayload maps context_length", () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: "anthropic/claude-sonnet-4",
        context_length: 200000,
        architecture: { output_modalities: ["text"] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "anthropic/claude-sonnet-4",
      contextLength: 200000,
    },
  ]);
});

test("parseGoogleModelEntriesPayload maps displayName, description, and contextLength", () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: "models/gemini-3.1-pro-preview",
        version: "3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        description: "Preview model for advanced reasoning.",
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "gemini-3.1-pro-preview",
      displayName: "Gemini 3.1 Pro Preview",
      description: "Preview model for advanced reasoning.",
      contextLength: 1048576 + 8192,
    },
  ]);
});

test("parseGoogleModelEntriesPayload prefers baseModelId and skips non-generateContent models", () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: "models/embedding-001",
        baseModelId: "embedding-001",
        displayName: "Embedding",
        supportedGenerationMethods: ["embedContent"],
      },
      {
        name: "models/gemini-2.0-flash",
        baseModelId: "gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash",
        inputTokenLimit: 1000,
        outputTokenLimit: 500,
        supportedGenerationMethods: ["generateContent"],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      contextLength: 1500,
    },
  ]);
});

test("parseGoogleModelEntriesPayload skips models without generateContent support", () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: "models/gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash",
        inputTokenLimit: 1000,
        outputTokenLimit: 500,
        supportedGenerationMethods: ["generateContent"],
      },
      {
        name: "models/unknown-capability",
        displayName: "Unknown",
        inputTokenLimit: 100,
        outputTokenLimit: 50,
      },
      {
        name: "models/empty-methods",
        displayName: "Empty Methods",
        supportedGenerationMethods: [],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      contextLength: 1500,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes google provider to native parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      models: [
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          inputTokenLimit: 100,
          outputTokenLimit: 50,
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    },
    "google",
  );

  assert.deepEqual(entries, [
    {
      id: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      contextLength: 150,
    },
  ]);
});

test("fireworksAiGatewayModelsListUrl builds serverless filter and pagination", () => {
  assert.equal(
    fireworksAiGatewayModelsListUrl(),
    "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200",
  );
  assert.equal(
    fireworksAiGatewayModelsListUrl("page-2"),
    "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200&pageToken=page-2",
  );
});

test("parseFireworksAiGatewayModelsPayload maps chat models and filters non-chat entries", () => {
  const entries = parseFireworksAiGatewayModelsPayload({
    models: [
      {
        name: "accounts/fireworks/models/deepseek-v3p1",
        displayName: "DeepSeek V3.1",
        description: "Chat model",
        contextLength: 128000,
        supportsImageInput: false,
        kind: "HF_BASE_MODEL",
        conversationConfig: {},
      },
      {
        name: "accounts/fireworks/models/qwen2-vl-72b-instruct",
        displayName: "Qwen2 VL",
        supportsImageInput: true,
        kind: "HF_BASE_MODEL",
        conversationConfig: {},
      },
      {
        name: "accounts/fireworks/models/kimi-k2-thinking",
        displayName: "Kimi K2 Thinking",
        kind: "HF_BASE_MODEL",
        conversationConfig: {},
      },
      {
        name: "accounts/fireworks/models/nomic-embed-text",
        kind: "EMBEDDING_MODEL",
        conversationConfig: {},
      },
      {
        name: "accounts/fireworks/models/no-chat-config",
        kind: "HF_BASE_MODEL",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "accounts/fireworks/models/deepseek-v3p1",
      displayName: "DeepSeek V3.1",
      description: "Chat model",
      contextLength: 128000,
    },
    {
      id: "accounts/fireworks/models/qwen2-vl-72b-instruct",
      displayName: "Qwen2 VL",
      supportsImageInput: true,
    },
    {
      id: "accounts/fireworks/models/kimi-k2-thinking",
      displayName: "Kimi K2 Thinking",
    },
  ]);
});

test("parseTogetherAiModelEntriesPayload maps chat/language/image/video and pricing shapes", () => {
  const entries = parseTogetherAiModelEntriesPayload([
    {
      id: "moonshotai/Kimi-K3",
      type: "chat",
      display_name: "Kimi K3",
      context_length: 1000000,
      pricing: {
        input: 3,
        output: 15,
        image_pixel: 0,
        image: 0,
        video: 0,
      },
    },
    {
      id: "meta-llama/Meta-Llama-3.1-8B",
      type: "language",
      display_name: "Meta Llama 3.1 8B",
      context_length: 16384,
      pricing: { input: 0, output: 0 },
    },
    {
      id: "black-forest-labs/FLUX.1.1-pro",
      type: "image",
      display_name: "FLUX1.1 [pro]",
      pricing: {
        image_pixel: {
          price_per_megapixel: 0.04,
          min_steps: 0,
        },
      },
    },
    {
      id: "ByteDance-Seed/Seedream-3.0",
      type: "image",
      display_name: "ByteDance Seedream 3.0",
      pricing: {
        image: {
          example_price: 0.018,
          example_description: "720x1280",
        },
      },
    },
    {
      id: "kwaivgi/kling-2.1-master",
      type: "video",
      display_name: "Kling 2.1 Master",
      pricing: {
        video: {
          example_price: 0.924,
          example_description: "1080p / 5s",
        },
      },
    },
    {
      id: "BAAI/bge-large-en-v1.5",
      type: "embedding",
      display_name: "BGE Large",
    },
  ]);

  assert.deepEqual(entries, [
    {
      id: "moonshotai/Kimi-K3",
      displayName: "Kimi K3",
      contextLength: 1000000,
      supportsImageInput: true,
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
      },
    },
    {
      id: "meta-llama/Meta-Llama-3.1-8B",
      displayName: "Meta Llama 3.1 8B",
      contextLength: 16384,
      supportsImageInput: true,
    },
    {
      id: "black-forest-labs/FLUX.1.1-pro",
      displayName: "FLUX1.1 [pro]",
      supportsImageGeneration: true,
      pricing: {
        imagePerMegapixelUsd: "0.04",
      },
    },
    {
      id: "ByteDance-Seed/Seedream-3.0",
      displayName: "ByteDance Seedream 3.0",
      supportsImageGeneration: true,
      pricing: {
        imageExamplePricing: {
          priceUsd: "0.018",
          description: "720x1280",
        },
      },
    },
    {
      id: "kwaivgi/kling-2.1-master",
      displayName: "Kling 2.1 Master",
      supportsVideoGeneration: true,
      pricing: {
        videoExamplePricing: {
          priceUsd: "0.924",
          description: "1080p / 5s",
        },
      },
    },
  ]);
});

test("parseTogetherAiModelEntriesPayload accepts OpenAI-shaped data wrapper", () => {
  const entries = parseTogetherAiModelEntriesPayload({
    data: [
      {
        id: "org/model",
        type: "chat",
        display_name: "Model",
      },
    ],
  });
  assert.deepEqual(entries, [
    {
      id: "org/model",
      displayName: "Model",
      supportsImageInput: true,
    },
  ]);
});

test("parseBasetenModelEntriesPayload maps chat models pricing vision and reasoning", () => {
  const entries = parseBasetenModelEntriesPayload({
    data: [
      {
        id: "moonshotai/Kimi-K3",
        object: "model",
        name: "Kimi K3",
        description: "Multimodal reasoning model for agentic workflows.",
        context_length: 1048000,
        max_completion_tokens: 262144,
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          input_cache_read: "0.0000003",
        },
        supported_features: ["vision", "reasoning", "reasoning_effort"],
      },
      {
        id: "meta-llama/Llama-3",
        object: "model",
        name: "Llama 3",
        context_length: 8192,
        pricing: {
          prompt: 3,
          completion: 15,
        },
        supported_features: ["reasoning"],
      },
      {
        id: "org/embedding-model",
        object: "model",
        type: "embedding",
        name: "Embedding",
      },
      {
        id: "",
        object: "model",
        name: "Missing id",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "moonshotai/Kimi-K3",
      displayName: "Kimi K3",
      description: "Multimodal reasoning model for agentic workflows.",
      contextLength: 1048000,
      maxCompletionTokens: 262144,
      supportsImageInput: true,
      supportsReasoning: true,
      supportedReasoningEfforts: moonshotK3SupportedReasoningEfforts(),
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
        cachedInputPerTokenUsd: "0.0000003",
      },
    },
    {
      id: "meta-llama/Llama-3",
      displayName: "Llama 3",
      contextLength: 8192,
      supportsImageInput: true,
      supportsReasoning: true,
      supportedReasoningEfforts: ["low", "medium", "high"],
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
      },
    },
  ]);
});

test("parseBasetenModelEntriesPayload accepts bare array and falls back display name to id", () => {
  const entries = parseBasetenModelEntriesPayload([
    {
      id: "org/model",
      object: "model",
    },
  ]);
  assert.deepEqual(entries, [
    {
      id: "org/model",
      supportsImageInput: true,
    },
  ]);
});

test("parseGroqModelEntriesPayload maps chat models with vision and reasoning allowlists", () => {
  const entries = parseGroqModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "llama-3.3-70b-versatile",
        object: "model",
        created: 1693721698,
        owned_by: "Meta",
        active: true,
        context_window: 131072,
        public_apps: null,
      },
      {
        id: "openai/gpt-oss-20b",
        object: "model",
        active: true,
        context_window: 131072,
        max_completion_tokens: 65536,
      },
      {
        id: "qwen/qwen3.6-27b",
        object: "model",
        active: true,
        context_window: 131072,
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        object: "model",
        active: true,
        context_window: 131072,
      },
      {
        id: "whisper-large-v3",
        object: "model",
        active: true,
        context_window: 448,
      },
      {
        id: "playai-tts",
        object: "model",
        active: true,
      },
      {
        id: "llama-guard-3-8b",
        object: "model",
        active: false,
      },
      {
        id: "not-a-model",
        object: "list",
        active: true,
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "llama-3.3-70b-versatile",
      displayName: "Llama 3.3 70b Versatile",
      contextLength: 131072,
    },
    {
      id: "openai/gpt-oss-20b",
      displayName: "GPT OSS 20b",
      contextLength: 131072,
      maxCompletionTokens: 65536,
      supportsReasoning: true,
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "qwen/qwen3.6-27b",
      displayName: "Qwen3.6 27b",
      contextLength: 131072,
      supportsImageInput: true,
      supportsReasoning: true,
      supportedReasoningEfforts: ["none", "default"],
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      displayName: "Llama 4 Scout 17b 16e Instruct",
      contextLength: 131072,
      supportsImageInput: true,
    },
  ]);
});

test("parseGroqModelEntriesPayload omits pricing and skips non-vision chat models", () => {
  const entries = parseGroqModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "llama-3.1-8b-instant",
        object: "model",
        active: true,
        context_window: 131072,
        pricing: { input: 0.05 },
      },
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.supportsImageInput, undefined);
  assert.equal(entries[0]?.pricing, undefined);
});

test("resolveGroqDisplayNameFromId formats id segment", () => {
  assert.equal(
    resolveGroqDisplayNameFromId("meta-llama/llama-4-maverick-17b-128e-instruct"),
    "Llama 4 Maverick 17b 128e Instruct",
  );
});

test("parseDeepInfraModelEntriesPayload maps chat image video types with tags and pricing", () => {
  const entries = parseDeepInfraModelEntriesPayload([
    {
      model_name: "acme/omni-chat-large",
      type: "text-generation",
      description: "Omni chat model.",
      tags: ["openai", "tools", "multimodal", "input-video"],
      pricing: {
        type: "tokens",
        cents_per_input_token: 0.00013,
        cents_per_output_token: 0.00026,
        rate_per_input_token_cached: 0.07692308,
      },
      max_tokens: 262144,
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/partner-chat",
      type: "text-generation",
      description: "Partner chat model.",
      tags: ["openai", "multimodal"],
      pricing: { type: "tokens", cents_per_input_token: 0.0003, cents_per_output_token: 0.0015 },
      max_tokens: 200000,
      deprecated: null,
      is_partner: true,
    },
    {
      model_name: "acme/plain-chat",
      type: "text-generation",
      tags: ["openai", "tools"],
      max_tokens: 131072,
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/image-gen",
      type: "text-to-image",
      description: "Image generation model.",
      tags: ["no-free-anon"],
      pricing: { type: "image_units", cents_per_image_unit: 4 },
      max_tokens: null,
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/video-gen",
      type: "text-to-video",
      description: "Video generation model.",
      pricing: { type: "output_length", cents_per_output_sec: 5 },
      max_tokens: null,
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/world-sim",
      type: "world-model",
      description: "World model treated as text-to-video.",
      pricing: { type: "output_length", cents_per_output_sec: 8 },
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/unknown-pricing-chat",
      type: "text-generation",
      tags: [],
      pricing: { type: "input_length", cents_per_input_token: 1 },
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/deprecated-chat",
      type: "text-generation",
      tags: ["multimodal"],
      deprecated: 1784240987,
      is_partner: false,
    },
    {
      model_name: "acme/embedder",
      type: "embeddings",
      deprecated: null,
      is_partner: false,
    },
    {
      model_name: "acme/reranker",
      type: "reranker",
      deprecated: null,
      is_partner: false,
    },
  ]);

  assert.deepEqual(entries, [
    {
      id: "acme/omni-chat-large",
      description: "Omni chat model.",
      contextLength: 262144,
      supportsImageInput: true,
      supportsVideoInput: true,
      isPartner: false,
      pricing: {
        inputPerTokenUsd: "0.0000013",
        outputPerTokenUsd: "0.0000026",
        cachedInputPerTokenUsd: "0.0000001",
      },
    },
    {
      id: "acme/partner-chat",
      description: "Partner chat model.",
      contextLength: 200000,
      supportsImageInput: true,
      isPartner: true,
      pricing: {
        inputPerTokenUsd: "0.000003",
        outputPerTokenUsd: "0.000015",
      },
    },
    {
      id: "acme/plain-chat",
      contextLength: 131072,
      isPartner: false,
    },
    {
      id: "acme/image-gen",
      description: "Image generation model.",
      supportsImageGeneration: true,
      isPartner: false,
      pricing: {
        imagePerUnitUsd: "0.04",
      },
    },
    {
      id: "acme/video-gen",
      description: "Video generation model.",
      supportsVideoGeneration: true,
      isPartner: false,
      pricing: {
        videoDurationPricing: [{ resolution: "default", costPerSecondUsd: "0.05" }],
      },
    },
    {
      id: "acme/world-sim",
      description: "World model treated as text-to-video.",
      supportsVideoGeneration: true,
      isPartner: false,
      pricing: {
        videoDurationPricing: [{ resolution: "default", costPerSecondUsd: "0.08" }],
      },
    },
    {
      id: "acme/unknown-pricing-chat",
      isPartner: false,
    },
  ]);
});

test("parseDeepInfraModelEntriesPayload tolerates data wrapper and malformed entries", () => {
  const entries = parseDeepInfraModelEntriesPayload({
    data: [
      {
        model_name: "acme/chat",
        type: "text-generation",
        deprecated: null,
      },
      "garbage",
      { type: "text-generation" },
      { model_name: "   ", type: "text-generation" },
      { model_name: "acme/no-type" },
      { model_name: "acme/deprecated", type: "text-generation", deprecated: 1 },
    ],
  });

  assert.deepEqual(entries, [{ id: "acme/chat" }]);
  assert.deepEqual(parseDeepInfraModelEntriesPayload(null), []);
  assert.deepEqual(parseDeepInfraModelEntriesPayload({}), []);
  assert.deepEqual(parseDeepInfraModelEntriesPayload([]), []);
});

test("mergeFireworksAiGatewayModelPages dedupes across pages", () => {
  const entries = mergeFireworksAiGatewayModelPages([
    {
      models: [
        {
          name: "accounts/fireworks/models/deepseek-v3p1",
          kind: "HF_BASE_MODEL",
          conversationConfig: {},
        },
      ],
      nextPageToken: "page-2",
    },
    {
      models: [
        {
          name: "accounts/fireworks/models/deepseek-v3p1",
          displayName: "DeepSeek V3.1",
          kind: "HF_BASE_MODEL",
          conversationConfig: {},
        },
        {
          name: "accounts/fireworks/models/llama-v3p1-8b-instruct",
          kind: "HF_BASE_MODEL",
          conversationConfig: {},
        },
      ],
    },
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["accounts/fireworks/models/deepseek-v3p1", "accounts/fireworks/models/llama-v3p1-8b-instruct"],
  );
});

test("openAiCompatibleModelDetailUrl encodes model id", () => {
  assert.equal(
    openAiCompatibleModelDetailUrl("https://api.longcat.chat/openai/v1", "LongCat-2.0"),
    "https://api.longcat.chat/openai/v1/models/LongCat-2.0",
  );
});

test("parseMeituanModelDetailPayload maps modalities context pricing and thinking", () => {
  const entry = parseMeituanModelDetailPayload({
    id: "LongCat-2.0",
    name: "LongCat-2.0",
    created: 1773331200,
    context_length: 1048576,
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["text"],
      modality: "text->text",
      tokenizer: "Other",
      instruct_type: null,
    },
    supported_parameters: [
      "max_tokens",
      "temperature",
      "top_p",
      "stream",
      "tools",
      "tool_choice",
      "thinking",
    ],
    pricing: { prompt: "2", completion: "8", cached_tokens: "0.04" },
  });

  assert.deepEqual(entry, {
    id: "LongCat-2.0",
    displayName: "LongCat-2.0",
    contextLength: 1048576,
    supportsThinkingSwitch: true,
    pricing: {
      inputPerTokenUsd: "0.000002",
      outputPerTokenUsd: "0.000008",
    },
  });
});

test("parseMeituanModelDetailPayload maps image input and image-only output", () => {
  const entry = parseMeituanModelDetailPayload({
    id: "LongCat-Vision",
    name: "LongCat Vision",
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["image"],
    },
    supported_parameters: [],
  });

  assert.deepEqual(entry, {
    id: "LongCat-Vision",
    displayName: "LongCat Vision",
    supportsImageInput: true,
    supportsImageGeneration: true,
  });
});

test("parseTencentTokenHubModelEntriesPayload maps name to displayName and skips pre-offline", () => {
  const entries = parseTencentTokenHubModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "hy3",
        object: "model",
        name: "Hy3",
        created: 1783267200,
        status: "online",
      },
      {
        id: "deepseek-v4-pro",
        object: "model",
        name: "DeepSeek-V4-Pro",
        created: 1776960000,
        status: "online",
      },
      {
        id: "deepseek-v3.1-terminus",
        object: "model",
        name: "Deepseek-v3.1",
        created: 1776960000,
        status: "pre-offline",
      },
    ],
  });

  assert.deepEqual(entries, [
    { id: "hy3", displayName: "Hy3" },
    { id: "deepseek-v4-pro", displayName: "DeepSeek-V4-Pro" },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes tencent-tokenhub to dedicated parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [{ id: "glm-5", name: "GLM-5", status: "online" }],
    },
    "tencent-tokenhub",
  );

  assert.deepEqual(entries, [{ id: "glm-5", displayName: "GLM-5" }]);
});

test("parseMistralModelEntriesPayload keeps completion_chat models and maps vision metadata", () => {
  const entries = parseMistralModelEntriesPayload({
    object: "list",
    data: [
      {
        id: "mistral-large-latest",
        object: "model",
        name: "Mistral Large",
        description: "Flagship chat model",
        max_context_length: 128000,
        capabilities: {
          completion_chat: true,
          vision: false,
          function_calling: true,
        },
      },
      {
        id: "pixtral-large-latest",
        object: "model",
        name: "Pixtral Large",
        description: "Vision chat model",
        max_context_length: 128000,
        capabilities: {
          completion_chat: true,
          vision: true,
        },
      },
      {
        id: "mistral-embed",
        object: "model",
        name: "Mistral Embed",
        capabilities: {
          completion_chat: false,
          vision: false,
        },
      },
      {
        id: "no-capabilities",
        object: "model",
        name: "Missing Caps",
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "mistral-large-latest",
      displayName: "Mistral Large",
      description: "Flagship chat model",
      contextLength: 128000,
    },
    {
      id: "pixtral-large-latest",
      displayName: "Pixtral Large",
      description: "Vision chat model",
      contextLength: 128000,
      supportsImageInput: true,
    },
  ]);
});

test("parseOpenAiCompatibleModelEntriesPayload routes mistral to dedicated parser", () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      data: [
        {
          id: "mistral-small-latest",
          name: "Mistral Small",
          max_context_length: 32768,
          capabilities: { completion_chat: true, vision: true },
        },
      ],
    },
    "mistral",
  );

  assert.deepEqual(entries, [
    {
      id: "mistral-small-latest",
      displayName: "Mistral Small",
      contextLength: 32768,
      supportsImageInput: true,
    },
  ]);
});

test("parseHuggingFaceRouterModelsPayload maps modalities pricing and display name", () => {
  const entries = parseHuggingFaceRouterModelsPayload({
    object: "list",
    data: [
      {
        id: "moonshotai/Kimi-K3:fastest",
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        providers: [
          {
            provider: "together",
            status: "live",
            context_length: 1000000,
            pricing: { input: 3, output: 15 },
            supports_tools: true,
            supports_structured_output: true,
          },
        ],
      },
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "moonshotai/Kimi-K3:fastest");
  assert.equal(entries[0]?.displayName, "Kimi-K3");
  assert.equal(entries[0]?.supportsImageInput, true);
  assert.equal(entries[0]?.contextLength, 1000000);
  assert.equal(entries[0]?.pricing?.inputPerTokenUsd, String(3 / 1_000_000));
  assert.equal(entries[0]?.pricing?.outputPerTokenUsd, String(15 / 1_000_000));
});

test("parseHuggingFaceHubMediaModelsPayload maps pipeline tags without pricing", () => {
  const entries = parseHuggingFaceHubMediaModelsPayload([
    {
      id: "black-forest-labs/FLUX.1-schnell",
      pipeline_tag: "text-to-image",
      inferenceProviderMapping: [
        { provider: "fal-ai", providerId: "flux", status: "live", task: "text-to-image" },
      ],
    },
    {
      id: "tencent/HunyuanVideo",
      pipeline_tag: "text-to-video",
      inferenceProviderMapping: [
        { provider: "wavespeed", providerId: "hunyuan", status: "live", task: "text-to-video" },
      ],
    },
  ]);

  assert.deepEqual(entries, [
    {
      id: "black-forest-labs/FLUX.1-schnell",
      displayName: "FLUX.1-schnell",
      supportsImageGeneration: true,
      inferenceProvider: "fal-ai",
    },
    {
      id: "tencent/HunyuanVideo",
      displayName: "HunyuanVideo",
      supportsVideoGeneration: true,
      inferenceProvider: "wavespeed",
    },
  ]);
  assert.equal(entries.length, 2);
  assert.equal("pricing" in entries[0]!, false);
  assert.equal("pricing" in entries[1]!, false);
});

test("parseHuggingFaceHubLinkHeaderNextUrl extracts rel=next url", () => {
  assert.equal(
    parseHuggingFaceHubLinkHeaderNextUrl(
      '<https://huggingface.co/api/models?cursor=abc>; rel="next", <https://huggingface.co/api/models>; rel="prev"',
    ),
    "https://huggingface.co/api/models?cursor=abc",
  );
});

test("mergeHuggingFaceListedModelEntries dedupes and merges capabilities", () => {
  const merged = mergeHuggingFaceListedModelEntries([
    { id: "org/model", supportsImageInput: true, pricing: { inputPerTokenUsd: "0.000001" } },
    { id: "org/model", supportsImageGeneration: true, inferenceProvider: "fal-ai" },
  ]);

  assert.deepEqual(merged, [
    {
      id: "org/model",
      supportsImageInput: true,
      supportsImageGeneration: true,
      pricing: { inputPerTokenUsd: "0.000001" },
      inferenceProvider: "fal-ai",
    },
  ]);
});

test("resolveHuggingFaceDisplayNameFromId uses last path segment without routing suffix", () => {
  assert.equal(resolveHuggingFaceDisplayNameFromId("moonshotai/Kimi-K3:fastest"), "Kimi-K3");
  assert.equal(resolveHuggingFaceDisplayNameFromId("FLUX.1-schnell"), "FLUX.1-schnell");
});

test("cohereModelsListUrl builds v1 chat catalog endpoint with pagination", () => {
  assert.equal(
    cohereModelsListUrl(),
    "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000",
  );
  assert.equal(
    cohereModelsListUrl("page-abc"),
    "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000&page_token=page-abc",
  );
});

test("parseCohereModelEntriesPayload keeps chat models and skips deprecated or non-chat", () => {
  const entries = parseCohereModelEntriesPayload({
    models: [
      {
        name: "command-a-plus-05-2026",
        is_deprecated: false,
        endpoints: ["chat"],
        context_length: 128000,
        features: ["vision"],
      },
      {
        name: "embed-english-v3.0",
        is_deprecated: false,
        endpoints: ["embed"],
        context_length: 512,
      },
      {
        name: "command-r-plus",
        is_deprecated: true,
        endpoints: ["chat"],
        context_length: 128000,
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: "command-a-plus-05-2026",
      contextLength: 128000,
      supportsImageInput: true,
    },
  ]);
  assert.equal("pricing" in (entries[0] ?? {}), false);
});

test("mergeCohereModelPages dedupes models across paginated responses", () => {
  const merged = mergeCohereModelPages([
    {
      models: [
        {
          name: "command-a-plus-05-2026",
          is_deprecated: false,
          endpoints: ["chat"],
          context_length: 128000,
        },
      ],
      next_page_token: "page-2",
    },
    {
      models: [
        {
          name: "command-a-plus-05-2026",
          is_deprecated: false,
          endpoints: ["chat"],
          context_length: 128000,
        },
        {
          name: "command-r7b-12-2024",
          is_deprecated: false,
          endpoints: ["chat"],
          context_length: 128000,
        },
      ],
    },
  ]);

  assert.deepEqual(
    merged.map((entry) => entry.id),
    ["command-a-plus-05-2026", "command-r7b-12-2024"],
  );
});
