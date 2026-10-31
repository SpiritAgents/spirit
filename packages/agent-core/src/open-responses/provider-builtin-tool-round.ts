import { isStepCount } from "ai";

import type { AiSdkUsageSource } from "../ai-sdk-usage.js";
import type { JsonValue, ToolCallRequest } from "../ports.js";
import { isJsonObject, type ToolAgentState } from "../tool-agent.js";
import { isResponsesBuiltInToolName } from "./responses-built-in-tools.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

export const PROVIDER_TOOL_STEP_LIMIT = 5;

/**
 * Multi-step bound for adapters whose provider tools execute through the SDK in-band (the gateway
 * v3 language-model surface): after an in-band tool result the model continues within one
 * generateText call, bounded by this step count.
 */
export function buildProviderToolStopWhen(
  config: Pick<OpenResponsesTransportConfig, "sdk">,
): ReturnType<typeof isStepCount> | undefined {
  return config.sdk === "@ai-sdk/gateway" ? isStepCount(PROVIDER_TOOL_STEP_LIMIT) : undefined;
}

export function filterPendingHostToolCalls(
  calls: readonly ToolCallRequest[],
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
): ToolCallRequest[] {
  return calls.filter(
    (call) =>
      !(isResponsesBuiltInToolName(call.name) && executedProviderBuiltinToolCallIds.has(call.id)),
  );
}

export function collectExecutedProviderBuiltinToolCallIdsFromSteps(
  steps: ReadonlyArray<{
    toolResults?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
    toolErrors?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
  }>,
): Set<string> {
  const executedIds = new Set<string>();

  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (isResponsesBuiltInToolName(result.toolName)) {
        executedIds.add(result.toolCallId);
      }
    }
    for (const error of step.toolErrors ?? []) {
      if (isResponsesBuiltInToolName(error.toolName)) {
        executedIds.add(error.toolCallId);
      }
    }
  }

  return executedIds;
}

type MaybePromise<T> = T | PromiseLike<T>;

export type AiSdkStreamTextSource = AiSdkUsageSource & {
  text?: MaybePromise<string>;
  steps?: MaybePromise<ReadonlyArray<{ text: string }>>;
};

async function resolveMaybePromise<T>(value: MaybePromise<T> | undefined): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  return await value;
}

export async function resolveAiSdkStreamAssistantText(
  source: AiSdkStreamTextSource,
  streamedText: string,
): Promise<{ text: string; finalStepText: string; sdkStepCount: number }> {
  const steps = await resolveMaybePromise(source.steps);
  const stepTexts = (steps ?? []).map((step) => step.text.trim()).filter((text) => text.length > 0);
  const finalStepText = stepTexts.at(-1) ?? "";
  const aggregateText = (await resolveMaybePromise(source.text))?.trim() ?? "";
  const allStepText = stepTexts.join("\n\n");
  const streamed = streamedText.trim();

  let resolved = streamed;
  for (const candidate of [aggregateText, allStepText, finalStepText]) {
    if (!candidate) {
      continue;
    }
    if (!resolved) {
      resolved = candidate;
      continue;
    }
    if (candidate.startsWith(resolved)) {
      resolved = candidate;
      continue;
    }
    if (resolved.startsWith(candidate)) {
      continue;
    }
    if (!resolved.includes(candidate)) {
      resolved = `${resolved}\n\n${candidate}`;
    }
  }

  return {
    text: resolved || streamedText,
    finalStepText,
    sdkStepCount: steps?.length ?? 0,
  };
}

export type AccumulatedProviderBuiltinToolResult = {
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  output: unknown;
};

