import { basename } from "node:path";

import { createAlibaba } from "@ai-sdk/alibaba";
import { createFireworks } from "@ai-sdk/fireworks";
import { createBaseten } from "@ai-sdk/baseten";
import { createGroq, type GroqLanguageModelOptions } from "@ai-sdk/groq";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek, type DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGoogle, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMoonshotAI, type MoonshotAILanguageModelOptions } from "@ai-sdk/moonshotai";
import { createXai } from "@ai-sdk/xai";
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
} from "../tool-streaming-preview-gate.js";
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  createLlmMessageContentFromTextAndImages,
  llmMessageTextContent,
} from "../ports.js";
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
  openAiReasoningMode,
  openAiVendorChatCompletionBodyExtras,
  openAiStreamingUsageBodyExtras,
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiImageGenerationConfig,
  type OpenAiTransportConfig,
} from "./openai-compat.js";
import { modelSupportsOpenAiGpt56ReasoningControls } from "./gpt-reasoning-controls.js";
import {
  buildGatewayMinimaxProviderOptions,
  isGatewayMinimaxModel,
} from "./gateway-minimax-thinking.js";
import {
  buildGatewayAlibabaProviderOptions,
  isGatewayAlibabaModel,
} from "./gateway-alibaba-thinking.js";
import {
  buildGatewayAnthropicProviderOptions,
  isGatewayAnthropicClaudeModel,
} from "./gateway-anthropic-thinking.js";
import {
  buildGatewayCodeCompletionProviderOptions,
  shouldUseGatewayCodeCompletionProviderOptions,
} from "./gateway-code-completion-thinking.js";
import {
  buildGatewayDeepSeekProviderOptions,
  isGatewayDeepSeekModel,
} from "./gateway-deepseek-thinking.js";
import {
  buildGatewayMoonshotProviderOptions,
  isGatewayMoonshotModel,
  isMoonshotThinkingSwitchModel,
} from "./moonshot-thinking-switch.js";
import {
  buildGatewayXiaomiProviderOptions,
  isGatewayXiaomiModel,
} from "./gateway-xiaomi-thinking.js";
import { buildGatewayZaiProviderOptions, isGatewayZaiModel } from "./gateway-zai-thinking.js";
import {
  buildGatewayXaiProviderOptions,
  isGatewayXaiModel,
  resolveXaiProviderReasoningEffort,
} from "./gateway-xai-reasoning.js";
import {
  buildGatewayGoogleProviderOptions,
  buildGoogleThinkingConfigForEffort,
  isGatewayGoogleGeminiModel,
} from "./gateway-google-thinking.js";
import { isOpenRouterAnthropicClaudeModel } from "./openrouter-anthropic-reasoning.js";
import { generateSiliconFlowImage } from "../image-generation/siliconflow-backend.js";
import { generateHuggingFaceImage } from "../image-generation/huggingface-backend.js";
import { generateStepfunImage } from "../image-generation/stepfun-backend.js";
import { isCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { generateVideoWithRouter } from "../video-generation/router.js";
import { getLlmFetch } from "../llm-fetch.js";
import { wrapFetchForCloudflareAiGateway } from "../cloudflare-ai-gateway-fetch.js";
import { createAlibabaChatCompletionsAwareFetch } from "../open-responses/alibaba-chat-completions-fetch.js";
import {
  buildAlibabaChatCompletionsExtraBody,
  shouldPatchAlibabaChatCompletionsExtraBody,
  shouldUseAlibabaChatCompletionsBuiltInTools,
} from "../open-responses/alibaba-built-in-tools.js";
import {
  clearMoonshotChatCompletionMessages,
  openAiMessagesContainVideoUrl,
  stashMoonshotChatCompletionMessages,
  takeMoonshotChatCompletionMessages,
} from "./moonshot-chat-completion-messages.js";
import {
  llmHistoryToOpenAiMessages,
  resolveMoonshotVideoUrlsInOpenAiMessages,
} from "./openai-multimodal-messages.js";
import { resolveXiaomiVideoUrlsInOpenAiMessages } from "./xiaomi-video-messages.js";
import { resolveDeepInfraVideoUrlsInOpenAiMessages } from "./deepinfra-video-messages.js";
import { resolveStepfunVideoUrlsInOpenAiMessages } from "./stepfun-video-messages.js";
import { normalizeMoonshotApiBase } from "./moonshot-files.js";
import {
  buildMoonshotFormulaTraceToolEntries,
  createMoonshotFormulaChatCompletionsAwareFetch,
} from "../moonshot/formula/moonshot-chat-completions-fetch.js";
import { shouldUseMoonshotFormulaWebSearch } from "../moonshot/formula/formula-eligibility.js";
import { buildMoonshotFormulaStreamingToolPreviewArgumentsJson } from "../moonshot/formula/moonshot-formula-tool-loop.js";
import { buildStepfunWebSearchStreamingPreviewArgumentsJson } from "../stepfun/stepfun-web-search-tool-loop.js";
import { buildKimiCodeWebSearchStreamingPreviewArgumentsJson } from "../kimi-code/kimi-code-web-search-tool-loop.js";
import { buildZaiWebSearchStreamingPreviewArgumentsJson } from "../zai/zai-web-search-tool-loop.js";
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
  type OpenAiJsonSchemaTransport,
} from "./json-schema.js";

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1";
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

