import { generateObject, generateText, jsonSchema, streamText } from "ai";

import { readAiSdkUsage } from "../ai-sdk-usage.js";

import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ImageGenerationRequest,
  JsonObject,
  JsonValue,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from "../ports.js";
import type {
  JsonSchemaCompletionRequest,
  JsonSchemaCompletionResult,
  JsonSchemaTransport,
} from "../json-schema.js";
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
} from "../openai/json-schema.js";
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
import {
  buildAssistantMessageFromResponsesGenerateText,
  extractToolCallsFromAiSdk,
  normalizeResponsesToolDefinitions,
  openAiMessagesToResponsesAiSdkMessages,
  renderResponsesTransportError,
} from "./ai-sdk-message-bridge.js";
import {
  buildProviderToolStopWhen,
  collectExecutedProviderBuiltinToolCallIdsFromSteps,
  filterPendingHostToolCalls,
} from "./provider-builtin-tool-round.js";
import {
  appendApplyPatchToolCallsToAssistantMessage,
  beginApplyPatchBridgeRound,
  buildResponsesTraceTools,
  endApplyPatchBridgeRound,
  mergeToolCallsWithApplyPatch,
  registerPendingApplyPatchCallIds,
  runWithApplyPatchBridgeContext,
  takeLastExtractedApplyPatchCalls,
} from "./apply-patch-bridge.js";
import { shouldUseOpenAiSdkApplyPatchTool } from "./apply-patch-eligibility.js";
import { isResponsesBuiltInToolName } from "./responses-built-in-tools.js";
import {
  buildResponsesGenerateTools,
  buildResponsesProviderOptionsWithServiceTier,
  createResponsesLanguageModel,
} from "./model-factory.js";
import {
  attachResponseIdToAssistantMessage,
  extractResponseIdFromGenerateTextResult,
} from "./provider-state.js";
import {
  buildResponsesRoundInput,
  bindResponsesStoredStateRequestContextAsyncIterable,
  runInResponsesStoredStateRequestContextSync,
  runWithResponsesStoredStateRequestContext,
} from "./responses-incremental-input.js";
import {
  bindEchoServerToolCallsContextIfNeeded,
  withEchoServerToolCallsContext,
} from "./echo-server-tool-calls.js";
import {
  buildOpenResponsesRequestTrace,
  buildOpenResponsesTraceExtras,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";
import {
  xaiResponsesLocalToolsUnsupportedMessage,
  xaiResponsesRejectsLocalFunctionTools,
} from "./xai-responses-pre-guard.js";
import { resolveDeclaredProviderTools } from "../provider-tools/runtime.js";
import { toolNamesFromDefinitions } from "../unknown-tool-error.js";
import { createDeferred, responsesEventStreamToRuntimeEvents } from "./streaming.js";
import { generateVideoWithRouter } from "../video-generation/router.js";
import { AiSdkOpenAiCompatibleTransport } from "../openai/ai-sdk-transport.js";

const openAiCompatibleImageTransport = new AiSdkOpenAiCompatibleTransport();

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}

function trimLeadingStreamLineBreaks(existingText: string, nextText: string): string {
  if (existingText.length > 0) {
    return nextText;
  }

  return nextText.replace(/^[\r\n]+/u, "");
}