export function formatProviderBuiltinToolResultContent(toolName: string, output: unknown): string {
  if (toolName === "web_search") {
    return formatWebSearchProviderToolResult(output);
  }

  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

/** Gateway provider-tool web search results arrive as `{ results: [{ title, url, snippet }] }`. */
function formatWebSearchProviderToolResult(output: unknown): string {
  if (!isJsonObject(output as JsonValue)) {
    return `[web_search]\n${String(output)}`;
  }

  const record = output as Record<string, JsonValue>;
  if (typeof record.error === "string") {
    const message = typeof record.message === "string" ? record.message : record.error;
    return `[web_search error] ${message}`;
  }

  const results = Array.isArray(record.results) ? record.results : [];
  if (results.length === 0) {
    return "[web_search] No results returned.";
  }

  const lines = results.map((result, index) => {
    if (!isJsonObject(result as JsonValue)) {
      return `${index + 1}. ${JSON.stringify(result)}`;
    }

    const entry = result as Record<string, JsonValue>;
    const title = typeof entry.title === "string" ? entry.title : "Untitled";
    const url = typeof entry.url === "string" ? entry.url : "";
    const snippet = typeof entry.snippet === "string" ? entry.snippet : "";
    return `${index + 1}. ${title}\nurl: ${url}\nsnippet: ${snippet}`;
  });

  return `[web_search]\n${lines.join("\n\n")}`;
}

export function persistProviderBuiltinToolRoundToState(
  state: ToolAgentState,
  assistantMessage: JsonValue,
  providerBuiltinToolResults: ReadonlyMap<string, AccumulatedProviderBuiltinToolResult>,
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
): void {
  state.messages.push(assistantMessage);

  const orderedResults = [...providerBuiltinToolResults.values()]
    .filter((result) => executedProviderBuiltinToolCallIds.has(result.toolCallId))
    .sort((left, right) => left.toolCallId.localeCompare(right.toolCallId));

  for (const result of orderedResults) {
    state.messages.push({
      role: "tool",
      tool_call_id: result.toolCallId,
      content: formatProviderBuiltinToolResultContent(result.toolName, result.output),
    });
  }
}

export function findLatestProviderBuiltinToolRoundInState(state: ToolAgentState):
  | {
      calls: ToolCallRequest[];
      toolResults: Array<{ toolCallId: string; content: string }>;
    }
  | undefined {
  const toolResultsById = new Map<string, string>();
  for (const message of state.messages) {
    if (!isJsonObject(message) || message.role !== "tool") {
      continue;
    }

    const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : undefined;
    const content = typeof message.content === "string" ? message.content : undefined;
    if (toolCallId && content !== undefined) {
      toolResultsById.set(toolCallId, content);
    }
  }

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!isJsonObject(message) || message.role !== "assistant") {
      continue;
    }
    if (!Array.isArray(message.tool_calls)) {
      continue;
    }

    const calls: ToolCallRequest[] = [];
    for (const entry of message.tool_calls) {
      if (!isJsonObject(entry) || !isJsonObject(entry.function)) {
        continue;
      }
      if (typeof entry.id !== "string" || typeof entry.function.name !== "string") {
        continue;
      }
      if (!isResponsesBuiltInToolName(entry.function.name)) {
        continue;
      }

      calls.push({
        id: entry.id,
        name: entry.function.name,
        argumentsJson:
          typeof entry.function.arguments === "string"
            ? entry.function.arguments
            : JSON.stringify(entry.function.arguments ?? {}),
      });
    }

    if (calls.length === 0) {
      continue;
    }

    const toolResults = calls.flatMap((call) => {
      const content = toolResultsById.get(call.id);
      return content !== undefined ? [{ toolCallId: call.id, content }] : [];
    });

    if (toolResults.length !== calls.length) {
      continue;
    }

    return { calls, toolResults };
  }

  return undefined;
}

export function shouldResumeStreamingAfterProviderSearch(
  config: Pick<OpenResponsesTransportConfig, "sdk">,
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
  pendingHostCallCount: number,
  streamedText: string,
  resolved: { text: string; finalStepText: string; sdkStepCount: number },
  /**
   * Whether another text-delta appeared after the provider builtin tool-result in this stream.
   * If so, the model has already synthesized an answer within the same stream and no follow-up must be started
   * (otherwise the UI appends the second segment into the same pending message).
   */
  hasPostToolAssistantText = false,
): boolean {
  if (
    config.sdk !== "@ai-sdk/gateway" ||
    executedProviderBuiltinToolCallIds.size === 0 ||
    pendingHostCallCount > 0
  ) {
    return false;
  }

  if (resolved.sdkStepCount >= 2 && resolved.finalStepText.trim().length > 0) {
    return false;
  }

  // Gateway sometimes places the full answer in a post-tool text-delta within the same step while steps still reports 1;
  // resuming in that case would answer again in a second round and append it to the same assistant message.
  if (hasPostToolAssistantText) {
    return false;
  }

  const streamed = streamedText.trim();
  const merged = resolved.text.trim();
  const finalStep = resolved.finalStepText.trim();

  if (!merged) {
    return true;
  }

  // The SDK single-step metadata already contains the full synthesized answer, while the streamed deltas only covered the preamble.
  if (finalStep.length > streamed.length && finalStep.startsWith(streamed)) {
    return false;
  }
  if (merged.length > streamed.length && merged.startsWith(streamed) && finalStep.length > 0) {
    return false;
  }

  return resolved.sdkStepCount < 2;
}
