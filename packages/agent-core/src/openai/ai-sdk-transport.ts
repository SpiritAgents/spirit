import { createAlibaba } from "@ai-sdk/alibaba";
import { createFireworks } from "@ai-sdk/fireworks";
import { createBaseten } from "@ai-sdk/baseten";
import { createGroq } from "@ai-sdk/groq";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGoogle, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createGateway } from "@ai-sdk/gateway";
import {
  createOpenAICompatible,
  type OpenAICompatibleLanguageModelChatOptions,
} from "@ai-sdk/openai-compatible";
import {
  generateImage as generateAiImage,
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type TextStreamPart,
} from "ai";

import { buildAiSdkUserImageFilePartFromUrl } from "../ai-sdk-image-url-part.js";
import { buildAiSdkUserVideoFilePartFromUrl } from "../ai-sdk-video-url-part.js";
import {
  resolveStreamingToolPreviewEmit,
  shouldEmitStreamingToolNamePreview,
  tryExtractPartialWebSearchQuery,
} from "../tool-streaming-preview-gate.js";
import { DEFAULT_IMAGE_GENERATION_SIZE, llmMessageTextContent } from "../ports.js";
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
  JsonObject,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  ToolExecutionOutput,
} from "../ports.js";
import {
  includesCompactSummaryBlock,
  unwrapCompactSummaryBlock,
  wrapCompactSummaryBlock,
} from "../llm-context-block.js";
import {
  buildCompactHistoryPromptMessages,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from "../tool-agent.js";
import { renderAiSdkProviderError } from "./ai-sdk-provider-error.js";
import { readAiSdkUsage } from "../ai-sdk-usage.js";
import { finishTaskStreamingPreviewReady } from "../finish-task-preview.js";
import {
  buildOpenAiRequestTrace,
  openAiReasoningEffort,
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiImageGenerationConfig,
  type OpenAiTransportConfig,
} from "./openai-compat.js";
import { generateSiliconFlowImage } from "../image-generation/siliconflow-backend.js";
import { generateHuggingFaceImage } from "../image-generation/huggingface-backend.js";
import { generateStepfunImage } from "../image-generation/stepfun-backend.js";
import { buildGeneratedImageToolOutput } from "../image-generation/output.js";
import { generateVideoWithRouter } from "../video-generation/router.js";
import { getLlmFetch } from "../llm-fetch.js";
import { createDeclaredWireMergeFetch } from "../llm-declared-wire-fetch.js";
import { buildGeminiThinkingConfigForEffort } from "./gemini-thinking-config.js";
import { createToolsRejectReasoningEffortFetch } from "./tools-reject-reasoning-effort-fetch.js";
import { createOpenRouterAnthropicReasoningFetch } from "../openrouter-anthropic-reasoning.js";
import {
  EMPTY_RESOLVED_PROVIDER_TOOLS,
  peekDeclaredProviderTools,
  resolveDeclaredProviderTools,
  type ResolvedProviderTools,
} from "../provider-tools/runtime.js";
import { createProviderToolsWireFetch } from "../provider-tools/wire-fetch.js";
import { buildProviderToolPreviewArgumentsJson } from "../provider-tools/spirit-ui.js";
import { toolNamesFromDefinitions } from "../unknown-tool-error.js";
import {
  mergeServiceTierProviderOptions,
  resolveServiceTierRequestPlan,
  type ServiceTierRequestPlan,
  type ServiceTierRequestSurface,
} from "../service-tier-request.js";
import {
  clearVideoPassthroughMessages,
  openAiMessagesContainVideoUrl,
  stashVideoPassthroughMessages,
  takeVideoPassthroughMessages,
} from "./video-message-stash.js";
import {
  llmHistoryToOpenAiMessages,
  resolveDeclaredVideoInputsInMessages,
} from "./openai-multimodal-messages.js";
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
  type OpenAiJsonSchemaTransport,
} from "./json-schema.js";

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const STREAMING_TOOL_CALL_PLACEHOLDER_PREFIX = "stream-tool-call-";

type AiSdkToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type OpenAiFunctionToolDefinition = JsonObject & {
  type: "function";
  function: JsonObject;
};

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  type: "function";
  functionName: string;
  functionArguments: string;
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export { normalizeGeneratedImageMarkdownRef } from "../image-generation/output.js";