const MANAGED_GENERATED_ASSET_PROTOCOL = "spirit:";
const MANAGED_GENERATED_ASSET_HOST = "generated";

export function normalizeGeneratedImageMarkdownRef(markdownRef: string): string {
  const trimmed = markdownRef.trim();
  if (!trimmed) {
    throw new Error("Host returned an empty generated image markdownRef.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  if (
    url.protocol.toLowerCase() !== MANAGED_GENERATED_ASSET_PROTOCOL ||
    url.hostname.toLowerCase() !== MANAGED_GENERATED_ASSET_HOST ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== "image") {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  let imageId: string;
  try {
    imageId = decodeURIComponent(segments[1] ?? "").trim();
  } catch {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  if (
    !imageId ||
    imageId !== basename(imageId) ||
    imageId === "." ||
    imageId === ".." ||
    imageId.includes("/") ||
    imageId.includes("\\")
  ) {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  return `spirit://generated/image/${encodeURIComponent(imageId)}`;
}

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

    if (imageConfig.llmVendor === "siliconflow") {
      return generateSiliconFlowImage(imageConfig, request, saveGeneratedImage);
    }

    if (imageConfig.llmVendor === "hugging-face") {
      return generateHuggingFaceImage(imageConfig, request, saveGeneratedImage);
    }

    if (imageConfig.llmVendor === "stepfun") {
      return generateStepfunImage(imageConfig, request, saveGeneratedImage);
    }

    const requestUrl = buildAiSdkImageGenerationUrl(imageConfig);
    logAiSdkImageGenerationStart(imageConfig, request, requestUrl);

    let result: Awaited<ReturnType<typeof generateAiImage>>;
    try {
      // TODO: If we later add image models that do not use OpenAI Images-compatible
      // endpoints, do not blindly forward WIDTHxHEIGHT. Translate this shared size
      // field per selected provider/model instead.
      result = await generateAiImage({
        model: createAiSdkImageModel(imageConfig),
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

    const summaryLines = ["[generated image]"];
    const markdownRef = normalizeGeneratedImageMarkdownRef(saved.markdownRef);
    summaryLines.push(
      `image_ref: ${markdownRef}`,
      `read_file_path: ${markdownRef}`,
      `embed_markdown: ![Generated image](${markdownRef})`,
    );
    summaryLines.push(`mime_type: ${saved.mimeType}`, `model: ${imageConfig.model}`);
    const summaryText = summaryLines.join("\n");

    return {
      content: createLlmMessageContentFromTextAndImages(summaryText, [saved.path]),
      summaryText,
    };
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
    await resolveOpenAiCompatibleVideoInputsInMessages(
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
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildAiSdkProviderOptions(config),
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

    await resolveOpenAiCompatibleVideoInputsInMessages(
      config,
      nextState.messages,
      openAiTransportAssetRoot(config),
    );
    const requestMessages = normalizeMessagesForRequest(config, nextState.messages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const tracedRequest = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    prepareMoonshotChatCompletionRequest(config, requestMessages);
    try {
      const result: any = await generateText({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(config, requestMessages) as any,
        allowSystemInMessages: true,
        include: { responseBody: true },
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAiSdkProviderOptions(config),
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
      clearMoonshotChatCompletionRequest(config);
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
    try {
      await resolveOpenAiCompatibleVideoInputsInMessages(
        config,
        nextState.messages,
        openAiTransportAssetRoot(config),
      );
      requestMessages = normalizeMessagesForRequest(config, nextState.messages);
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
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );

    const abortController = new AbortController();

    // Xiaomi/DeepInfra video: the stash must be cleaned up only after streamText has asynchronously issued the HTTP request, not in a synchronous finally.
    prepareMoonshotChatCompletionRequest(config, requestMessages);
    try {
      const result: any = streamText({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(config, requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAiSdkProviderOptions(config),
        include: { rawChunks: true },
        maxRetries: 2,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      const completionPromise = completion.promise.finally(() => {
        clearMoonshotChatCompletionRequest(config);
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
          clearMoonshotChatCompletionRequest(config);
        },
      };
    } catch (error) {
      clearMoonshotChatCompletionRequest(config);
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
          providerOptions: buildAiSdkProviderOptions(compactConfig),
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
        providerOptions: buildAiSdkProviderOptions(compactConfig),
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
  const requestTrace = buildOpenAiRequestTrace(config, stepIndex, messages, tools, stream);
  if (
    !isDeepSeekOfficialAiSdkProvider(config) &&
    !isXaiOfficialAiSdkProvider(config) &&
    !isMoonshotOfficialAiSdkProvider(config) &&
    !isAlibabaOfficialAiSdkProvider(config) &&
    !isVercelAiGatewayProvider(config) &&
    !isGoogleOfficialAiSdkProvider(config) &&
    !isGoogleVertexOfficialAiSdkProvider(config)
  ) {
    return requestTrace;
  }

  const firstTrace = requestTrace[0];
  if (!isJsonObject(firstTrace)) {
    return requestTrace;
  }

  const kind = isDeepSeekOfficialAiSdkProvider(config)
    ? "deepseek_sdk_chat_completions"
    : isXaiOfficialAiSdkProvider(config)
      ? "xai_sdk_chat_completions"
      : isMoonshotOfficialAiSdkProvider(config)
        ? "moonshot_sdk_chat_completions"
        : isAlibabaOfficialAiSdkProvider(config)
          ? "alibaba_sdk_chat_completions"
          : isVercelAiGatewayProvider(config)
            ? "gateway_sdk_chat_completions"
            : isGoogleVertexOfficialAiSdkProvider(config)
              ? "google_vertex_sdk_generate_content"
              : "google_sdk_generate_content";

  const alibabaExtraBody =
    isAlibabaOfficialAiSdkProvider(config) && shouldUseAlibabaChatCompletionsBuiltInTools(config)
      ? buildAlibabaChatCompletionsExtraBody({ streaming: stream })
      : undefined;
  const moonshotFormulaTraceTools =
    isMoonshotOfficialAiSdkProvider(config) && shouldUseMoonshotFormulaWebSearch(config)
      ? buildMoonshotFormulaTraceToolEntries()
      : undefined;

  return [
    {
      ...firstTrace,
      kind,
      ...(alibabaExtraBody ? { extra_body: alibabaExtraBody } : {}),
      ...(moonshotFormulaTraceTools && isJsonObject(firstTrace)
        ? {
            tools: [
              ...((Array.isArray(firstTrace.tools) ? firstTrace.tools : []) as JsonValue[]),
              ...moonshotFormulaTraceTools.map((tool) => tool as JsonValue),
            ],
          }
        : {}),
    },
    ...requestTrace.slice(1),
  ];
}

function createAiSdkLanguageModel(config: OpenAiTransportConfig): any {
  if (isDeepSeekOfficialAiSdkProvider(config)) {
    return createAiSdkDeepSeekProvider(config).chat(config.model);
  }

  if (isXaiOfficialAiSdkProvider(config)) {
    return createAiSdkXaiProvider(config).chat(config.model);
  }

  if (isAlibabaOfficialAiSdkProvider(config)) {
    return createAiSdkAlibabaProvider(config).chatModel(config.model);
  }

  if (isVercelAiGatewayProvider(config)) {
    return createAiSdkGatewayProvider(config)(config.model);
  }

  if (config.llmVendor === "openai") {
    throw new Error(
      "OpenAI official Chat Completions is no longer supported; use transportKind open-responses.",
    );
  }

  if (isGoogleOfficialAiSdkProvider(config)) {
    return createAiSdkGoogleProvider(config).chat(config.model);
  }

  if (isGoogleVertexOfficialAiSdkProvider(config)) {
    return createAiSdkGoogleVertexProvider(config)(config.model);
  }

  if (isMoonshotOfficialAiSdkProvider(config)) {
    return createAiSdkMoonshotProvider(config).chatModel(config.model);
  }

  if (isFireworksOfficialAiSdkProvider(config)) {
    return createAiSdkFireworksProvider(config)(config.model);
  }

  if (isTogetherOfficialAiSdkProvider(config)) {
    return createAiSdkTogetherProvider(config)(config.model);
  }

  if (isBasetenOfficialAiSdkProvider(config)) {
    return createAiSdkBasetenProvider(config)(config.model);
  }

  if (isGroqOfficialAiSdkProvider(config)) {
    return createAiSdkGroqProvider(config)(config.model);
  }

  if (isDeepInfraOfficialAiSdkProvider(config)) {
    return createAiSdkDeepInfraProvider(config)(config.model);
  }

  if (isCohereOfficialAiSdkProvider(config)) {
    return createAiSdkCohereProvider(config)(config.model);
  }

  return createAiSdkOpenAiCompatibleProvider(config).chatModel(config.model);
}

function createAiSdkImageModel(config: OpenAiImageGenerationConfig): any {
  if (isVercelAiGatewayImageConfig(config)) {
    // Gateway image generation uses the v3 image-model protocol; it cannot reuse the chat-preset /v1 baseUrl.
    return createGateway({ apiKey: config.apiKey, fetch: getLlmFetch() }).image(config.model);
  }

  if (isTogetherOfficialAiSdkImageConfig(config)) {
    return createAiSdkTogetherProvider(config).image(config.model);
  }

  return createAiSdkOpenAiCompatibleProvider(config, { includeChatVendorExtras: false }).imageModel(
    config.model,
  );
}

function createAiSdkOpenAiCompatibleProvider(
  config: OpenAiTransportConfig | OpenAiImageGenerationConfig,
  options: { includeChatVendorExtras?: boolean } = {},
) {
  const transportConfig = config as OpenAiTransportConfig;
  const vendorExtras =
    options.includeChatVendorExtras === false
      ? {}
      : openAiVendorChatCompletionBodyExtras(transportConfig);
  const needsVideoStash = usesOpenAiCompatibleVideoMessageStash(transportConfig.llmVendor);
  const needsFetchWrapper = needsVideoStash || Object.keys(vendorExtras).length > 0;
  const fetchWrapper = !needsFetchWrapper
    ? undefined
    : async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = tryParseRequestBody(init?.body);
        if (!isJsonObject(body)) {
          return getLlmFetch()(input, init);
        }

        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : "request";
        const stashedMessages =
          needsVideoStash && requestUrl.includes("/chat/completions")
            ? takeMoonshotChatCompletionMessages()
            : undefined;

        return getLlmFetch()(input, {
          ...init,
          body: JSON.stringify({
            ...body,
            ...vendorExtras,
            ...openAiStreamingUsageBodyExtras(transportConfig, body.stream === true),
            ...(stashedMessages ? { messages: stashedMessages } : {}),
          }),
        });
      };

  const headers = {
    ...(config.organization ? { "OpenAI-Organization": config.organization } : {}),
    ...(config.project ? { "OpenAI-Project": config.project } : {}),
  };

  let resolvedFetch = wrapFetchForCloudflareAiGateway(
    transportConfig.cloudflareGatewayId,
    fetchWrapper ?? getLlmFetch(),
  );
  // Neither TokenHub Chat `web_search_options` nor Responses `/v1/responses` web search is integrated:
  // the former was tested and the upstream still performed no effective real-time retrieval after injection; the latter is supported by only a few models and does not match the existing Chat Completions matrix, so the maintenance cost is not worthwhile.

  return createOpenAICompatible({
    apiKey: config.apiKey,
    name: "openai",
    baseURL: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    supportsStructuredOutputs: true,
    // api.kimi.com/coding omits usage from streaming responses unless the request carries
    // stream_options.include_usage; without usage the host cannot track context usage.
    ...(transportConfig.llmVendor === "kimi-code" ? { includeUsage: true } : {}),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    fetch: resolvedFetch,
  });
}

function createAiSdkMoonshotProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const formulaAwareFetch = createMoonshotFormulaChatCompletionsAwareFetch(config, getLlmFetch());
  const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = tryParseRequestBody(init?.body);
    if (!isJsonObject(body)) {
      return formulaAwareFetch(input, init);
    }

    return formulaAwareFetch(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      }),
    });
  };

  return createMoonshotAI({
    apiKey: config.apiKey,
    baseURL: normalizeMoonshotApiBase(config.baseUrl),
    fetch: fetchWrapper,
  });
}

function createAiSdkXaiProvider(config: OpenAiTransportConfig) {
  return createXai({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_XAI_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAiSdkGoogleProvider(config: OpenAiTransportConfig) {
  return createGoogle({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_GOOGLE_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAiSdkGoogleVertexProvider(config: OpenAiTransportConfig) {
  const project = config.vertexProject?.trim();
  const location = config.vertexLocation?.trim();
  const apiKey = config.apiKey?.trim();
  const clientEmail = config.vertexClientEmail?.trim();
  const privateKey = config.vertexPrivateKey?.trim();
  const expressOnly = Boolean(apiKey) && !clientEmail && !privateKey && !project && !location;

  if (expressOnly) {
    return createVertex({
      apiKey,
      fetch: getLlmFetch(),
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
    fetch: getLlmFetch(),
  } as Parameters<typeof createVertex>[0]);
}

function createAiSdkDeepSeekProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const fetchWrapper =
    reasoningEffort === undefined
      ? undefined
      : async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = tryParseRequestBody(init?.body);
          if (!isJsonObject(body)) {
            return getLlmFetch()(input, init);
          }

          return getLlmFetch()(input, {
            ...init,
            body: JSON.stringify({
              ...body,
              reasoning_effort: reasoningEffort,
            }),
          });
        };

  return createDeepSeek({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: fetchWrapper ?? getLlmFetch(),
  });
}

function createAiSdkFireworksProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = tryParseRequestBody(init?.body);
    if (!isJsonObject(body)) {
      return getLlmFetch()(input, init);
    }

    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : "request";
    if (!requestUrl.includes("/chat/completions")) {
      return getLlmFetch()(input, init);
    }

    return getLlmFetch()(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      }),
    });
  };

  return createFireworks({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: fetchWrapper,
  });
}

function createAiSdkTogetherProvider(
  config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl"> | OpenAiImageGenerationConfig,
) {
  // The SDK defaults to api.together.xyz; the connection config's api.together.ai/v1 must explicitly override it.
  return createTogetherAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: getLlmFetch(),
  });
}

function createAiSdkBasetenProvider(config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">) {
  return createBaseten({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: getLlmFetch(),
  });
}

function createAiSdkGroqProvider(config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">) {
  // The SDK defaults to https://api.groq.com/openai/v1; the connection config must explicitly override baseURL.
  return createGroq({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: getLlmFetch(),
  });
}

/**
 * baseURL dual-track: the connection config stores the OpenAI-compatible root (e.g. https://api.deepinfra.com/v1/openai),
 * while @ai-sdk/deepinfra's baseURL expects https://api.deepinfra.com/v1 (the SDK language model appends /openai/... itself).
 * So strip the trailing /openai suffix; custom roots without that suffix are passed through unchanged.
 */
function normalizeDeepInfraSdkBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return undefined;
  }
  return trimmed.endsWith("/openai") ? trimmed.slice(0, -"/openai".length) : trimmed;
}

const DEEPINFRA_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Injected only when the user explicitly selects an effort level; when unset, the field is omitted so the server default applies
 * (no medium fallback via openAiReasoningEffort, to avoid sending it to non-reasoning models by mistake).
 */
function resolveDeepInfraReasoningEffort(
  config: Pick<OpenAiTransportConfig, "reasoningEffort">,
): string | undefined {
  const raw = config.reasoningEffort;
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  return DEEPINFRA_REASONING_EFFORTS.has(normalized) ? normalized : undefined;
}

function createAiSdkDeepInfraProvider(config: OpenAiTransportConfig) {
  const isCodeCompletion = isCodeCompletionTransportProfile(config);
  const reasoningEffort = isCodeCompletion ? undefined : resolveDeepInfraReasoningEffort(config);
  const thinkingDisabled = isCodeCompletion || config.vendorExtendedThinking === false;
  // deepinfra uses the official SDK instead of createAiSdkOpenAiCompatibleProvider, so stash restoration must also happen inside this wrapper.
  const needsVideoStash = usesOpenAiCompatibleVideoMessageStash(config.llmVendor);
  const needsFetchWrapper = needsVideoStash || reasoningEffort !== undefined || thinkingDisabled;
  const fetchWrapper = !needsFetchWrapper
    ? undefined
    : async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = tryParseRequestBody(init?.body);
        if (!isJsonObject(body)) {
          return getLlmFetch()(input, init);
        }

        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : "request";
        if (!requestUrl.includes("/chat/completions")) {
          return getLlmFetch()(input, init);
        }

        // DeepInfra OpenAPI supports flat reasoning_effort and reasoning.enabled to disable thinking;
        // runtime fields are authoritative (more reliable than the can-disable-reasoning tag from /models/list), so the tag is not read.
        const stashedMessages = needsVideoStash ? takeMoonshotChatCompletionMessages() : undefined;
        return getLlmFetch()(input, {
          ...init,
          body: JSON.stringify({
            ...body,
            ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
            ...(thinkingDisabled ? { reasoning: { enabled: false } } : {}),
            ...(stashedMessages ? { messages: stashedMessages } : {}),
          }),
        });
      };

  return createDeepInfra({
    apiKey: config.apiKey,
    baseURL: normalizeDeepInfraSdkBaseUrl(config.baseUrl) ?? DEFAULT_DEEPINFRA_BASE_URL,
    fetch: fetchWrapper ?? getLlmFetch(),
  });
}

function createAiSdkCohereProvider(config: Pick<OpenAiTransportConfig, "apiKey" | "baseUrl">) {
  return createCohere({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: getLlmFetch(),
  });
}

function createAiSdkAlibabaProvider(config: OpenAiTransportConfig) {
  const fetchWrapper = shouldPatchAlibabaChatCompletionsExtraBody(config)
    ? createAlibabaChatCompletionsAwareFetch(config, getLlmFetch())
    : getLlmFetch();

  return createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: fetchWrapper,
  });
}

function createAiSdkGatewayProvider(config: OpenAiTransportConfig) {
  // Gateway chat uses the v3 AI protocol (default …/v3/ai/language-model); it cannot use the model catalog's preset /v1 baseUrl.
  return createGateway({
    apiKey: config.apiKey,
    fetch: getLlmFetch(),
  });
}

function buildAiSdkProviderOptions(config: OpenAiTransportConfig): Record<string, JsonObject> {
  if (shouldUseGatewayCodeCompletionProviderOptions(config)) {
    return buildGatewayCodeCompletionProviderOptions(config);
  }

  if (
    isVercelAiGatewayProvider(config) &&
    isGatewayAnthropicClaudeModel(config.llmVendor, config.model)
  ) {
    return buildGatewayAnthropicProviderOptions(config);
  }

  if (
    isVercelAiGatewayProvider(config) &&
    isGatewayGoogleGeminiModel(config.llmVendor, config.model)
  ) {
    return buildGatewayGoogleProviderOptions(config, openAiReasoningEffort(config));
  }

  if (isVercelAiGatewayProvider(config) && isGatewayDeepSeekModel(config.llmVendor, config.model)) {
    return buildGatewayDeepSeekProviderOptions(config);
  }

  if (isVercelAiGatewayProvider(config) && isGatewayMoonshotModel(config.llmVendor, config.model)) {
    const moonshotOptions = buildGatewayMoonshotProviderOptions(config);
    if (Object.keys(moonshotOptions).length > 0) {
      return moonshotOptions;
    }
  }

  if (isVercelAiGatewayProvider(config) && isGatewayXiaomiModel(config.llmVendor, config.model)) {
    const xiaomiOptions = buildGatewayXiaomiProviderOptions(config);
    if (Object.keys(xiaomiOptions).length > 0) {
      return xiaomiOptions;
    }
  }

  if (isVercelAiGatewayProvider(config) && isGatewayZaiModel(config.llmVendor, config.model)) {
    const zaiOptions = buildGatewayZaiProviderOptions(config);
    if (Object.keys(zaiOptions).length > 0) {
      return zaiOptions;
    }
  }

  if (isVercelAiGatewayProvider(config) && isGatewayAlibabaModel(config.llmVendor, config.model)) {
    const alibabaOptions = buildGatewayAlibabaProviderOptions(config);
    if (Object.keys(alibabaOptions).length > 0) {
      return alibabaOptions;
    }
  }

  if (isVercelAiGatewayProvider(config) && isGatewayMinimaxModel(config.llmVendor, config.model)) {
    const minimaxOptions = buildGatewayMinimaxProviderOptions(config);
    if (Object.keys(minimaxOptions).length > 0) {
      return minimaxOptions;
    }
  }

  if (isVercelAiGatewayProvider(config) && isGatewayXaiModel(config.llmVendor, config.model)) {
    const xaiOptions = buildGatewayXaiProviderOptions(
      config.llmVendor,
      config.model,
      openAiReasoningEffort(config),
    );
    if (Object.keys(xaiOptions).length > 0) {
      return xaiOptions;
    }
  }

  if (isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model)) {
    return {};
  }

  if (isAlibabaOfficialAiSdkProvider(config)) {
    if (isCodeCompletionTransportProfile(config)) {
      return {
        alibaba: {
          enableThinking: false,
        } as JsonObject,
      };
    }

    const alibabaOptions: JsonObject = {};
    if (config.vendorExtendedThinking === false) {
      alibabaOptions.enableThinking = false;
    }

    const extraBody = shouldUseAlibabaChatCompletionsBuiltInTools(config)
      ? buildAlibabaChatCompletionsExtraBody({ streaming: true })
      : undefined;

    if (extraBody !== undefined) {
      alibabaOptions.extraBody = extraBody;
    }

    if (Object.keys(alibabaOptions).length === 0) {
      return {};
    }

    return {
      alibaba: alibabaOptions,
    };
  }

  if (isDeepSeekOfficialAiSdkProvider(config)) {
    const deepseekOptions = {
      thinking: {
        type: config.vendorExtendedThinking === false ? "disabled" : "enabled",
      },
    } satisfies DeepSeekLanguageModelOptions;

    return {
      deepseek: deepseekOptions as JsonObject,
    };
  }

  if (isMoonshotOfficialAiSdkProvider(config)) {
    const moonshotContext = {
      provider: "moonshot-ai" as const,
      model: config.model,
      transportKind: "openai-compatible" as const,
    };
    if (!isMoonshotThinkingSwitchModel(moonshotContext)) {
      return {};
    }

    const moonshotaiOptions = {
      thinking: {
        type: config.vendorExtendedThinking === false ? "disabled" : "enabled",
      },
    } satisfies MoonshotAILanguageModelOptions;

    return {
      moonshotai: moonshotaiOptions as JsonObject,
    };
  }

  if (isXaiOfficialAiSdkProvider(config)) {
    const reasoningEffort = resolveXaiProviderReasoningEffort(openAiReasoningEffort(config));
    if (reasoningEffort === undefined) {
      return {};
    }

    return {
      xai: {
        reasoningEffort,
      } as JsonObject,
    };
  }

  if (isGoogleOfficialAiSdkProvider(config)) {
    const thinkingConfig = buildGoogleThinkingConfigForEffort(
      config.model,
      openAiReasoningEffort(config),
    );
    if (thinkingConfig === undefined) {
      return {};
    }

    const googleOptions = {
      thinkingConfig,
    } satisfies GoogleLanguageModelOptions;

    return {
      google: googleOptions as JsonObject,
    };
  }

  if (isGoogleVertexOfficialAiSdkProvider(config)) {
    const thinkingConfig = buildGoogleThinkingConfigForEffort(
      config.model,
      openAiReasoningEffort(config),
    );
    if (thinkingConfig === undefined) {
      return {};
    }

    const vertexOptions = {
      thinkingConfig,
    } satisfies GoogleLanguageModelOptions;

    return {
      vertex: vertexOptions as JsonObject,
    };
  }

  if (isFireworksOfficialAiSdkProvider(config)) {
    return {};
  }

  if (isGroqOfficialAiSdkProvider(config)) {
    const reasoningEffort = resolveGroqProviderReasoningEffort(config);
    if (reasoningEffort === undefined) {
      return {};
    }

    const groqOptions = {
      reasoningEffort,
    } satisfies GroqLanguageModelOptions;

    return {
      groq: groqOptions as JsonObject,
    };
  }

  if (
    modelSupportsOpenAiGpt56ReasoningControls({
      ...(config.llmVendor ? { provider: config.llmVendor } : {}),
      model: config.model,
    })
  ) {
    // GPT-5.6+ reasoning is written as a nested reasoning object via the fetch wrapper; do not inject top-level reasoning_effort via AI SDK openai.* anymore.
    return {};
  }

  const reasoningEffort = openAiReasoningEffort(config) as
    | OpenAICompatibleLanguageModelChatOptions["reasoningEffort"]
    | undefined;
  const reasoningMode = openAiReasoningMode(config);

  if (reasoningEffort === undefined && reasoningMode === undefined) {
    return {};
  }

  return {
    openai: {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningMode !== undefined ? { reasoningMode } : {}),
    } as JsonObject,
  };
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
  config: Pick<OpenAiTransportConfig, "llmVendor">,
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

function resolveStreamingToolPreviewArgumentsJson(
  config: OpenAiTransportConfig,
  toolName: string,
  argumentsJson: string,
): string {
  return (
    buildMoonshotFormulaStreamingToolPreviewArgumentsJson(config, toolName, argumentsJson) ??
    buildStepfunWebSearchStreamingPreviewArgumentsJson(config, toolName, argumentsJson) ??
    buildKimiCodeWebSearchStreamingPreviewArgumentsJson(config, toolName, argumentsJson) ??
    buildZaiWebSearchStreamingPreviewArgumentsJson(config, toolName, argumentsJson) ??
    argumentsJson
  );
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

async function resolveOpenAiCompatibleVideoInputsInMessages(
  config: OpenAiTransportConfig,
  messages: JsonValue[],
  assetRoot: string,
): Promise<void> {
  await resolveMoonshotVideoUrlsInOpenAiMessages(config, messages, assetRoot);
  resolveXiaomiVideoUrlsInOpenAiMessages(config, messages, assetRoot);
  resolveDeepInfraVideoUrlsInOpenAiMessages(config, messages, assetRoot);
  await resolveStepfunVideoUrlsInOpenAiMessages(config, messages, assetRoot);
}

function prepareMoonshotChatCompletionRequest(
  config: OpenAiTransportConfig,
  requestMessages: JsonValue[],
): void {
  if (
    usesOpenAiCompatibleVideoMessageStash(config.llmVendor) &&
    openAiMessagesContainVideoUrl(requestMessages)
  ) {
    stashMoonshotChatCompletionMessages(requestMessages);
  }
}

function clearMoonshotChatCompletionRequest(config: OpenAiTransportConfig): void {
  if (usesOpenAiCompatibleVideoMessageStash(config.llmVendor)) {
    clearMoonshotChatCompletionMessages();
  }
}

function usesOpenAiCompatibleVideoMessageStash(
  vendor: OpenAiTransportConfig["llmVendor"],
): boolean {
  return (
    vendor === "xiaomi" || vendor === "deepinfra" || vendor === "stepfun" || vendor === "kimi-code"
  );
}

function normalizeMessagesForRequest(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "modelCapabilities">,
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

function isDeepSeekOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "deepseek";
}

function isXaiOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "xai";
}

function isMoonshotOfficialAiSdkProvider(
  config: Pick<OpenAiTransportConfig, "llmVendor">,
): boolean {
  return config.llmVendor === "moonshot-ai";
}

function isFireworksOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "fireworks-ai";
}

function isTogetherOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "together-ai";
}

function isBasetenOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "baseten";
}

function isGroqOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "groq";
}

function isDeepInfraOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "deepinfra";
}

function resolveGroqProviderReasoningEffort(
  config: Pick<OpenAiTransportConfig, "reasoningEffort">,
): GroqLanguageModelOptions["reasoningEffort"] | undefined {
  const raw = config.reasoningEffort;
  if (raw === undefined || raw === "minimal") {
    return undefined;
  }

  // Groq Qwen requires passing default explicitly; do not map default to undefined via openAiReasoningEffort.
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (normalized) {
    case "none":
    case "default":
    case "low":
    case "medium":
    case "high":
      return normalized;
    default:
      return undefined;
  }
}

function isCohereOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "cohere";
}

function isTogetherOfficialAiSdkImageConfig(config: OpenAiImageGenerationConfig): boolean {
  return config.llmVendor === "together-ai";
}

function usesStructuredReasoningStreamEvents(config: OpenAiTransportConfig): boolean {
  return isDeepSeekOfficialAiSdkProvider(config) || isMoonshotOfficialAiSdkProvider(config);
}

function isAlibabaOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "alibaba";
}

function isVercelAiGatewayProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "vercel-ai-gateway";
}

function isVercelAiGatewayImageConfig(config: OpenAiImageGenerationConfig): boolean {
  return config.llmVendor === "vercel-ai-gateway";
}

function isGoogleOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "google";
}

function isGoogleVertexOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === "google-vertex-ai";
}

function buildAiSdkImageGenerationUrl(config: OpenAiImageGenerationConfig): string {
  if (isVercelAiGatewayImageConfig(config)) {
    return "https://ai-gateway.vercel.sh/v3/ai/image-model";
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
    vendor: config.llmVendor ?? "custom",
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
    adapter: isVercelAiGatewayImageConfig(config)
      ? "ai-sdk-gateway-image"
      : isTogetherOfficialAiSdkImageConfig(config)
        ? "ai-sdk-togetherai-image"
        : "openai-compatible-image",
    vendor: config.llmVendor ?? "custom",
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
    adapter: "openai-compatible-image",
    vendor: config.llmVendor ?? "custom",
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
    adapter: "openai-compatible-image",
    vendor: config.llmVendor ?? "custom",
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
