import { readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createMiniMax } from "@ai-sdk/minimax";

import { getLlmFetch } from "../llm-fetch.js";
import { createDeclaredWireMergeFetch } from "../llm-declared-wire-fetch.js";
import {
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type TextStreamPart,
} from "ai";

import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
} from "../openai/json-schema.js";
import { buildAiSdkUserImageFilePartFromUrl } from "../ai-sdk-image-url-part.js";
import { readAiSdkUsage } from "../ai-sdk-usage.js";
import { finishTaskStreamingPreviewReady } from "../finish-task-preview.js";
import {
  hostToolArgumentsReadyForEarlyStreamingPreview,
  hostToolArgumentsReadyForPreview,
  resolveStreamingToolPreviewEmit,
} from "../tool-streaming-preview-gate.js";
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
import { llmHistoryToOpenAiMessages } from "../openai/tool-agent-helpers.js";
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
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
import { llmMessageHasMedia, llmMessageTextContent } from "../ports.js";
import type { LlmModelCapabilities } from "../llm-provider-shared.js";
import type { JsonSchemaTransport } from "../json-schema.js";
import {
  buildAnthropicProviderOptions,
  buildAnthropicRequestTrace,
  type AnthropicTransportConfig,
} from "./anthropic-compat.js";
import {
  appendStreamingTextAnthropicBlock,
  buildAnthropicServerToolAssistantMessageFields,
  createAnthropicServerToolStreamState,
  filterAnthropicServerToolCalls,
  handleAnthropicServerToolStreamPart,
  readAnthropicAssistantContentBlocks,
  resolveAnthropicServerToolAssistantReplayText,
  shouldSuppressAnthropicServerToolStreamError,
  type AnthropicServerToolStreamState,
} from "./server-tool-stream.js";
import {
  EMPTY_RESOLVED_PROVIDER_TOOLS,
  resolveDeclaredProviderTools,
  type ResolvedProviderTools,
} from "../provider-tools/runtime.js";
import { createProviderToolsWireFetch } from "../provider-tools/wire-fetch.js";
import { toolNamesFromDefinitions } from "../unknown-tool-error.js";
import { pathToLocalVideoReference } from "../openai/openai-multimodal-media-path.js";
import { resolveDeclaredVideoInputsInMessages } from "../openai/openai-multimodal-messages.js";

type AnthropicToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type OpenAiStyleFunctionToolDefinition = JsonObject & {
  type: "function";
  function: JsonObject;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface StreamingToolCallAccumulator {
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

type AnthropicToolCallStreamingStartPart = {
  type: "tool-call-streaming-start";
  toolCallId: string;
  toolName: string;
};

type AnthropicToolCallDeltaPart = {
  type: "tool-call-delta";
  toolCallId: string;
  toolName: string;
  argsTextDelta: string;
};

const ANTHROPIC_PROJECTED_SYSTEM_CONTEXT_PREFIX = "[HOST_CONTEXT_FROM_SYSTEM]";

export class AiSdkAnthropicTransport
  implements LlmTransport<AnthropicTransportConfig, ToolAgentState>, JsonSchemaTransport
{
  async generateImage(
    _config: AnthropicTransportConfig,
    _request: ImageGenerationRequest,
    _saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    throw new Error("Anthropic transport does not support image generation.");
  }

  async generateVideo(
    _config: AnthropicTransportConfig,
    _request: import("../ports.js").VideoGenerationRequest,
    _saveGeneratedVideo: (
      request: import("../ports.js").GeneratedVideoSaveRequest,
    ) => Promise<import("../ports.js").GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    throw new Error("Anthropic transport does not support video generation.");
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: AnthropicTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const messages = buildJsonSchemaCompletionMessages(
      {
        model: config.model,
        ...(config.workspaceRoot ? { workspaceRoot: config.workspaceRoot } : {}),
      },
      request,
    );
    const normalizedMessages = prepareAnthropicToolStateMessages(config, messages);
    await resolveDeclaredVideoInputsInMessages(
      config,
      normalizedMessages,
      anthropicTransportAssetRoot(config),
    );
    const requestTrace = buildAnthropicRequestTrace(config, 1, normalizedMessages, []);

    try {
      const result = await generateObject({
        model: createAnthropicLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(normalizedMessages, config) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildAnthropicProviderOptions(config),
        maxRetries: 2,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderAiSdkError(error), { cause: error });
    }
  }

  async startToolAgentRound(
    config: AnthropicTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedRequestMessages = prepareAnthropicToolStateMessages(config, requestMessages);
    await resolveDeclaredVideoInputsInMessages(
      config,
      normalizedRequestMessages,
      anthropicTransportAssetRoot(config),
    );
    const providerTools = await resolveDeclaredProviderTools(
      config,
      new Set(toolNamesFromDefinitions(tools)),
    );
    const normalizedTools = [...normalizeToolDefinitions(tools), ...providerTools.functionTools];
    const requestTrace = buildAnthropicRequestTrace(
      config,
      nextState.steps,
      normalizedRequestMessages,
      [...normalizedTools, ...providerTools.literalEntries, ...providerTools.traceEntries],
    );

    try {
      const result: any = await generateText({
        model: createAnthropicLanguageModel(config, providerTools),
        messages: toolStateMessagesToAiSdkMessages(normalizedRequestMessages, config) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAnthropicProviderOptions(config),
        maxRetries: 2,
      });

      nextState.messages.push(
        buildAssistantMessageFromGenerateTextResult(
          result.text,
          typeof result.reasoningText === "string" ? result.reasoningText : "",
          result.reasoning,
          result.toolCalls,
        ),
      );

      const usage = await readAiSdkUsage(result);
      const calls = extractToolCallsFromAiSdk(result.toolCalls);
      if (calls.length > 0) {
        return {
          kind: "success",
          result: {
            state: nextState,
            step: { kind: "tool-calls", calls },
            requestTrace,
            ...(usage ? { usage } : {}),
          },
        };
      }

      return {
        kind: "success",
        result: {
          state: nextState,
          step: { kind: "final-response-ready" },
          requestTrace,
          ...(usage ? { usage } : {}),
        },
      };
    } catch (error) {
      return {
        kind: "failure",
        error: renderAiSdkError(error),
        requestTrace,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: AnthropicTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedRequestMessages = prepareAnthropicToolStateMessages(config, requestMessages);
    await resolveDeclaredVideoInputsInMessages(
      config,
      normalizedRequestMessages,
      anthropicTransportAssetRoot(config),
    );
    const providerTools = await resolveDeclaredProviderTools(
      config,
      new Set(toolNamesFromDefinitions(tools)),
    );
    const normalizedTools = [...normalizeToolDefinitions(tools), ...providerTools.functionTools];
    // Declared in-band server tools (entries without `execute`): their literal entries ride the
    // request tools[] and their calls/results arrive as server-tool content blocks in the stream.
    const serverToolNames = new Set(
      [...providerTools.recognizedNames].filter((name) => !providerTools.executions.has(name)),
    );
    const serverToolsEnabled = serverToolNames.size > 0;
    const traceTools = [
      ...normalizedTools,
      ...providerTools.literalEntries,
      ...providerTools.traceEntries,
    ];
    const requestTrace = buildAnthropicRequestTrace(
      config,
      nextState.steps,
      normalizedRequestMessages,
      traceTools,
      true,
    );
    const abortController = new AbortController();

    try {
      const result: any = streamText({
        model: createAnthropicLanguageModel(config, providerTools),
        messages: toolStateMessagesToAiSdkMessages(normalizedRequestMessages, config) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: "auto" as const,
            }),
        providerOptions: buildAnthropicProviderOptions(config),
        ...(serverToolsEnabled ? { include: { rawChunks: true } } : {}),
        maxRetries: 2,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      return {
        eventStream: anthropicEventStreamToRuntimeEvents(
          config,
          result.stream,
          result,
          nextState,
          requestTrace,
          completion,
          serverToolNames,
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyEventStream(),
        completion: Promise.resolve({
          kind: "failure",
          error: renderAiSdkError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: AnthropicTransportConfig,
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

    const promptMessages = toolStateMessagesToAiSdkMessages(
      llmHistoryToOpenAiMessages(
        buildCompactHistoryPromptMessages(
          history,
          context?.transcriptDirPath === undefined
            ? {}
            : { transcriptDirPath: context.transcriptDirPath },
        ),
        anthropicTransportAssetRoot(config),
      ),
      config,
    );
    const compactConfig: AnthropicTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = "";
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createAnthropicLanguageModel(compactConfig),
          messages: promptMessages as any,
          allowSystemInMessages: true,
          ...(compactConfig.outputLimit !== undefined
            ? { maxOutputTokens: compactConfig.outputLimit }
            : {}),
          providerOptions: buildAnthropicProviderOptions(compactConfig),
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
        model: createAnthropicLanguageModel(compactConfig),
        messages: promptMessages as any,
        allowSystemInMessages: true,
        ...(compactConfig.outputLimit !== undefined
          ? { maxOutputTokens: compactConfig.outputLimit }
          : {}),
        providerOptions: buildAnthropicProviderOptions(compactConfig),
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
      droppedMessages: Math.max(0, beforeLength - 1),
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
    return normalizeMessagesForAnthropicPrompt(llmHistoryToToolStateMessages(history));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt("—", undefined),
    };
  }
}

/**
 * Adapter dispatch on the declared `sdk`: `@ai-sdk/minimax` uses the MiniMax Messages adapter,
 * anything else defaults to the official Anthropic adapter.
 */
/**
 * Adapter dispatch on the declared `sdk`: `@ai-sdk/minimax` uses the MiniMax Messages adapter,
 * anything else defaults to the official Anthropic adapter.
 */
function createAnthropicLanguageModel(
  config: AnthropicTransportConfig,
  providerTools: Pick<
    ResolvedProviderTools,
    "literalEntries" | "bodyPatches"
  > = EMPTY_RESOLVED_PROVIDER_TOOLS,
): any {
  // Declared provider tool literals/entry bodies merge innermost; the declared wire merge
  // (provider-level headers/body, thinkingSwitch, serviceTier) wraps it so declarations win.
  const fetch = createDeclaredWireMergeFetch(
    config,
    "messages",
    createProviderToolsWireFetch(providerTools, getLlmFetch()),
  );

  if (config.sdk === "@ai-sdk/minimax") {
    return createMiniMax({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      fetch,
    }).chat(config.model);
  }

  return createAnthropic({
    apiKey: config.apiKey,
    // The adapter's own default applies when unset; config apiBase is always materialized.
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch,
  }).chat(config.model);
}

function normalizeToolDefinitions(tools: JsonValue): OpenAiStyleFunctionToolDefinition[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isFunctionToolDefinition)
    .map((toolDefinition) => cloneJsonValue(toolDefinition) as OpenAiStyleFunctionToolDefinition);
}

function buildAiSdkTools(
  normalizedTools: OpenAiStyleFunctionToolDefinition[],
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

function toolStateMessagesToAiSdkMessages(
  messages: JsonValue[],
  config: AnthropicTransportConfig,
): Array<Record<string, unknown>> {
  const toolCallNames = buildToolCallNameIndex(messages);

  return messages.flatMap((message) => {
    if (!isJsonObject(message) || typeof message.role !== "string") {
      return [];
    }

    switch (message.role) {
      case "system":
        return typeof message.content === "string"
          ? [{ role: "system", content: message.content }]
          : [];
      case "user": {
        const content = userContentToAiSdkContent(message.content, config);
        return content === undefined ? [] : [{ role: "user", content }];
      }
      case "assistant": {
        const assistantMessage = assistantMessageToAiSdkMessage(message);
        return assistantMessage === undefined ? [] : [assistantMessage];
      }
      case "tool": {
        const toolMessage = toolMessageToAiSdkMessage(message, toolCallNames);
        return toolMessage === undefined ? [] : [toolMessage];
      }
      default:
        return [];
    }
  });
}

function prepareAnthropicToolStateMessages(
  config: AnthropicTransportConfig,
  messages: JsonValue[],
): JsonValue[] {
  return stripAnthropicUserMediaWithoutCapability(
    normalizeMessagesForAnthropicPrompt(messages),
    config,
  );
}

function anthropicTransportAssetRoot(
  config: Pick<AnthropicTransportConfig, "workspaceRoot">,
): string {
  return config.workspaceRoot ?? process.cwd();
}

function stripAnthropicUserMediaWithoutCapability(
  messages: JsonValue[],
  config: Pick<AnthropicTransportConfig, "modelCapabilities">,
): JsonValue[] {
  if (config.modelCapabilities === undefined) {
    return messages;
  }

  const capabilities = config.modelCapabilities;
  return messages.map((message) => sanitizeAnthropicMessageForCompatibility(message, capabilities));
}

function sanitizeAnthropicMessageForCompatibility(
  message: JsonValue,
  capabilities: LlmModelCapabilities,
): JsonValue {
  const cloned = cloneJsonValue(message);
  if (!isJsonObject(cloned) || cloned.role !== "user" || !Array.isArray(cloned.content)) {
    return cloned;
  }

  let content = cloned.content;
  if (!capabilities.imageInput) {
    content = content.filter((part) => !(isJsonObject(part) && part.type === "image_url"));
  }
  if (!capabilities.videoInput) {
    content = content.filter((part) => !(isJsonObject(part) && part.type === "video_url"));
  }

  if (content !== cloned.content) {
    const textParts = content.filter(
      (part) => isJsonObject(part) && part.type === "text" && typeof part.text === "string",
    );
    return {
      ...cloned,
      content: textParts.length > 0 ? textParts : "",
    };
  }

  return cloned;
}

function normalizeMessagesForAnthropicPrompt(messages: JsonValue[]): JsonValue[] {
  const normalizedMessages: JsonValue[] = [];
  let sawNonSystemMessage = false;

  for (const message of messages) {
    if (!isJsonObject(message) || typeof message.role !== "string") {
      continue;
    }

    if (message.role === "system") {
      if (!sawNonSystemMessage) {
        normalizedMessages.push(cloneJsonValue(message));
      } else {
        const projected = projectSeparatedSystemMessageForAnthropic(message);
        if (projected !== undefined) {
          normalizedMessages.push(projected);
        }
      }
      continue;
    }

    sawNonSystemMessage = true;
    normalizedMessages.push(cloneJsonValue(message));
  }

  return normalizedMessages;
}

function projectSeparatedSystemMessageForAnthropic(message: JsonObject): JsonValue | undefined {
  if (typeof message.content !== "string" || message.content.trim().length === 0) {
    return undefined;
  }

  return {
    role: "user",
    content: [
      ANTHROPIC_PROJECTED_SYSTEM_CONTEXT_PREFIX,
      "The host is providing additional context that was originally stored as a system message after the conversation had already started.",
      "Treat it as reference context for continuity, not as a new user request.",
      "",
      message.content,
    ].join("\n"),
  } satisfies JsonObject;
}

/**
 * The `@ai-sdk/minimax` Messages adapter expects raw Anthropic content blocks for media (its
 * file-part conversion does not cover them); the official `@ai-sdk/anthropic` adapter takes AI SDK
 * file parts. Keyed on the declared `sdk`, never on endpoint identity.
 */
function usesRawAnthropicMediaBlocks(config: Pick<AnthropicTransportConfig, "sdk">): boolean {
  return config.sdk === "@ai-sdk/minimax";
}

function parseDataUrlToAnthropicImageSource(
  value: string,
): { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } | undefined {
  const trimmed = value.trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const mediaType = match[1]?.trim();
  const data = match[2]?.trim();
  if (!mediaType || !data) {
    return undefined;
  }

  return {
    type: "base64",
    media_type: mediaType,
    data,
  };
}

function mapAnthropicImageContentPart(imageUrl: string): Record<string, unknown> {
  const trimmed = imageUrl.trim();
  const source = parseDataUrlToAnthropicImageSource(trimmed) ?? {
    type: "url" as const,
    url: trimmed,
  };
  return {
    type: "image",
    source,
  };
}

function mapAnthropicVideoContentPart(videoUrl: string): Record<string, unknown> {
  return {
    type: "video",
    source: {
      type: "url",
      url: videoUrl.trim(),
    },
  };
}

function userContentToAiSdkContent(
  content: JsonValue | undefined,
  config: AnthropicTransportConfig,
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
          if (usesRawAnthropicMediaBlocks(config)) {
            parts.push(mapAnthropicImageContentPart(part.image_url.url));
          } else {
            parts.push(buildAiSdkUserImageFilePartFromUrl(part.image_url.url));
          }
        }
        break;
      case "video_url":
        if (isJsonObject(part.video_url) && typeof part.video_url.url === "string") {
          if (usesRawAnthropicMediaBlocks(config)) {
            parts.push(mapAnthropicVideoContentPart(part.video_url.url));
          }
        }
        break;
      default:
        break;
    }
  }

  return parts.length > 0 ? parts : undefined;
}

function assistantMessageToAiSdkMessage(message: JsonObject): Record<string, unknown> | undefined {
  const anthropicBlocks = readAnthropicAssistantContentBlocks(message);
  if (anthropicBlocks) {
    const replayText = resolveAnthropicServerToolAssistantReplayText(message, anthropicBlocks);
    if (replayText.length > 0) {
      const reasoningParts = extractStoredAnthropicReasoningParts(message);
      const reasoningText = extractAssistantReasoningContentFromJson(message);
      if (reasoningParts.length > 0 || reasoningText.length > 0) {
        const contentParts: Array<Record<string, unknown>> = [];
        if (reasoningParts.length > 0) {
          contentParts.push(...reasoningParts);
        } else {
          contentParts.push({ type: "reasoning", text: reasoningText });
        }
        contentParts.push({ type: "text", text: replayText });
        return {
          role: "assistant",
          content: contentParts,
        };
      }

      return {
        role: "assistant",
        content: replayText,
      };
    }
  }

  const reasoningParts = extractStoredAnthropicReasoningParts(message);
  const reasoningText = extractAssistantReasoningContentFromJson(message);
  const toolCallParts = extractAssistantToolCallParts(message);
  const contentParts: Array<Record<string, unknown>> = [];

  if (reasoningParts.length > 0) {
    contentParts.push(...reasoningParts);
  } else if (reasoningText) {
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

function toolMessageToAiSdkMessage(
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
  text: string,
  reasoningText: string,
  reasoning: unknown,
  toolCalls: readonly AnthropicToolCall[],
): JsonValue {
  return withReasoningContentIfNeeded(
    withStoredAnthropicReasoningPartsIfNeeded(
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
      normalizeAiSdkReasoningParts(reasoning),
    ),
    reasoningText,
  );
}

async function* anthropicEventStreamToRuntimeEvents(
  config: AnthropicTransportConfig,
  stream: AsyncIterable<TextStreamPart<any>>,
  result: Parameters<typeof readAiSdkUsage>[0] & {
    reasoning?: PromiseLike<unknown>;
  },
  nextState: ToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<ToolAgentState>>,
  serverToolNames: ReadonlySet<string>,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const serverToolState =
    serverToolNames.size > 0 ? createAnthropicServerToolStreamState(serverToolNames) : undefined;
  const toolCalls = new Map<string, StreamingToolCallAccumulator>();
  const toolCallOrder: string[] = [];
  let assistantContent = "";
  let reasoningContent = "";
  let sawAnswerOrToolOutput = false;

  try {
    for await (const part of stream) {
      if (serverToolState) {
        const serverToolEvents: LlmStreamEvent[] = [];
        const serverToolResult = handleAnthropicServerToolStreamPart(
          part,
          serverToolState,
          serverToolEvents,
        );
        for (const event of serverToolEvents) {
          yield event;
        }
        if (serverToolResult.sawAnswerOrToolOutput) {
          sawAnswerOrToolOutput = true;
        }
        if (
          part.type === "error" &&
          shouldSuppressAnthropicServerToolStreamError(
            (part as { error?: unknown }).error,
            serverToolState,
          )
        ) {
          continue;
        }
        if (serverToolResult.handled) {
          continue;
        }
      }

      const rawType = (part as { type?: unknown }).type;

      if (rawType === "tool-call-streaming-start") {
        const streamingStart = part as unknown as AnthropicToolCallStreamingStartPart;
        if (serverToolState?.serverToolNames.has(streamingStart.toolName)) {
          continue;
        }
        sawAnswerOrToolOutput = true;
        if (!toolCalls.has(streamingStart.toolCallId)) {
          toolCalls.set(streamingStart.toolCallId, {
            toolCallId: streamingStart.toolCallId,
            toolName: streamingStart.toolName,
            argumentsJson: "",
            readyPreviewEmitted: false,
          });
          toolCallOrder.push(streamingStart.toolCallId);
        }
        continue;
      }

      if (rawType === "tool-call-delta") {
        const toolCallDelta = part as unknown as AnthropicToolCallDeltaPart;
        if (serverToolState?.serverToolNames.has(toolCallDelta.toolName)) {
          continue;
        }
        sawAnswerOrToolOutput = true;
        const current = toolCalls.get(toolCallDelta.toolCallId) ?? {
          toolCallId: toolCallDelta.toolCallId,
          toolName: toolCallDelta.toolName,
          argumentsJson: "",
          readyPreviewEmitted: false,
        };
        current.argumentsJson += toolCallDelta.argsTextDelta;
        const previewState = {
          readyPreviewEmitted: current.readyPreviewEmitted,
          ...(current.lastPreviewArgsLen === undefined
            ? {}
            : { lastPreviewArgsLen: current.lastPreviewArgsLen }),
          ...(current.lastPreviewDetailSignature === undefined
            ? {}
            : { lastPreviewDetailSignature: current.lastPreviewDetailSignature }),
        };
        const previewDecision = resolveStreamingToolPreviewEmit(
          current.toolName,
          current.argumentsJson,
          previewState,
        );
        if (previewDecision.emit) {
          current.readyPreviewEmitted = previewDecision.nextState.readyPreviewEmitted;
          if (previewDecision.nextState.lastPreviewArgsLen !== undefined) {
            current.lastPreviewArgsLen = previewDecision.nextState.lastPreviewArgsLen;
          }
          if (previewDecision.nextState.lastPreviewDetailSignature !== undefined) {
            current.lastPreviewDetailSignature =
              previewDecision.nextState.lastPreviewDetailSignature;
          }
          yield {
            kind: "streaming-tool-preview",
            toolCallId: current.toolCallId,
            toolName: current.toolName,
            argumentsJson: current.argumentsJson,
          };
        }
        toolCalls.set(toolCallDelta.toolCallId, current);
        if (!toolCallOrder.includes(toolCallDelta.toolCallId)) {
          toolCallOrder.push(toolCallDelta.toolCallId);
        }
        continue;
      }

      switch (part.type) {
        case "reasoning-delta":
          reasoningContent += part.text;
          if (part.text.length > 0) {
            yield { kind: "thinking-chunk", text: part.text };
          }
          break;
        case "text-delta": {
          const normalizedText = trimLeadingStreamLineBreaks(assistantContent, part.text);
          if (!normalizedText) {
            break;
          }
          sawAnswerOrToolOutput = true;
          assistantContent += normalizedText;
          if (serverToolState) {
            appendStreamingTextAnthropicBlock(serverToolState, normalizedText);
          }
          yield { kind: "assistant-chunk", text: normalizedText };
          break;
        }
        case "tool-call": {
          if (serverToolState?.serverToolNames.has(part.toolName)) {
            sawAnswerOrToolOutput = true;
            break;
          }
          sawAnswerOrToolOutput = true;
          const argumentsJson = JSON.stringify(part.input);
          const current = toolCalls.get(part.toolCallId) ?? {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            argumentsJson,
            readyPreviewEmitted: false,
          };
          current.toolName = part.toolName;
          current.argumentsJson = argumentsJson;
          if (toolArgumentsReadyForStreamingPreview(current.toolName, current.argumentsJson)) {
            yield {
              kind: "streaming-tool-preview",
              toolCallId: current.toolCallId,
              toolName: current.toolName,
              argumentsJson: current.argumentsJson,
            };
          }
          toolCalls.set(part.toolCallId, current);
          if (!toolCallOrder.includes(part.toolCallId)) {
            toolCallOrder.push(part.toolCallId);
          }
          break;
        }
        case "error":
          throw part.error;
        default:
          break;
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      throw new Error("Streaming response had no deltas (no text / thinking / tool calls).");
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(
        assistantContent,
        reasoningContent,
        await result.reasoning,
        toolCalls,
        toolCallOrder,
        serverToolState,
      ),
    );

    const calls = serverToolState
      ? filterAnthropicServerToolCalls(
          extractToolCallsFromStreamingMap(toolCalls, toolCallOrder),
          serverToolState,
        )
      : extractToolCallsFromStreamingMap(toolCalls, toolCallOrder);
    const usage = await readAiSdkUsage(result);
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
    const rendered = renderAiSdkError(error);
    completion.resolve({
      kind: "failure",
      error: rendered,
      requestTrace,
    });
    yield { kind: "error", error: rendered };
  }
}

function toolArgumentsReadyForStreamingPreview(name: string, argumentsJson: string): boolean {
  if (name === "finish_task") {
    return finishTaskStreamingPreviewReady(name, argumentsJson);
  }
  return (
    hostToolArgumentsReadyForEarlyStreamingPreview(name, argumentsJson) ||
    hostToolArgumentsReadyForPreview(name, argumentsJson)
  );
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  reasoning: unknown,
  toolCalls: Map<string, StreamingToolCallAccumulator>,
  order: readonly string[],
  serverToolState?: AnthropicServerToolStreamState,
): JsonValue {
  const functionToolCalls = order
    .map((toolCallId) => toolCalls.get(toolCallId))
    .filter((call): call is StreamingToolCallAccumulator => call !== undefined)
    .filter(
      (call) =>
        !(
          serverToolState?.executedProviderBuiltinToolCallIds.has(call.toolCallId) &&
          serverToolState.serverToolNames.has(call.toolName)
        ),
    )
    .map((call) => ({
      id: call.toolCallId,
      type: "function",
      function: {
        name: call.toolName,
        arguments: call.argumentsJson,
      },
    }));

  return withReasoningContentIfNeeded(
    withStoredAnthropicReasoningPartsIfNeeded(
      {
        role: "assistant",
        content: assistantContent || null,
        ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
        ...(serverToolState
          ? buildAnthropicServerToolAssistantMessageFields(serverToolState, assistantContent)
          : {}),
      },
      normalizeAiSdkReasoningParts(reasoning),
    ),
    reasoningContent,
  );
}

function extractToolCallsFromStreamingMap(
  toolCalls: Map<string, StreamingToolCallAccumulator>,
  order: readonly string[],
): ToolCallRequest[] {
  return order
    .map((toolCallId) => toolCalls.get(toolCallId))
    .filter((call): call is StreamingToolCallAccumulator => call !== undefined)
    .filter((call) => call.toolName.trim().length > 0)
    .map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      argumentsJson: call.argumentsJson,
    }));
}

function extractToolCallsFromAiSdk(toolCalls: readonly AnthropicToolCall[]): ToolCallRequest[] {
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

function withStoredAnthropicReasoningPartsIfNeeded(
  message: JsonObject,
  reasoningParts: readonly JsonValue[],
): JsonObject {
  if (
    reasoningParts.length === 0 ||
    Array.isArray(message.reasoning_parts) ||
    Array.isArray(message.reasoningParts)
  ) {
    return message;
  }

  return {
    ...message,
    reasoning_parts: reasoningParts.map((part) => cloneJsonValue(part)),
  };
}

function messageContentHasEmbeddedThinking(message: JsonObject): boolean {
  if (typeof message.content !== "string") {
    return false;
  }

  const trimmed = message.content.trimStart();
  return trimmed.startsWith("<think>") && trimmed.includes("</think>");
}

function extractAssistantReasoningContentFromJson(message: JsonObject): string {
  const storedReasoning = [
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("");

  if (storedReasoning.length > 0) {
    return storedReasoning;
  }

  return extractStoredAnthropicReasoningParts(message)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((value) => value.length > 0)
    .join("");
}

function normalizeAiSdkReasoningParts(reasoning: unknown): JsonValue[] {
  if (!Array.isArray(reasoning)) {
    return [];
  }

  return reasoning.flatMap((part) => {
    if (!isJsonObject(part) || part.type !== "reasoning") {
      return [];
    }

    const text = typeof part.text === "string" ? part.text : "";
    const providerOptions = normalizeAnthropicReasoningProviderOptions(part.providerMetadata);
    if (text.length === 0 && providerOptions === undefined) {
      return [];
    }

    return [
      {
        type: "reasoning",
        text,
        ...(providerOptions === undefined ? {} : { providerOptions }),
      } satisfies JsonObject,
    ];
  });
}

function extractStoredAnthropicReasoningParts(message: JsonObject): Array<Record<string, unknown>> {
  const storedParts = Array.isArray(message.reasoning_parts)
    ? message.reasoning_parts
    : Array.isArray(message.reasoningParts)
      ? message.reasoningParts
      : [];

  return storedParts.flatMap((part) => {
    if (!isJsonObject(part) || part.type !== "reasoning") {
      return [];
    }

    const text = typeof part.text === "string" ? part.text : "";
    const providerOptions = normalizeAnthropicReasoningProviderOptions(
      part.providerOptions ??
        part.provider_options ??
        part.providerMetadata ??
        part.provider_metadata,
    );
    if (text.length === 0 && providerOptions === undefined) {
      return [];
    }

    return [
      {
        type: "reasoning",
        text,
        ...(providerOptions === undefined ? {} : { providerOptions }),
      },
    ];
  });
}

function normalizeAnthropicReasoningProviderOptions(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value as JsonValue | undefined)) {
    return undefined;
  }

  const metadata = value as JsonObject;
  const anthropic = metadata.anthropic;
  if (!isJsonObject(anthropic as JsonValue | undefined)) {
    return undefined;
  }
  const anthropicMetadataValue = anthropic as JsonObject;

  const anthropicMetadata: JsonObject = {};
  if (
    typeof anthropicMetadataValue.signature === "string" &&
    anthropicMetadataValue.signature.length > 0
  ) {
    anthropicMetadata.signature = anthropicMetadataValue.signature;
  }
  if (
    typeof anthropicMetadataValue.redactedData === "string" &&
    anthropicMetadataValue.redactedData.length > 0
  ) {
    anthropicMetadata.redactedData = anthropicMetadataValue.redactedData;
  }

  if (Object.keys(anthropicMetadata).length === 0) {
    return undefined;
  }

  return {
    anthropic: anthropicMetadata,
  };
}

function llmHistoryToToolStateMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonValue[] {
  return history.map((message) => llmMessageToToolStateMessage(message, assetRoot));
}

function llmMessageToToolStateMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (
    message.role === "assistant" &&
    Array.isArray(message.toolCalls) &&
    message.toolCalls.length > 0
  ) {
    return {
      ...llmMessageProviderState(message),
      role: "assistant",
      content: llmMessageTextContent(message.content),
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
    };
  }

  if (message.role === "user" && llmMessageHasMedia(message.content)) {
    const parts: JsonValue[] = [];

    for (const part of message.content) {
      if (part.type === "text" && part.text.length > 0) {
        parts.push({ type: "text", text: part.text });
        continue;
      }

      if (part.type === "image") {
        parts.push({
          type: "image_url",
          image_url: {
            url: pathToImageUrl(part.path, assetRoot),
          },
        });
        continue;
      }

      if (part.type === "video") {
        parts.push({
          type: "video_url",
          video_url: {
            url: pathToLocalVideoReference(part.path, assetRoot),
          },
        });
      }
    }

    if (parts.length === 0) {
      return { role: message.role, content: "" };
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  return {
    ...llmMessageProviderState(message),
    role: message.role,
    content: llmMessageTextContent(message.content),
    ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
  };
}

function llmMessageProviderState(message: LlmMessage): JsonObject {
  if (message.providerState === undefined) {
    return {};
  }

  return cloneJsonValue(message.providerState) as JsonObject;
}

function pathToImageUrl(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("file://")
  ) {
    return normalized;
  }

  const absolutePath = isAbsolute(normalized) ? normalized : resolve(assetRoot, normalized);
  const mime = guessImageMimeFromPath(absolutePath);

  try {
    const bytes = readFileSync(absolutePath);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return toFileUrl(absolutePath);
  }
}

function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function guessImageMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

function renderAiSdkError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function isFunctionToolDefinition(value: JsonValue): value is OpenAiStyleFunctionToolDefinition {
  return isJsonObject(value) && value.type === "function" && isJsonObject(value.function);
}

function hasNonEmptyToolCallId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonEmptyToolCallIdOrUndefined(value: unknown): string | undefined {
  return hasNonEmptyToolCallId(value) ? value : undefined;
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

async function* emptyEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}

/** @internal Exported for unit tests only. */
export const convertAnthropicToolStateMessagesForTests = toolStateMessagesToAiSdkMessages;