export class AiSdkOpenAiCompatibleTransport
  implements LlmTransport<OpenAiTransportConfig, ToolAgentState>, OpenAiJsonSchemaTransport
{
  async generateImage(
    config: OpenAiTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    const imageConfig = config.imageGeneration;
    if (!imageConfig) {
      throw new Error("No image generation model is configured.");
    }

    // Backend selection keys off the declared `imageApi` shape name; the default shape is the
    // transport-native OpenAI Images API (`openai-images`).
    const imageApi = imageConfig.imageApi ?? "openai-images";

    if (imageApi === "siliconflow-images") {
      return generateSiliconFlowImage(imageConfig, request, saveGeneratedImage);
    }

    if (imageApi === "huggingface-inference") {
      return generateHuggingFaceImage(imageConfig, request, saveGeneratedImage);
    }

    if (imageApi === "stepfun-images") {
      return generateStepfunImage(imageConfig, request, saveGeneratedImage);
    }

    if (!KNOWN_AI_SDK_IMAGE_API_SHAPES.has(imageApi)) {
      throw new Error(
        `Unknown imageApi ${JSON.stringify(imageApi)}. Known image API shapes: ${[...KNOWN_IMAGE_API_SHAPES].join(", ")}.`,
      );
    }

    const requestUrl = buildAiSdkImageGenerationUrl(imageConfig);
    logAiSdkImageGenerationStart(imageConfig, request, requestUrl);

    let result: Awaited<ReturnType<typeof generateAiImage>>;
    try {
      // TODO: If we later add image models that do not use OpenAI Images-compatible
      // endpoints, do not blindly forward WIDTHxHEIGHT. Translate this shared size
      // field per selected provider/model instead.
      result = await generateAiImage({
        model: createAiSdkImageModel(imageConfig, {
          ...(config.headers !== undefined ? { headers: config.headers } : {}),
          ...(config.body !== undefined ? { body: config.body } : {}),
        }),
        prompt: request.prompt,
        size: request.size as `${number}x${number}`,
        maxRetries: 2,
      });
    } catch (error) {
      logAiSdkImageGenerationFailure(imageConfig, request, requestUrl, error);
      throw error;
    }

    const image = result.image;
    const saved = await saveGeneratedImage({
      data: image.uint8Array,
      mediaType: image.mediaType,
      prompt: request.prompt,
      model: imageConfig.model,
    });

    logAiSdkImageGenerationSuccess(imageConfig, requestUrl, saved);

    return buildGeneratedImageToolOutput(saved, imageConfig.model);
  }

  async generateVideo(
    config: OpenAiTransportConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const videoConfig = config.videoGeneration;
    if (!videoConfig) {
      throw new Error("No video generation model is configured.");
    }

    return generateVideoWithRouter(videoConfig, request, saveGeneratedVideo);
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const rawMessages = buildJsonSchemaCompletionMessages(config, request);
    await resolveDeclaredVideoInputsInMessages(
      config,
      rawMessages,
      openAiTransportAssetRoot(config),
    );
    const messages = normalizeMessagesForRequest(config, rawMessages);
    const requestTrace = buildAiSdkRequestTrace(config, 1, messages, []);

    try {
      const result = await generateObject({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(config, messages) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildAiSdkProviderOptionsWithServiceTier(config),
        maxRetries: 2,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderAiSdkOpenAiError(error), { cause: error });
    }
  }

  async startToolAgentRound(
    config: OpenAiTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    await resolveDeclaredVideoInputsInMessages(
      config,
      nextState.messages,
      openAiTransportAssetRoot(config),
    );
    const requestMessages = normalizeMessagesForRequest(config, nextState.messages);
    const providerTools = await resolveDeclaredProviderTools(
      config,
      new Set(toolNamesFromDefinitions(tools)),
    );
    const normalizedTools = [...normalizeToolDefinitions(tools), ...providerTools.functionTools];
    const tracedRequest = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    prepareVideoPassthroughRequest(config, requestMessages);
    try {
      const result: any = await generateText({
        model: createAiSdkLanguageModel(config, providerTools),
        messages: openAiMessagesToAiSdkMessages(config, requestMessages) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        include: { responseBody: true },
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAiSdkProviderOptionsWithServiceTier(config),
        maxRetries: 2,
      });

      const assistantMessage = buildAssistantMessageFromGenerateTextResult(
        result.response.body,
        result.text,
        result.toolCalls,
      );
      nextState.messages.push(assistantMessage);

      const usage = await readAiSdkUsage(result);
      const calls = extractToolCallsFromAiSdk(result.toolCalls);
      if (calls.length > 0) {
        return {
          kind: "success",
          result: {
            state: nextState,
            step: {
              kind: "tool-calls",
              calls,
            },
            requestTrace: tracedRequest,
            ...(usage ? { usage } : {}),
          },
        };
      }

      return {
        kind: "success",
        result: {
          state: nextState,
          step: {
            kind: "final-response-ready",
          },
          requestTrace: tracedRequest,
          ...(usage ? { usage } : {}),
        },
      };
    } catch (error) {
      logAiSdkChatCompletionFailure(config, error, { streaming: false });
      return {
        kind: "failure",
        error: renderAiSdkOpenAiError(error),
        requestTrace: tracedRequest,
      };
    } finally {
      clearVideoPassthroughRequest(config);
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenAiTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    let requestMessages: JsonValue[];
    let providerTools = EMPTY_RESOLVED_PROVIDER_TOOLS;
    try {
      await resolveDeclaredVideoInputsInMessages(
        config,
        nextState.messages,
        openAiTransportAssetRoot(config),
      );
      requestMessages = normalizeMessagesForRequest(config, nextState.messages);
      providerTools = await resolveDeclaredProviderTools(
        config,
        new Set(toolNamesFromDefinitions(tools)),
      );
    } catch (error) {
      return {
        eventStream: emptyAiSdkEventStream(),
        completion: Promise.resolve({
          kind: "failure",
          error: renderAiSdkOpenAiError(error),
          requestTrace: [],
        }),
        cancel: () => {},
      };
    }
    const normalizedTools = [...normalizeToolDefinitions(tools), ...providerTools.functionTools];
    const requestTrace = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );

    const abortController = new AbortController();

    // Video passthrough: the stash must be cleaned up only after streamText has asynchronously issued the HTTP request, not in a synchronous finally.
    prepareVideoPassthroughRequest(config, requestMessages);
    try {
      const result: any = streamText({
        model: createAiSdkLanguageModel(config, providerTools),
        messages: openAiMessagesToAiSdkMessages(config, requestMessages) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAiSdkProviderOptionsWithServiceTier(config),
        include: { rawChunks: true },
        maxRetries: 2,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      const completionPromise = completion.promise.finally(() => {
        clearVideoPassthroughRequest(config);
      });

      return {
        eventStream: aiSdkEventStreamToRuntimeEvents(
          result.stream,
          result,
          nextState,
          requestTrace,
          completion,
          usesStructuredReasoningStreamEvents(config),
          config,
        ),
        completion: completionPromise,
        cancel: () => {
          abortController.abort();
          clearVideoPassthroughRequest(config);
        },
      };
    } catch (error) {
      clearVideoPassthroughRequest(config);
      logAiSdkChatCompletionFailure(config, error, { streaming: true, phase: "start" });
      return {
        eventStream: emptyAiSdkEventStream(),
        completion: Promise.resolve({
          kind: "failure",
          error: renderAiSdkOpenAiError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: OpenAiTransportConfig,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
    context?: import("../ports.js").CompactHistoryManualContext,
  ): Promise<{
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  }> {
    const beforeLength = history.length;
    if (beforeLength === 0) {
      return {
        droppedMessages: 0,
        beforeLength,
        afterLength: 0,
      };
    }

    const promptMessages = openAiMessagesToAiSdkMessages(
      config,
      llmHistoryToOpenAiMessages(
        buildCompactHistoryPromptMessages(
          history,
          context?.transcriptDirPath === undefined
            ? {}
            : { transcriptDirPath: context.transcriptDirPath },
        ),
        openAiTransportAssetRoot(config),
      ),
    );
    const compactConfig: OpenAiTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = "";
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createAiSdkLanguageModel(compactConfig),
          messages: promptMessages as any,
          allowSystemInMessages: true,
          ...(compactConfig.outputLimit !== undefined
            ? { maxOutputTokens: compactConfig.outputLimit }
            : {}),
          providerOptions: buildAiSdkProviderOptionsWithServiceTier(compactConfig),
          maxRetries: 2,
        });

        for await (const part of streamed.stream) {
          if (part.type !== "text-delta") {
            continue;
          }

          const normalizedText = trimLeadingStreamLineBreaks(summary, part.text);
          if (!normalizedText) {
            continue;
          }

          summary += normalizedText;
          emittedProgress = true;
          onProgress(normalizedText);
        }
      } catch (error) {
        if (emittedProgress) {
          throw error;
        }
      }
    }

    if (!summary.trim()) {
      const result = await generateText({
        model: createAiSdkLanguageModel(compactConfig),
        messages: promptMessages as any,
        allowSystemInMessages: true,
        ...(compactConfig.outputLimit !== undefined
          ? { maxOutputTokens: compactConfig.outputLimit }
          : {}),
        providerOptions: buildAiSdkProviderOptionsWithServiceTier(compactConfig),
        maxRetries: 2,
      });
      summary = result.text;
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error("AI SDK compaction returned empty; cannot generate summary.");
    }

    history.splice(0, history.length, {
      role: "system",
      content: [{ type: "text", text: wrapCompactSummaryBlock(normalizedSummary) }],
    });

    return {
      droppedMessages: saturatingSub(beforeLength, 1),
      beforeLength,
      afterLength: history.length,
    };
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    const message = history.find(
      (entry) =>
        entry.role === "system" &&
        includesCompactSummaryBlock(llmMessageTextContent(entry.content)),
    );
    if (!message) {
      return undefined;
    }
    return unwrapCompactSummaryBlock(llmMessageTextContent(message.content));
  }

  isContextOverflowError(error: string): boolean {
    const normalized = error.toLowerCase();
    return (
      normalized.includes("context length") ||
      normalized.includes("maximum context length") ||
      normalized.includes("too many tokens") ||
      normalized.includes("context_window_exceeded")
    );
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return llmHistoryToOpenAiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt("—", undefined),
    };
  }
}

function buildAiSdkRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  return buildOpenAiRequestTrace(config, stepIndex, messages, tools, stream);
}

/**
 * Adapter dispatch on the declared `sdk` (full npm package name); absent = the transport's generic
 * `@ai-sdk/openai-compatible` adapter. Unknown packages fail fast — the config schema already
 * rejects values outside the bundled adapter set.
 */
function createAiSdkLanguageModel(
  config: OpenAiTransportConfig,
  providerTools: Pick<
    ResolvedProviderTools,
    "literalEntries" | "bodyPatches"
  > = EMPTY_RESOLVED_PROVIDER_TOOLS,
): any {
  switch (config.sdk ?? "@ai-sdk/openai-compatible") {
    case "@ai-sdk/deepseek":
      return createAiSdkDeepSeekProvider(config, providerTools).chat(config.model);
    case "@ai-sdk/xai":
      // @ai-sdk/xai 5 removed the Chat Completions implementation entirely (xAI deprecated the
      // endpoint); the supported xAI surface is Responses, selected via transportKind
      // open-responses. Throwing here mirrors the OpenAI-official branch below.
      throw new Error(
        "xAI Chat Completions is no longer supported; use transportKind open-responses.",
      );
    case "@ai-sdk/alibaba":
      return createAiSdkAlibabaProvider(config, providerTools).chatModel(config.model);
    case "@ai-sdk/gateway":
      return createAiSdkGatewayProvider(config, providerTools)(config.model);
    case "@ai-sdk/openai":
      throw new Error(
        "OpenAI official Chat Completions is no longer supported; use transportKind open-responses.",
      );
    case "@ai-sdk/google":
      return createAiSdkGoogleProvider(config, providerTools).chat(config.model);
    case "@ai-sdk/google-vertex":
      return createAiSdkGoogleVertexProvider(config, providerTools)(config.model);
    case "@ai-sdk/moonshotai":
      return createAiSdkMoonshotProvider(config, providerTools).chatModel(config.model);
    case "@ai-sdk/fireworks":
      return createAiSdkFireworksProvider(config, providerTools)(config.model);
    case "@ai-sdk/togetherai":
      return createAiSdkTogetherProvider(config, providerTools)(config.model);
    case "@ai-sdk/baseten":
      return createAiSdkBasetenProvider(config, providerTools)(config.model);
    case "@ai-sdk/groq":
      return createAiSdkGroqProvider(config, providerTools)(config.model);
    case "@ai-sdk/deepinfra":
      return createAiSdkDeepInfraProvider(config, providerTools)(config.model);
    case "@ai-sdk/cohere":
      return createAiSdkCohereProvider(config, providerTools)(config.model);
    case "@ai-sdk/openai-compatible":
      return createAiSdkOpenAiCompatibleProvider(config, { providerTools }).chatModel(config.model);
    default:
      throw new Error(
        `Unknown SDK adapter package ${JSON.stringify(config.sdk)}. Bundled adapters: ${OPENAI_COMPATIBLE_SDK_ADAPTER_PACKAGES.join(", ")}.`,
      );
  }
}

/** The bundled adapter set for the openai-compatible transport, keyed by the declared `sdk`. */
const OPENAI_COMPATIBLE_SDK_ADAPTER_PACKAGES = [
  "@ai-sdk/openai-compatible",
  "@ai-sdk/alibaba",
  "@ai-sdk/baseten",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/deepseek",
  "@ai-sdk/fireworks",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/groq",
  "@ai-sdk/gateway",
  "@ai-sdk/moonshotai",
  "@ai-sdk/togetherai",
] as const;

/** Image API shapes served by an AI SDK adapter's image model; the rest have dedicated backends. */
const KNOWN_AI_SDK_IMAGE_API_SHAPES: ReadonlySet<string> = new Set([
  "openai-images",
  "vercel-gateway-images",
  "together-images",
]);

const KNOWN_IMAGE_API_SHAPES: readonly string[] = [
  ...KNOWN_AI_SDK_IMAGE_API_SHAPES,
  "siliconflow-images",
  "huggingface-inference",
  "stepfun-images",
];

function createAiSdkImageModel(
  imageConfig: OpenAiImageGenerationConfig,
  declarations?: Pick<OpenAiTransportConfig, "headers" | "body">,
): any {
  const imageApi = imageConfig.imageApi ?? "openai-images";

  if (imageApi === "vercel-gateway-images") {
    // Gateway image generation uses the v3 image-model protocol; it cannot reuse the chat-preset /v1 baseUrl.
    return createGateway({ apiKey: imageConfig.apiKey, fetch: getLlmFetch() }).image(
      imageConfig.model,
    );
  }

  if (imageApi === "together-images") {
    return createAiSdkTogetherProvider(imageConfig).image(imageConfig.model);
  }

  return createAiSdkOpenAiCompatibleProvider(imageConfig, {
    ...(declarations?.headers !== undefined ? { headers: declarations.headers } : {}),
    ...(declarations?.body !== undefined ? { body: declarations.body } : {}),
  }).imageModel(imageConfig.model);
}

/**
 * Per-request service tier plan for chat surfaces. The `@ai-sdk/gateway` chat route speaks the
 * gateway v3 language-model protocol; every other adapter on this transport is chat-completions.
 */
function chatServiceTierSurface(config: OpenAiTransportConfig): ServiceTierRequestSurface {
  if (config.sdk === "@ai-sdk/gateway") {
    return "gateway-v3";
  }
  // The Gemini adapters speak generateContent, whose service tier vocabulary is not the
  // OpenAI-family `service_tier` field; tier effects arrive via literal serviceTiers declarations.
  if (config.sdk === "@ai-sdk/google" || config.sdk === "@ai-sdk/google-vertex") {
    return "generate-content";
  }
  return "chat-completions";
}

function resolveChatServiceTierPlan(config: OpenAiTransportConfig): ServiceTierRequestPlan {
  if (config.serviceTier === undefined) {
    return {};
  }
  return resolveServiceTierRequestPlan({
    ...(config.serviceTier !== undefined ? { serviceTier: config.serviceTier } : {}),
    ...(config.serviceTiers !== undefined ? { serviceTiers: config.serviceTiers } : {}),
    ...(config.lastInputTokens !== undefined ? { lastInputTokens: config.lastInputTokens } : {}),
    surface: chatServiceTierSurface(config),
  });
}

/**
 * Adapters without a native reasoning effort option carry the declared selection through the
 * chat.completions `reasoning_effort` body field (merged after SDK serialization).
 */
function chatReasoningEffortBodyBase(config: OpenAiTransportConfig): JsonObject | undefined {
  switch (config.sdk) {
    case "@ai-sdk/moonshotai":
    // The adapter's reasoningEffort enum (low|high|max) is narrower than the values the upstream
    // accepts, so the declared effort goes through the wire field instead of the SDK option.
    case "@ai-sdk/fireworks":
    case "@ai-sdk/togetherai":
    case "@ai-sdk/baseten":
    case "@ai-sdk/deepinfra":
    case "@ai-sdk/cohere":
    case "@ai-sdk/alibaba": {
      const reasoningEffort = openAiReasoningEffort(config);
      return reasoningEffort === undefined ? undefined : { reasoning_effort: reasoningEffort };
    }
    default:
      return undefined;
  }
}

/**
 * Chat fetch: provider tool literal entries / entry bodies merge first (innermost), then the
 * declared wire merge (provider-level headers/body, thinkingSwitch, serviceTier), then the
 * video_url passthrough stash restore (outermost). The `toolsRejectReasoningEffort` patch wraps
 * the base fetch so the force-to-`none` applies to the fully merged body — the upstream rejects
 * the tools+effort combination, so no merge step may re-introduce it after the patch. The
 * `openRouterAnthropicReasoning` patch sits innermost so the unified shape replaces whatever
 * reasoning/thinking encoding the merges produced for the route.
 */
function llmFetchForChat(
  config: OpenAiTransportConfig,
  providerTools: Pick<
    ResolvedProviderTools,
    "literalEntries" | "bodyPatches"
  > = EMPTY_RESOLVED_PROVIDER_TOOLS,
): typeof fetch {
  const plan = resolveChatServiceTierPlan(config);
  let fetch = createProviderToolsWireFetch(
    providerTools,
    createDeclaredWireMergeFetch(
      config,
      chatServiceTierSurface(config),
      createToolsRejectReasoningEffortFetch(
        config,
        createOpenRouterAnthropicReasoningFetch(
          config,
          getLlmFetch({ flexWaiting: plan.flexWaiting }),
        ),
      ),
      { bodyBase: chatReasoningEffortBodyBase(config) },
    ),
  );
  if (usesVideoPassthroughStash(config)) {
    const innerFetch = fetch;
    fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = tryParseRequestBody(init?.body);
      if (!isJsonObject(body)) {
        return innerFetch(input, init);
      }

      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : "request";
      const stashedMessages = requestUrl.includes("/chat/completions")
        ? takeVideoPassthroughMessages()
        : undefined;
      if (!stashedMessages) {
        return innerFetch(input, init);
      }

      return innerFetch(input, {
        ...init,
        body: JSON.stringify({
          ...body,
          messages: stashedMessages,
        }),
      });
    };
  }
  return fetch;
}