export class AiSdkOpenResponsesTransport
  implements LlmTransport<OpenResponsesTransportConfig, ToolAgentState>, JsonSchemaTransport
{
  async generateImage(
    config: OpenResponsesTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    const imageConfig = config.imageGeneration;
    if (!imageConfig) {
      throw new Error("No image generation model is configured.");
    }

    return openAiCompatibleImageTransport.generateImage(
      {
        transportKind: "openai-compatible",
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl ?? "",
        imageGeneration: imageConfig,
        ...(config.workspaceRoot ? { workspaceRoot: config.workspaceRoot } : {}),
      },
      request,
      saveGeneratedImage,
    );
  }

  async generateVideo(
    config: OpenResponsesTransportConfig,
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
    config: OpenResponsesTransportConfig,
    request: JsonSchemaCompletionRequest,
  ): Promise<JsonSchemaCompletionResult<T>> {
    const messages = buildJsonSchemaCompletionMessages(
      {
        model: config.model,
        ...(config.workspaceRoot ? { workspaceRoot: config.workspaceRoot } : {}),
      },
      request,
    );
    const requestTrace = buildOpenResponsesRequestTrace(config, 1, messages, []);

    try {
      const result = await generateObject({
        model: createResponsesLanguageModel(config) as any,
        messages: openAiMessagesToResponsesAiSdkMessages(messages) as any,
        allowSystemInMessages: true,
        ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildResponsesProviderOptionsWithServiceTier(config),
        maxRetries: 2,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderResponsesTransportError(error), { cause: error });
    }
  }

  async startToolAgentRound(
    config: OpenResponsesTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeResponsesToolDefinitions(tools);
    const providerTools = await resolveDeclaredProviderTools(
      config,
      new Set(toolNamesFromDefinitions(tools)),
    );
    const roundInput = buildResponsesRoundInput(requestMessages, config, nextState.steps);
    const traceExtras = buildOpenResponsesTraceExtras(config, roundInput.previousResponseId);
    const tracedRequest = buildOpenResponsesRequestTrace(
      config,
      nextState.steps,
      roundInput.apiMessages,
      buildResponsesTraceTools(config, normalizedTools, providerTools),
      false,
      traceExtras,
    );

    if (xaiResponsesRejectsLocalFunctionTools(config, normalizedTools.length, providerTools)) {
      return {
        kind: "failure",
        error: xaiResponsesLocalToolsUnsupportedMessage(),
        requestTrace: tracedRequest,
      };
    }

    try {
      return await runWithResponsesStoredStateRequestContext(roundInput.previousResponseId, () =>
        withEchoServerToolCallsContext(config, roundInput.apiMessages, () =>
          runWithApplyPatchBridgeContext(async () => {
            const generateTools = buildResponsesGenerateTools(
              config,
              normalizedTools,
              providerTools,
            );
            const hasGenerateTools = Object.keys(generateTools).length > 0;
            const providerToolStopWhen = buildProviderToolStopWhen(config);
            const result = await generateText({
              model: createResponsesLanguageModel(config, providerTools) as any,
              messages: openAiMessagesToResponsesAiSdkMessages(
                roundInput.apiMessages,
                config,
              ) as any,
              allowSystemInMessages: true,
              ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
              ...(hasGenerateTools
                ? {
                    tools: generateTools as any,
                    toolChoice: "auto" as const,
                  }
                : {}),
              ...(providerToolStopWhen ? { stopWhen: providerToolStopWhen } : {}),
              providerOptions: buildResponsesProviderOptionsWithServiceTier(
                config,
                roundInput.previousResponseId,
              ),
              maxRetries: 2,
            });

            const applyPatchCalls = shouldUseOpenAiSdkApplyPatchTool(config)
              ? []
              : takeLastExtractedApplyPatchCalls();
            const executedProviderBuiltinToolCallIds =
              collectExecutedProviderBuiltinToolCallIdsFromSteps(result.steps);
            const pendingAssistantToolCalls = result.toolCalls.filter(
              (toolCall) =>
                !(
                  isResponsesBuiltInToolName(toolCall.toolName) &&
                  executedProviderBuiltinToolCallIds.has(toolCall.toolCallId)
                ),
            );
            const assistantMessage = attachResponseIdToAssistantMessage(
              config,
              buildAssistantMessageFromResponsesGenerateText(
                result.text,
                pendingAssistantToolCalls,
                result.reasoningText ?? "",
              ),
              extractResponseIdFromGenerateTextResult(result),
            );
            if (applyPatchCalls.length > 0 && isJsonObject(assistantMessage as JsonValue)) {
              appendApplyPatchToolCallsToAssistantMessage(
                assistantMessage as JsonObject,
                applyPatchCalls,
              );
            }
            nextState.messages.push(assistantMessage);

            if (applyPatchCalls.length > 0) {
              registerPendingApplyPatchCallIds(applyPatchCalls.map((call) => call.id));
            }
            const usage = await readAiSdkUsage(result);
            const calls = mergeToolCallsWithApplyPatch(
              filterPendingHostToolCalls(
                extractToolCallsFromAiSdk(pendingAssistantToolCalls),
                executedProviderBuiltinToolCallIds,
              ),
              applyPatchCalls,
            );
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
              } as ToolAgentRoundCompletion<ToolAgentState>;
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
            } as ToolAgentRoundCompletion<ToolAgentState>;
          }),
        ),
      );
    } catch (error) {
      return {
        kind: "failure",
        error: renderResponsesTransportError(error),
        requestTrace: tracedRequest,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenResponsesTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeResponsesToolDefinitions(tools);
    const providerTools = await resolveDeclaredProviderTools(
      config,
      new Set(toolNamesFromDefinitions(tools)),
    );
    const roundInput = buildResponsesRoundInput(requestMessages, config, nextState.steps);
    const traceExtras = buildOpenResponsesTraceExtras(config, roundInput.previousResponseId);
    const requestTrace = buildOpenResponsesRequestTrace(
      config,
      nextState.steps,
      roundInput.apiMessages,
      buildResponsesTraceTools(config, normalizedTools, providerTools),
      true,
      traceExtras,
    );

    const abortController = new AbortController();

    if (xaiResponsesRejectsLocalFunctionTools(config, normalizedTools.length, providerTools)) {
      return {
        eventStream: emptyResponsesEventStream(),
        completion: Promise.resolve({
          kind: "failure",
          error: xaiResponsesLocalToolsUnsupportedMessage(),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }

    try {
      beginApplyPatchBridgeRound();
      const generateTools = buildResponsesGenerateTools(config, normalizedTools, providerTools);
      const hasGenerateTools = Object.keys(generateTools).length > 0;
      const providerOptions = buildResponsesProviderOptionsWithServiceTier(
        config,
        roundInput.previousResponseId,
      );
      const sdkMessages = openAiMessagesToResponsesAiSdkMessages(roundInput.apiMessages, config);
      const providerToolStopWhen = buildProviderToolStopWhen(config);
      const result: { stream: AsyncIterable<unknown> } & Parameters<typeof readAiSdkUsage>[0] =
        runInResponsesStoredStateRequestContextSync(roundInput.previousResponseId, () =>
          withEchoServerToolCallsContext(config, roundInput.apiMessages, () =>
            streamText({
              model: createResponsesLanguageModel(config, providerTools) as any,
              messages: sdkMessages as any,
              allowSystemInMessages: true,
              ...(config.outputLimit !== undefined ? { maxOutputTokens: config.outputLimit } : {}),
              ...(hasGenerateTools
                ? {
                    tools: generateTools as any,
                    toolChoice: "auto" as const,
                  }
                : {}),
              ...(providerToolStopWhen ? { stopWhen: providerToolStopWhen } : {}),
              providerOptions,
              include: { rawChunks: true },
              maxRetries: 2,
              abortSignal: abortController.signal,
            }),
          ),
        );
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
      void completion.promise.finally(() => {
        endApplyPatchBridgeRound();
      });

      return {
        eventStream: responsesEventStreamToRuntimeEvents(
          config,
          bindEchoServerToolCallsContextIfNeeded(
            config,
            roundInput.apiMessages,
            bindResponsesStoredStateRequestContextAsyncIterable(
              roundInput.previousResponseId,
              result.stream as any,
            ),
          ),
          result,
          nextState,
          requestTrace,
          completion,
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      endApplyPatchBridgeRound();
      return {
        eventStream: emptyResponsesEventStream(),
        completion: Promise.resolve({
          kind: "failure",
          error: renderResponsesTransportError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: OpenResponsesTransportConfig,
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

    const promptMessages = openAiMessagesToResponsesAiSdkMessages(
      llmHistoryToOpenAiMessages(
        buildCompactHistoryPromptMessages(
          history,
          context?.transcriptDirPath === undefined
            ? {}
            : { transcriptDirPath: context.transcriptDirPath },
        ),
        config.workspaceRoot ?? process.cwd(),
      ),
    );
    const compactConfig: OpenResponsesTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = "";
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createResponsesLanguageModel(compactConfig) as any,
          messages: promptMessages as any,
          allowSystemInMessages: true,
          ...(compactConfig.outputLimit !== undefined
            ? { maxOutputTokens: compactConfig.outputLimit }
            : {}),
          providerOptions: buildResponsesProviderOptionsWithServiceTier(compactConfig),
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
        model: createResponsesLanguageModel(compactConfig) as any,
        messages: promptMessages as any,
        allowSystemInMessages: true,
        ...(compactConfig.outputLimit !== undefined
          ? { maxOutputTokens: compactConfig.outputLimit }
          : {}),
        providerOptions: buildResponsesProviderOptionsWithServiceTier(compactConfig),
        maxRetries: 2,
      });
      summary = result.text;
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error(
        "Open Responses compaction returned empty output; unable to generate a summary.",
      );
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
        entry.content.some(
          (part) => part.type === "text" && includesCompactSummaryBlock(part.text),
        ),
    );
    if (!message) {
      return undefined;
    }
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
    return unwrapCompactSummaryBlock(text);
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

async function* emptyResponsesEventStream(): AsyncGenerator<
  import("../ports.js").LlmStreamEvent,
  void,
  undefined
> {}