function createAiSdkOpenAiCompatibleProvider(
  config: OpenAiTransportConfig | OpenAiImageGenerationConfig,
  options?: Pick<OpenAiTransportConfig, "headers" | "body"> & {
    providerTools?: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">;
  },
) {
  const transportConfig = config as OpenAiTransportConfig;
  // Image/video generation role configs carry no declarations of their own; the provider-level
  // literal `headers`/`body` still apply to every outbound request of the provider.
  const llmFetch = llmFetchForChat(
    {
      ...transportConfig,
      ...(options?.headers !== undefined ? { headers: options.headers } : {}),
      ...(options?.body !== undefined ? { body: options.body } : {}),
    },
    options?.providerTools ?? EMPTY_RESOLVED_PROVIDER_TOOLS,
  );

  const headers = {
    ...(config.organization ? { "OpenAI-Organization": config.organization } : {}),
    ...(config.project ? { "OpenAI-Project": config.project } : {}),
  };

  return createOpenAICompatible({
    apiKey: config.apiKey,
    name: "openai",
    baseURL: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    supportsStructuredOutputs: true,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    fetch: llmFetch,
  });
}

function createAiSdkMoonshotProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createMoonshotAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl.trim().replace(/\/+$/, "") } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkGoogleProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createGoogle({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkGoogleVertexProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  const project = config.vertexProject?.trim();
  const location = config.vertexLocation?.trim();
  const apiKey = config.apiKey?.trim();
  const clientEmail = config.vertexClientEmail?.trim();
  const privateKey = config.vertexPrivateKey?.trim();
  const expressOnly = Boolean(apiKey) && !clientEmail && !privateKey && !project && !location;

  if (expressOnly) {
    return createVertex({
      apiKey,
      fetch: llmFetchForChat(config, providerTools),
    } as Parameters<typeof createVertex>[0]);
  }

  const googleAuthOptions =
    clientEmail && privateKey
      ? {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, "\n"),
          },
        }
      : config.vertexGoogleAuthOptions;

  return createVertex({
    ...(project ? { project } : {}),
    ...(location ? { location } : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(googleAuthOptions ? { googleAuthOptions } : {}),
    ...(apiKey ? ({ apiKey } as Record<string, string>) : {}),
    fetch: llmFetchForChat(config, providerTools),
  } as Parameters<typeof createVertex>[0]);
}

function createAiSdkDeepSeekProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createDeepSeek({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkFireworksProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createFireworks({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkTogetherProvider(
  config: OpenAiTransportConfig | OpenAiImageGenerationConfig,
  providerTools: Pick<
    ResolvedProviderTools,
    "literalEntries" | "bodyPatches"
  > = EMPTY_RESOLVED_PROVIDER_TOOLS,
) {
  return createTogetherAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config as OpenAiTransportConfig, providerTools),
  });
}

function createAiSdkBasetenProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createBaseten({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkGroqProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createGroq({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

/**
 * baseURL dual-track: the connection config stores the OpenAI-compatible root (e.g. …/v1/openai),
 * while @ai-sdk/deepinfra's baseURL expects the root without the /openai suffix (the SDK language
 * model appends /openai/... itself). Custom roots without that suffix pass through unchanged.
 */
function normalizeDeepInfraSdkBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return undefined;
  }
  return trimmed.endsWith("/openai") ? trimmed.slice(0, -"/openai".length) : trimmed;
}

function createAiSdkDeepInfraProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createDeepInfra({
    apiKey: config.apiKey,
    ...(() => {
      const baseURL = normalizeDeepInfraSdkBaseUrl(config.baseUrl);
      return baseURL !== undefined ? { baseURL } : {};
    })(),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkCohereProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createCohere({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkAlibabaProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  return createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: llmFetchForChat(config, providerTools),
  });
}

function createAiSdkGatewayProvider(
  config: OpenAiTransportConfig,
  providerTools: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
) {
  // Gateway chat uses the v3 AI protocol (default …/v3/ai/language-model); it cannot use the model catalog's preset /v1 baseUrl.
  return createGateway({
    apiKey: config.apiKey,
    fetch: llmFetchForChat(config, providerTools),
  });
}

/**
 * The service tier fragment (gateway v3 namespace) is merged into the options builder result here
 * instead of editing each branch, so existing reasoning options are never dropped.
 */
function buildAiSdkProviderOptionsWithServiceTier(
  config: OpenAiTransportConfig,
): Record<string, JsonObject> {
  return mergeServiceTierProviderOptions(
    buildAiSdkProviderOptions(config),
    resolveChatServiceTierPlan(config),
  );
}

/**
 * Adapter plumbing for the declared reasoning effort: each branch is the adapter's native effort
 * option, keyed on the declared `sdk` package name. Adapters without a native option carry the
 * effort through the `reasoning_effort` body field instead (see `chatReasoningEffortBodyBase`);
 * the declared value is never clamped or gated by model.
 */
function buildAiSdkProviderOptions(config: OpenAiTransportConfig): Record<string, JsonObject> {
  const reasoningEffort = openAiReasoningEffort(config);
  if (reasoningEffort === undefined) {
    return {};
  }

  switch (config.sdk ?? "@ai-sdk/openai-compatible") {
    case "@ai-sdk/google": {
      const thinkingConfig = buildGeminiThinkingConfigForEffort(config.model, reasoningEffort);
      if (thinkingConfig === undefined) {
        return {};
      }
      const googleOptions = {
        thinkingConfig,
      } satisfies GoogleLanguageModelOptions;
      return { google: googleOptions as JsonObject };
    }
    case "@ai-sdk/google-vertex": {
      const thinkingConfig = buildGeminiThinkingConfigForEffort(config.model, reasoningEffort);
      if (thinkingConfig === undefined) {
        return {};
      }
      const vertexOptions = {
        thinkingConfig,
      } satisfies GoogleLanguageModelOptions;
      return { vertex: vertexOptions as JsonObject };
    }
    case "@ai-sdk/deepseek": {
      // Declared values are gated by the catalog's supportedReasoningEfforts; the adapter's enum
      // (low|high|max) is narrower than the shared token vocabulary, hence the cast.
      return {
        deepseek: {
          reasoningEffort: reasoningEffort as "low" | "high" | "max",
        } as JsonObject,
      };
    }
    case "@ai-sdk/groq": {
      // Same catalog-gated cast; the adapter enum is none|default|low|medium|high.
      return {
        groq: {
          reasoningEffort: reasoningEffort as "none" | "default" | "low" | "medium" | "high",
        } as JsonObject,
      };
    }
    case "@ai-sdk/openai-compatible": {
      return {
        openai: {
          reasoningEffort:
            reasoningEffort as OpenAICompatibleLanguageModelChatOptions["reasoningEffort"],
        } as JsonObject,
      };
    }
    default:
      return {};
  }
}

export function buildAiSdkProviderOptionsForTests(
  config: OpenAiTransportConfig,
): Record<string, JsonObject> {
  return buildAiSdkProviderOptions(config);
}

function normalizeToolDefinitions(tools: JsonValue): OpenAiFunctionToolDefinition[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isFunctionToolDefinition)
    .map((toolDefinition) => cloneJsonValue(toolDefinition) as OpenAiFunctionToolDefinition);
}

function buildAiSdkTools(
  normalizedTools: OpenAiFunctionToolDefinition[],
): Record<string, ReturnType<typeof tool>> {
  return Object.fromEntries(
    normalizedTools.flatMap((toolDefinition) => {
      const functionDefinition = toolDefinition.function;
      if (
        typeof functionDefinition.name !== "string" ||
        !isJsonObject(functionDefinition.parameters)
      ) {
        return [];
      }

      return [
        [
          functionDefinition.name,
          tool({
            ...(typeof functionDefinition.description === "string"
              ? { description: functionDefinition.description }
              : {}),
            inputSchema: jsonSchema(functionDefinition.parameters as Record<string, unknown>),
          }),
        ],
      ];
    }),
  );
}

function openAiMessagesToAiSdkMessages(
  config: Pick<OpenAiTransportConfig, "sdk">,
  messages: JsonValue[],
): Array<Record<string, unknown>> {
  const toolCallNames = buildToolCallNameIndex(messages);
  const includeVideoFileParts = isMoonshotOfficialAiSdkProvider(config);

  return messages.flatMap((message) => {
    if (!isJsonObject(message) || typeof message.role !== "string") {
      return [];
    }

    switch (message.role) {
      case "system": {
        return typeof message.content === "string"
          ? [{ role: "system", content: message.content }]
          : [];
      }
      case "user": {
        const content = openAiUserContentToAiSdkContent(message.content, includeVideoFileParts);
        return content === undefined ? [] : [{ role: "user", content }];
      }
      case "assistant": {
        const assistantMessage = openAiAssistantMessageToAiSdkMessage(message);
        return assistantMessage === undefined ? [] : [assistantMessage];
      }
      case "tool": {
        const toolMessage = openAiToolMessageToAiSdkMessage(message, toolCallNames);
        return toolMessage === undefined ? [] : [toolMessage];
      }
      default:
        return [];
    }
  });
}

function openAiUserContentToAiSdkContent(
  content: JsonValue | undefined,
  includeVideoFileParts: boolean,
): string | Array<Record<string, unknown>> | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!isJsonObject(part) || typeof part.type !== "string") {
      continue;
    }

    switch (part.type) {
      case "text":
        if (typeof part.text === "string") {
          parts.push({ type: "text", text: part.text });
        }
        break;
      case "image_url":
        if (isJsonObject(part.image_url) && typeof part.image_url.url === "string") {
          parts.push(buildAiSdkUserImageFilePartFromUrl(part.image_url.url));
        }
        break;
      case "video_url":
        if (
          includeVideoFileParts &&
          isJsonObject(part.video_url) &&
          typeof part.video_url.url === "string"
        ) {
          parts.push(buildAiSdkUserVideoFilePartFromUrl(part.video_url.url));
        }
        break;
      default:
        break;
    }
  }

  return parts.length > 0 ? parts : undefined;
}

function openAiAssistantMessageToAiSdkMessage(
  message: JsonObject,
): Record<string, unknown> | undefined {
  const reasoningText = extractAssistantReasoningContentFromJson(message);
  const toolCallParts = extractAssistantToolCallParts(message);
  const contentParts: Array<Record<string, unknown>> = [];

  if (reasoningText) {
    contentParts.push({ type: "reasoning", text: reasoningText });
  }

  if (typeof message.content === "string" && message.content.length > 0) {
    contentParts.push({ type: "text", text: message.content });
  }

  contentParts.push(...toolCallParts);

  if (contentParts.length === 0) {
    if (typeof message.content === "string") {
      return { role: "assistant", content: message.content };
    }

    return undefined;
  }

  return {
    role: "assistant",
    content: contentParts,
  };
}

function openAiToolMessageToAiSdkMessage(
  message: JsonObject,
  toolCallNames: Map<string, string>,
): Record<string, unknown> | undefined {
  const toolCallId = nonEmptyToolCallIdOrUndefined(message.tool_call_id);
  if (!toolCallId) {
    return undefined;
  }

  const toolName = toolCallNames.get(toolCallId) ?? "unknown_tool";
  const result = tryParseJsonValue(message.content);
  const output =
    result === undefined
      ? {
          type: "text",
          value:
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content ?? ""),
        }
      : {
          type: "json",
          value: result,
        };

  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output,
      },
    ],
  };
}

function buildToolCallNameIndex(messages: JsonValue[]): Map<string, string> {
  const toolCallNames = new Map<string, string>();

  for (const message of messages) {
    if (
      !isJsonObject(message) ||
      message.role !== "assistant" ||
      !Array.isArray(message.tool_calls)
    ) {
      continue;
    }

    for (const toolCall of message.tool_calls) {
      if (!isJsonObject(toolCall) || !isJsonObject(toolCall.function)) {
        continue;
      }

      if (!hasNonEmptyToolCallId(toolCall.id) || typeof toolCall.function.name !== "string") {
        continue;
      }

      toolCallNames.set(toolCall.id, toolCall.function.name);
    }
  }

  return toolCallNames;
}

function extractAssistantToolCallParts(message: JsonObject): Array<Record<string, unknown>> {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls.flatMap((toolCall) => {
    if (!isJsonObject(toolCall) || !isJsonObject(toolCall.function)) {
      return [];
    }

    if (!hasNonEmptyToolCallId(toolCall.id) || typeof toolCall.function.name !== "string") {
      return [];
    }

    return [
      {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        input: tryParseJsonValue(toolCall.function.arguments) ?? toolCall.function.arguments ?? {},
      },
    ];
  });
}

function buildAssistantMessageFromGenerateTextResult(
  responseBody: unknown,
  text: string,
  toolCalls: readonly AiSdkToolCall[],
): JsonValue {
  const assistantMessage = extractAssistantMessageFromChatResponseBody(responseBody);
  if (assistantMessage) {
    return normalizeRawAssistantMessage(assistantMessage);
  }

  return withReasoningContentIfNeeded(
    {
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((toolCall) => ({
              id: toolCall.toolCallId,
              type: "function",
              function: {
                name: toolCall.toolName,
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          }
        : {}),
    },
    "",
  );
}

function extractAssistantMessageFromChatResponseBody(
  responseBody: unknown,
): JsonObject | undefined {
  if (!isJsonObjectUnknown(responseBody) || !Array.isArray(responseBody.choices)) {
    return undefined;
  }

  const firstChoice = responseBody.choices[0];
  if (!isJsonObject(firstChoice) || !isJsonObject(firstChoice.message)) {
    return undefined;
  }

  return firstChoice.message;
}

function normalizeRawAssistantMessage(message: JsonObject): JsonValue {
  const functionToolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter(isJsonObject)
        .filter((toolCall) => toolCall.type === "function" && isJsonObject(toolCall.function))
        .map((toolCall) => cloneJsonValue(toolCall))
    : [];
  const reasoningContent = extractAssistantReasoningContentFromJson(message);

  return withReasoningContentIfNeeded(
    {
      role: "assistant",
      content:
        typeof message.content === "string" || message.content === null ? message.content : null,
      ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
    },
    reasoningContent,
  );
}

async function* aiSdkEventStreamToRuntimeEvents(
  stream: AsyncIterable<TextStreamPart<any>>,
  usageSource: Parameters<typeof readAiSdkUsage>[0],
  nextState: ToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<ToolAgentState>>,
  useStructuredReasoningEvents: boolean,
  config: OpenAiTransportConfig,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<number, AggregatedStreamingToolCall>();
  let assistantContent = "";
  let reasoningContent = "";
  let sawAnswerOrToolOutput = false;
  const rawPreview: string[] = [];

  try {
    for await (const part of stream) {
      if (part.type === "raw" && rawPreview.length < 8) {
        rawPreview.push(truncateChars(JSON.stringify(part.rawValue), 320));
      }

      switch (part.type) {
        case "reasoning-delta": {
          reasoningContent += part.text;
          yield { kind: "thinking-chunk", text: part.text };
          break;
        }
        case "text-delta": {
          sawAnswerOrToolOutput = true;
          assistantContent += part.text;
          yield { kind: "assistant-chunk", text: part.text };
          break;
        }
        case "tool-call": {
          sawAnswerOrToolOutput = true;
          break;
        }
        case "error": {
          throw part.error;
        }
        case "raw": {
          if (!useStructuredReasoningEvents) {
            const thinkingText = extractFallbackStreamingThinkingTextFromRawChunk(part.rawValue);
            if (thinkingText) {
              reasoningContent += thinkingText;
              yield { kind: "thinking-chunk", text: thinkingText };
            }
          }

          const rawToolUpdates = accumulateStreamingToolCallProgressFromRawChunk(
            toolCalls,
            part.rawValue,
            config,
          );
          if (rawToolUpdates.length > 0) {
            sawAnswerOrToolOutput = true;
            for (const update of rawToolUpdates) {
              yield update;
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      const preview = rawPreview.length === 0 ? "<empty stream body>" : rawPreview.join("\n");
      throw new Error(
        `Streaming response contained no delta (no content / tool_calls). Preview:\n${truncateChars(preview, 600)}`,
      );
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(assistantContent, reasoningContent, toolCalls),
    );
    const calls = extractToolCallsFromAggregatedMap(toolCalls);
    const usage = await readAiSdkUsage(usageSource);
    completion.resolve({
      kind: "success",
      result: {
        state: nextState,
        step: calls.length > 0 ? { kind: "tool-calls", calls } : { kind: "final-response-ready" },
        requestTrace,
        ...(usage ? { usage } : {}),
      },
    });
    yield { kind: "done" };
  } catch (error) {
    logAiSdkChatCompletionFailure(config, error, { streaming: true, phase: "stream" });
    const rendered = renderAiSdkOpenAiError(error);
    completion.resolve({
      kind: "failure",
      error: rendered,
      requestTrace,
    });
    yield {
      kind: "error",
      error: rendered,
    };
  }
}

function extractFallbackStreamingThinkingTextFromRawChunk(rawValue: unknown): string | undefined {
  if (!isJsonObjectUnknown(rawValue) || !Array.isArray(rawValue.choices)) {
    return undefined;
  }

  const chunks = rawValue.choices
    .filter(isJsonObject)
    .map((choice) => choice.delta)
    .filter(isJsonObject)
    .flatMap((delta) => [delta.reasoningText, delta.reasoning_text, delta.thinking])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("");

  return chunks || undefined;
}

/**
 * Streaming preview for a host-executed provider tool call: the raw argument JSON is rewritten to
 * the card-friendly `{query?, status, _spiritUi}` preview shape (declared entry's `label` +
 * `ui.expand` bridge for the current desktop reader).
 */
function resolveStreamingToolPreviewArgumentsJson(
  config: OpenAiTransportConfig,
  toolName: string,
  argumentsJson: string,
): string {
  const resolved = peekDeclaredProviderTools(config);
  if (resolved === undefined || !resolved.recognizedNames.has(toolName)) {
    return argumentsJson;
  }

  const display = resolved.display.get(toolName);
  return buildProviderToolPreviewArgumentsJson({
    toolName,
    ...(display?.label !== undefined ? { label: display.label } : {}),
    query: readPreviewQuery(argumentsJson),
    status: "in_progress",
    suppressExpand: display?.suppressExpand === true,
  });
}

function readPreviewQuery(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.query === "string") {
      return parsed.query.trim();
    }
  } catch {
    // Fall through to the partial-argument reader for in-flight JSON.
  }
  return tryExtractPartialWebSearchQuery(argumentsJson) ?? "";
}

function accumulateStreamingToolCallProgressFromRawChunk(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  rawValue: unknown,
  config: OpenAiTransportConfig,
): LlmStreamEvent[] {
  if (!isJsonObjectUnknown(rawValue) || !Array.isArray(rawValue.choices)) {
    return [];
  }

  const updates: LlmStreamEvent[] = [];
  for (const choice of rawValue.choices) {
    if (
      !isJsonObject(choice) ||
      !isJsonObject(choice.delta) ||
      !Array.isArray(choice.delta.tool_calls)
    ) {
      continue;
    }

    for (const delta of choice.delta.tool_calls) {
      if (!isJsonObject(delta) || typeof delta.index !== "number") {
        continue;
      }

      const existing = toolCalls.get(delta.index);
      const previousFunctionName = existing?.functionName ?? "";
      const current: AggregatedStreamingToolCall = existing ?? {
        index: delta.index,
        id: nonEmptyToolCallIdOrUndefined(delta.id) ?? `stream-tool-call-${delta.index}`,
        type: "function",
        functionName: "",
        functionArguments: "",
        readyPreviewEmitted: false,
      };

      // Alibaba/Qwen streaming tool_call deltas may first provide a valid id and then send an empty string; only non-empty updates are accepted here to avoid overwriting an existing stable id.
      const nextToolCallId = nonEmptyToolCallIdOrUndefined(delta.id);
      if (nextToolCallId) {
        current.id = nextToolCallId;
      }

      if (isJsonObject(delta.function) && typeof delta.function.name === "string") {
        current.functionName += delta.function.name;
      }
      if (isJsonObject(delta.function) && typeof delta.function.arguments === "string") {
        current.functionArguments += delta.function.arguments;
      }

      if (
        shouldEmitStreamingToolNamePreview(current.functionName, previousFunctionName) &&
        !isGeneratedStreamingToolCallId(current.id)
      ) {
        updates.push({
          kind: "streaming-tool-preview",
          toolCallId: current.id,
          toolName: current.functionName,
          argumentsJson: resolveStreamingToolPreviewArgumentsJson(
            config,
            current.functionName,
            current.functionArguments,
          ),
        });
      }

      if (current.functionName === "finish_task") {
        if (finishTaskStreamingPreviewReady(current.functionName, current.functionArguments)) {
          updates.push({
            kind: "streaming-tool-preview",
            toolCallId: current.id,
            toolName: current.functionName,
            argumentsJson: current.functionArguments,
          });
        }
      } else if (current.functionName && !isGeneratedStreamingToolCallId(current.id)) {
        const previewState = {
          readyPreviewEmitted: current.readyPreviewEmitted,
          ...(current.lastPreviewArgsLen === undefined
            ? {}
            : { lastPreviewArgsLen: current.lastPreviewArgsLen }),
          ...(current.lastPreviewDetailSignature === undefined
            ? {}
            : { lastPreviewDetailSignature: current.lastPreviewDetailSignature }),
        };
        const decision = resolveStreamingToolPreviewEmit(
          current.functionName,
          current.functionArguments,
          previewState,
        );
        if (decision.emit) {
          updates.push({
            kind: "streaming-tool-preview",
            toolCallId: current.id,
            toolName: current.functionName,
            argumentsJson: resolveStreamingToolPreviewArgumentsJson(
              config,
              current.functionName,
              current.functionArguments,
            ),
          });
          current.readyPreviewEmitted = decision.nextState.readyPreviewEmitted;
          if (decision.nextState.lastPreviewArgsLen !== undefined) {
            current.lastPreviewArgsLen = decision.nextState.lastPreviewArgsLen;
          }
          if (decision.nextState.lastPreviewDetailSignature !== undefined) {
            current.lastPreviewDetailSignature = decision.nextState.lastPreviewDetailSignature;
          }
        }
      }

      toolCalls.set(delta.index, current);
    }
  }

  return updates;
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): JsonValue {
  const functionToolCalls = [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map((call) => ({
      index: call.index,
      id: call.id,
      type: call.type,
      function: {
        name: call.functionName,
        arguments: call.functionArguments,
      },
    }));

  return withReasoningContentIfNeeded(
    {
      role: "assistant",
      content: assistantContent || null,
      ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
    },
    reasoningContent,
  );
}

function extractToolCallsFromAggregatedMap(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): ToolCallRequest[] {
  return [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .filter((call) => call.functionName.trim().length > 0)
    .map((call) => ({
      id: call.id,
      name: call.functionName,
      argumentsJson: call.functionArguments,
    }));
}

function extractToolCallsFromAiSdk(toolCalls: readonly AiSdkToolCall[]): ToolCallRequest[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    argumentsJson: JSON.stringify(toolCall.input),
  }));
}

function withReasoningContentIfNeeded(message: JsonObject, reasoningContent: string): JsonValue {
  if (messageContentHasEmbeddedThinking(message)) {
    return message;
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if ("reasoning_content" in message) {
    return message;
  }

  if (reasoningContent.length > 0) {
    return {
      ...message,
      reasoning_content: reasoningContent,
    };
  }

  if (toolCalls.length > 0) {
    return {
      ...message,
      reasoning_content: "",
    };
  }

  return message;
}

function messageContentHasEmbeddedThinking(message: JsonObject): boolean {
  if (typeof message.content !== "string") {
    return false;
  }

  const trimmed = message.content.trimStart();
  return trimmed.startsWith("<think>") && trimmed.includes("</think>");
}

function extractAssistantReasoningContentFromJson(message: JsonObject): string {
  return [message.reasoning_content, message.reasoningContent, message.reasoning, message.thinking]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("");
}

function openAiTransportAssetRoot(config: Pick<OpenAiTransportConfig, "workspaceRoot">): string {
  return config.workspaceRoot ?? process.cwd();
}

function prepareVideoPassthroughRequest(
  config: OpenAiTransportConfig,
  requestMessages: JsonValue[],
): void {
  if (usesVideoPassthroughStash(config) && openAiMessagesContainVideoUrl(requestMessages)) {
    stashVideoPassthroughMessages(requestMessages);
  }
}

function clearVideoPassthroughRequest(config: OpenAiTransportConfig): void {
  if (usesVideoPassthroughStash(config)) {
    clearVideoPassthroughMessages();
  }
}

/**
 * The video_url passthrough stash restores the raw messages when the adapter's serializer would
 * drop `video_url` parts. The `@ai-sdk/moonshotai` adapter converts video to native file parts
 * itself and is the only exception. Content-gated: only requests actually carrying a video_url
 * part (after capability trimming) are stashed.
 */
function usesVideoPassthroughStash(config: Pick<OpenAiTransportConfig, "sdk">): boolean {
  return config.sdk !== "@ai-sdk/moonshotai";
}

function normalizeMessagesForRequest(
  config: Pick<OpenAiTransportConfig, "model" | "modelCapabilities">,
  messages: JsonValue[],
): JsonValue[] {
  const profile = resolveOpenAiModelCompatibilityProfile(config);
  return messages.map((message) => sanitizeMessageForCompatibility(message, profile));
}

function sanitizeMessageForCompatibility(
  message: JsonValue,
  profile: ReturnType<typeof resolveOpenAiModelCompatibilityProfile>,
): JsonValue {
  const cloned = cloneJsonValue(message);
  if (!isJsonObject(cloned) || cloned.role !== "user" || !Array.isArray(cloned.content)) {
    return cloned;
  }

  let content = cloned.content;
  if (profile.hasExplicitCapabilities && !profile.capabilities.imageInput) {
    content = content.filter((part) => !(isJsonObject(part) && part.type === "image_url"));
  }
  if (profile.hasExplicitCapabilities && !profile.capabilities.videoInput) {
    content = content.filter((part) => !(isJsonObject(part) && part.type === "video_url"));
  }

  // filter always produces a new array, so a reference change does not mean a part was actually dropped;
  // only collapse when parts were truly dropped, and the collapse keeps parts that were not dropped (e.g. a still-supported video_url), not just text.
  if (content.length !== cloned.content.length) {
    return {
      ...cloned,
      content: content.length > 0 ? content : "",
    };
  }

  return cloned;
}

function isMoonshotOfficialAiSdkProvider(config: Pick<OpenAiTransportConfig, "sdk">): boolean {
  return config.sdk === "@ai-sdk/moonshotai";
}

/** These adapters emit structured reasoning stream events instead of raw reasoning_text deltas. */
function usesStructuredReasoningStreamEvents(config: OpenAiTransportConfig): boolean {
  return config.sdk === "@ai-sdk/deepseek" || config.sdk === "@ai-sdk/moonshotai";
}

function buildAiSdkImageGenerationUrl(config: OpenAiImageGenerationConfig): string {
  if (config.imageApi === "vercel-gateway-images") {
    // Log label only; the gateway adapter owns the absolute v3 image-model URL.
    return "gateway-v3/image-model";
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL).replace(/\/$/, "");
  return `${baseUrl}/images/generations`;
}

function logAiSdkChatCompletionFailure(
  config: OpenAiTransportConfig,
  error: unknown,
  context: { streaming: boolean; phase?: "start" | "stream" } = { streaming: false },
): void {
  console.error("[agent-core][chat-completions] request.failed", {
    adapter: "ai-sdk",
    sdk: config.sdk ?? "@ai-sdk/openai-compatible",
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    streaming: context.streaming,
    ...(context.phase ? { phase: context.phase } : {}),
    ...describeAiSdkErrorForDebug(error),
  });
}

function logAiSdkImageGenerationStart(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  requestUrl: string,
): void {
  console.error("[agent-core][generate-image] request.start", {
    shape: config.imageApi ?? "openai-images",
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    requestUrl,
    size: request.size,
    usedDefaultSize: request.size === DEFAULT_IMAGE_GENERATION_SIZE,
    promptPreview: truncateChars(singleLine(request.prompt), 160),
  });
}

function logAiSdkImageGenerationSuccess(
  config: OpenAiImageGenerationConfig,
  requestUrl: string,
  saved: GeneratedImageFile,
): void {
  console.error("[agent-core][generate-image] request.success", {
    shape: config.imageApi ?? "openai-images",
    model: config.model,
    requestUrl,
    savedPath: saved.path,
    mimeType: saved.mimeType,
  });
}

function logAiSdkImageGenerationFailure(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  requestUrl: string,
  error: unknown,
): void {
  console.error("[agent-core][generate-image] request.failed", {
    shape: config.imageApi ?? "openai-images",
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    requestUrl,
    size: request.size,
    usedDefaultSize: request.size === DEFAULT_IMAGE_GENERATION_SIZE,
    promptPreview: truncateChars(singleLine(request.prompt), 160),
    ...describeAiSdkErrorForDebug(error),
  });
}

function describeAiSdkErrorForDebug(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      errorType: typeof error,
      errorMessage: String(error),
    };
  }

  const candidate = error as Error & {
    url?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    responseHeaders?: unknown;
    data?: unknown;
    cause?: unknown;
  };

  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(typeof candidate.url === "string" ? { errorUrl: candidate.url } : {}),
    ...(typeof candidate.statusCode === "number" ? { statusCode: candidate.statusCode } : {}),
    ...(candidate.responseBody !== undefined
      ? { responseBodyPreview: truncateChars(stringifyDebugValue(candidate.responseBody), 4000) }
      : {}),
    ...(candidate.responseHeaders !== undefined
      ? { responseHeaders: normalizeDebugValue(candidate.responseHeaders) }
      : {}),
    ...(candidate.data !== undefined ? { errorData: normalizeDebugValue(candidate.data) } : {}),
    ...(candidate.cause !== undefined
      ? { errorCause: truncateChars(stringifyDebugValue(candidate.cause), 1000) }
      : {}),
    ...(error.stack ? { stackPreview: truncateChars(error.stack, 2000) } : {}),
  };
}

function normalizeDebugValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return stringifyDebugValue(value);
  }
}

function stringifyDebugValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function renderAiSdkOpenAiError(error: unknown): string {
  return renderAiSdkProviderError(error);
}

function tryParseRequestBody(body: BodyInit | null | undefined): JsonValue | undefined {
  if (typeof body !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(body) as JsonValue;
  } catch {
    return undefined;
  }
}

function tryParseJsonValue(value: unknown): JsonValue | undefined {
  if (typeof value !== "string") {
    return value as JsonValue | undefined;
  }

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function isFunctionToolDefinition(value: JsonValue): value is OpenAiFunctionToolDefinition {
  return isJsonObject(value) && value.type === "function" && isJsonObject(value.function);
}

function isJsonObjectUnknown(value: unknown): value is JsonObject {
  return isJsonObject(value as JsonValue | undefined);
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  return `${chars.slice(0, maxChars).join("")}...`;
}

function hasNonEmptyToolCallId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonEmptyToolCallIdOrUndefined(value: unknown): string | undefined {
  return hasNonEmptyToolCallId(value) ? value : undefined;
}

function isGeneratedStreamingToolCallId(value: string): boolean {
  return value.startsWith(STREAMING_TOOL_CALL_PLACEHOLDER_PREFIX);
}

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function trimLeadingStreamLineBreaks(existingText: string, nextText: string): string {
  if (existingText.length > 0) {
    return nextText;
  }

  return nextText.replace(/^[\r\n]+/u, "");
}

async function* emptyAiSdkEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}
