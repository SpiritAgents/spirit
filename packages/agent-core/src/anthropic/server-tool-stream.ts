import type { TextStreamPart } from "ai";

import type { JsonObject, JsonValue, LlmStreamEvent } from "../ports.js";
import { buildResponsesBuiltInToolArgumentsJson } from "../open-responses/responses-built-in-tools.js";
import { resolveStreamingToolPreviewEmit } from "../tool-streaming-preview-gate.js";
import { isJsonObject } from "../tool-agent.js";

/**
 * Anthropic transport server-tool stream handling. `server_tool_use` / `web_search_tool_result`
 * content block types are Messages protocol facts; the recognized tool names come from the
 * config's declared no-execute provider tool entries (e.g. `{type: "web_search_20250305"}`).
 */

export const ANTHROPIC_ASSISTANT_CONTENT_BLOCKS_KEY = "_anthropicContentBlocks";

type ServerToolPreviewState = {
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
};

export type AnthropicWebSearchResult = {
  type: "web_search_result";
  title?: string | undefined;
  url?: string | undefined;
  content?: string | undefined;
  page_age?: string | undefined;
};

export type AnthropicServerToolStreamState = {
  /** Declared in-band (no `execute`) server tool names recognized on this stream. */
  serverToolNames: ReadonlySet<string>;
  executedProviderBuiltinToolCallIds: Set<string>;
  webSearchInputByCallId: Map<string, string>;
  webSearchToolNameByCallId: Map<string, string>;
  webSearchPreviewStateByCallId: Map<string, ServerToolPreviewState>;
  webSearchResultsByCallId: Map<string, readonly AnthropicWebSearchResult[]>;
  anthropicContentBlocks: JsonValue[];
  handledWebSearchValidationErrors: Set<string>;
};

export function createAnthropicServerToolStreamState(
  serverToolNames: ReadonlySet<string>,
): AnthropicServerToolStreamState {
  return {
    serverToolNames,
    executedProviderBuiltinToolCallIds: new Set<string>(),
    webSearchInputByCallId: new Map<string, string>(),
    webSearchToolNameByCallId: new Map<string, string>(),
    webSearchPreviewStateByCallId: new Map<string, ServerToolPreviewState>(),
    webSearchResultsByCallId: new Map<string, readonly AnthropicWebSearchResult[]>(),
    anthropicContentBlocks: [],
    handledWebSearchValidationErrors: new Set<string>(),
  };
}

export function shouldSuppressAnthropicServerToolStreamError(
  error: unknown,
  state: AnthropicServerToolStreamState,
): boolean {
  if (state.executedProviderBuiltinToolCallIds.size === 0) {
    return false;
  }

  // The AI SDK Anthropic adapter rejects `web_search_tool_result` content blocks it cannot parse;
  // the round already completed in-band, so the validation error is suppressed once per stream.
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("web_search_tool_result")) {
    return false;
  }

  const marker = "web_search_tool_result";
  if (state.handledWebSearchValidationErrors.has(marker)) {
    return true;
  }
  state.handledWebSearchValidationErrors.add(marker);
  return true;
}

function readToolCallId(part: { toolCallId?: string; id?: string }): string | undefined {
  if (typeof part.toolCallId === "string" && part.toolCallId.trim()) {
    return part.toolCallId;
  }
  if (typeof part.id === "string" && part.id.trim()) {
    return part.id;
  }
  return undefined;
}

function readToolName(part: { toolName?: string }): string | undefined {
  return typeof part.toolName === "string" && part.toolName.trim() ? part.toolName : undefined;
}

function tryParseQueryFromArgumentsJson(argumentsJson: string): string | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed) || typeof parsed.query !== "string") {
      return undefined;
    }
    const trimmed = parsed.query.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Parses `web_search_tool_result` block content (a Messages protocol shape) into result entries. */
export function parseAnthropicWebSearchToolResults(content: unknown): AnthropicWebSearchResult[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((entry) => {
    if (!isJsonObject(entry as JsonValue) || (entry as JsonObject).type !== "web_search_result") {
      return [];
    }

    const record = entry as JsonObject;
    return [
      {
        type: "web_search_result" as const,
        ...(readNonEmptyString(record.title) ? { title: readNonEmptyString(record.title) } : {}),
        ...(readNonEmptyString(record.url) ? { url: readNonEmptyString(record.url) } : {}),
        ...(readNonEmptyString(record.content)
          ? { content: readNonEmptyString(record.content) }
          : {}),
        ...(readNonEmptyString(record.page_age)
          ? { page_age: readNonEmptyString(record.page_age) }
          : {}),
      },
    ];
  });
}

function mapWebSearchResultsToActionSources(
  results: readonly AnthropicWebSearchResult[],
): JsonObject[] {
  const sources: JsonObject[] = [];

  for (const result of results) {
    const url = readNonEmptyString(result.url);
    if (!url) {
      continue;
    }

    const source: JsonObject = { type: "url", url };
    const title = readNonEmptyString(result.title);
    const snippet = readNonEmptyString(result.content);
    if (title) {
      source.title = title;
    }
    if (snippet) {
      source.snippet = snippet;
    }
    sources.push(source);
  }

  return sources;
}

export function buildAnthropicServerToolPreviewArgumentsJson(query: string): string {
  const trimmedQuery = query.trim();
  return JSON.stringify(trimmedQuery ? { query: trimmedQuery } : {});
}

export function buildAnthropicWebSearchSucceededArgumentsJson(
  query: string,
  results: readonly AnthropicWebSearchResult[],
): string {
  const sources = mapWebSearchResultsToActionSources(results);
  const item: JsonObject = {
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query: query.trim(),
      sources,
    },
  };
  return buildResponsesBuiltInToolArgumentsJson(item, "web_search");
}

function emitServerToolPreview(
  events: LlmStreamEvent[],
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  previewState: ServerToolPreviewState,
): ServerToolPreviewState {
  const decision = resolveStreamingToolPreviewEmit(toolName, argumentsJson, previewState);
  if (!decision.emit) {
    return previewState;
  }

  events.push({
    kind: "streaming-tool-preview",
    toolCallId,
    toolName,
    argumentsJson,
  });

  return decision.nextState;
}

function appendUniqueAnthropicContentBlock(
  state: AnthropicServerToolStreamState,
  block: JsonValue,
): void {
  const serialized = JSON.stringify(block);
  const exists = state.anthropicContentBlocks.some((entry) => JSON.stringify(entry) === serialized);
  if (!exists) {
    state.anthropicContentBlocks.push(block);
  }
}

function handleRawServerToolChunk(
  rawValue: unknown,
  state: AnthropicServerToolStreamState,
  events: LlmStreamEvent[],
): boolean {
  if (!isJsonObject(rawValue as JsonValue)) {
    return false;
  }

  const chunk = rawValue as JsonObject;
  if (chunk.type !== "content_block_start") {
    return false;
  }

  const contentBlock = isJsonObject(chunk.content_block as JsonValue)
    ? (chunk.content_block as JsonObject)
    : undefined;
  if (!contentBlock || typeof contentBlock.type !== "string") {
    return false;
  }

  if (contentBlock.type === "server_tool_use") {
    appendUniqueAnthropicContentBlock(state, cloneJsonBlock(contentBlock));
    const toolCallId = typeof contentBlock.id === "string" ? contentBlock.id : undefined;
    const toolName = readNonEmptyString(contentBlock.name);
    if (toolCallId && toolName) {
      state.webSearchToolNameByCallId.set(toolCallId, toolName);
    }
    if (toolCallId && isJsonObject(contentBlock.input as JsonValue)) {
      state.webSearchInputByCallId.set(toolCallId, JSON.stringify(contentBlock.input));
    }
    return true;
  }

  if (contentBlock.type === "web_search_tool_result") {
    appendUniqueAnthropicContentBlock(state, cloneJsonBlock(contentBlock));
    const toolCallId =
      typeof contentBlock.tool_use_id === "string" ? contentBlock.tool_use_id : undefined;
    if (!toolCallId) {
      return true;
    }

    const results = parseAnthropicWebSearchToolResults(contentBlock.content);
    state.webSearchResultsByCallId.set(toolCallId, results);
    state.executedProviderBuiltinToolCallIds.add(toolCallId);

    const toolName = state.webSearchToolNameByCallId.get(toolCallId) ?? "web_search";
    const query =
      tryParseQueryFromArgumentsJson(state.webSearchInputByCallId.get(toolCallId) ?? "{}") ?? "";
    const succeededArgumentsJson = buildAnthropicWebSearchSucceededArgumentsJson(query, results);
    state.webSearchInputByCallId.set(toolCallId, succeededArgumentsJson);
    events.push({
      kind: "streaming-tool-preview",
      toolCallId,
      toolName,
      argumentsJson: succeededArgumentsJson,
    });
    return true;
  }

  if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
    appendUniqueAnthropicContentBlock(state, { type: "text", text: contentBlock.text });
    return false;
  }

  return false;
}

function cloneJsonBlock(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function handleAnthropicServerToolStreamPart(
  part: TextStreamPart<any>,
  state: AnthropicServerToolStreamState,
  events: LlmStreamEvent[],
): { handled: boolean; sawAnswerOrToolOutput: boolean } {
  const toolName = readToolName(part as { toolName?: string });
  const toolCallId = readToolCallId(part as { toolCallId?: string; id?: string });

  if (part.type === "tool-input-start") {
    if (!toolCallId || !state.serverToolNames.has(toolName ?? "")) {
      return { handled: false, sawAnswerOrToolOutput: false };
    }
    state.webSearchInputByCallId.set(toolCallId, "");
    state.webSearchToolNameByCallId.set(toolCallId, toolName ?? "");
    state.webSearchPreviewStateByCallId.set(toolCallId, { readyPreviewEmitted: false });
    return { handled: true, sawAnswerOrToolOutput: true };
  }

  if (part.type === "tool-input-delta") {
    if (!toolCallId || !state.webSearchToolNameByCallId.has(toolCallId)) {
      return { handled: false, sawAnswerOrToolOutput: false };
    }
    const currentInput = state.webSearchInputByCallId.get(toolCallId) ?? "";
    const delta = typeof part.delta === "string" ? part.delta : "";
    const nextInput = currentInput + delta;
    state.webSearchInputByCallId.set(toolCallId, nextInput);

    const previewState = state.webSearchPreviewStateByCallId.get(toolCallId) ?? {
      readyPreviewEmitted: false,
    };
    const previewArgumentsJson = buildAnthropicServerToolPreviewArgumentsJson(
      tryParseQueryFromArgumentsJson(nextInput) ?? "",
    );
    state.webSearchPreviewStateByCallId.set(
      toolCallId,
      emitServerToolPreview(
        events,
        toolCallId,
        state.webSearchToolNameByCallId.get(toolCallId) ?? "web_search",
        previewArgumentsJson,
        previewState,
      ),
    );
    return { handled: true, sawAnswerOrToolOutput: true };
  }

  if (part.type === "tool-input-end") {
    if (!toolCallId || !state.webSearchInputByCallId.has(toolCallId)) {
      return { handled: false, sawAnswerOrToolOutput: false };
    }
    return { handled: true, sawAnswerOrToolOutput: true };
  }

  if (part.type === "tool-call") {
    if (!toolCallId || !state.serverToolNames.has(toolName ?? "")) {
      return { handled: false, sawAnswerOrToolOutput: false };
    }
    state.executedProviderBuiltinToolCallIds.add(toolCallId);
    const argumentsJson = JSON.stringify(part.input ?? {});
    state.webSearchInputByCallId.set(toolCallId, argumentsJson);
    const previewArgumentsJson = buildAnthropicServerToolPreviewArgumentsJson(
      tryParseQueryFromArgumentsJson(argumentsJson) ?? "",
    );
    events.push({
      kind: "streaming-tool-preview",
      toolCallId,
      toolName: toolName ?? "web_search",
      argumentsJson: previewArgumentsJson,
    });
    return { handled: true, sawAnswerOrToolOutput: true };
  }

  if (part.type === "tool-error") {
    if (!toolCallId || !state.serverToolNames.has(toolName ?? "")) {
      return { handled: false, sawAnswerOrToolOutput: false };
    }
    if (state.webSearchResultsByCallId.has(toolCallId)) {
      return { handled: true, sawAnswerOrToolOutput: true };
    }
    state.executedProviderBuiltinToolCallIds.add(toolCallId);
    return { handled: true, sawAnswerOrToolOutput: true };
  }

  if (part.type === "raw") {
    const rawValue = (part as { rawValue?: unknown }).rawValue;
    const sawToolBlock = handleRawServerToolChunk(rawValue, state, events);
    return { handled: sawToolBlock, sawAnswerOrToolOutput: sawToolBlock };
  }

  return { handled: false, sawAnswerOrToolOutput: false };
}

export function filterAnthropicServerToolCalls<T extends { id: string; name: string }>(
  calls: readonly T[],
  state: AnthropicServerToolStreamState,
): T[] {
  if (state.executedProviderBuiltinToolCallIds.size === 0) {
    return [...calls];
  }

  return calls.filter(
    (call) =>
      !(
        state.executedProviderBuiltinToolCallIds.has(call.id) &&
        state.serverToolNames.has(call.name)
      ),
  );
}

export function appendStreamingTextAnthropicBlock(
  state: AnthropicServerToolStreamState,
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const lastBlock = state.anthropicContentBlocks.at(-1);
  if (lastBlock !== undefined && isJsonObject(lastBlock as JsonValue)) {
    const textBlock = lastBlock as JsonObject;
    if (textBlock.type === "text" && typeof textBlock.text === "string") {
      textBlock.text = `${textBlock.text}${text}`;
      return;
    }
  }

  state.anthropicContentBlocks.push({ type: "text", text });
}

export function buildAnthropicServerToolAssistantMessageFields(
  state: AnthropicServerToolStreamState,
  assistantContent: string,
): JsonObject {
  if (state.anthropicContentBlocks.length === 0 && assistantContent.trim()) {
    appendStreamingTextAnthropicBlock(state, assistantContent);
  }

  if (state.anthropicContentBlocks.length === 0) {
    return {};
  }

  return {
    [ANTHROPIC_ASSISTANT_CONTENT_BLOCKS_KEY]: state.anthropicContentBlocks.map(
      (block) => JSON.parse(JSON.stringify(block)) as JsonValue,
    ),
  };
}

export function readAnthropicAssistantContentBlocks(message: JsonObject): JsonValue[] | undefined {
  const blocks = message[ANTHROPIC_ASSISTANT_CONTENT_BLOCKS_KEY];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return undefined;
  }
  return blocks;
}

export function resolveAnthropicServerToolAssistantReplayText(
  message: JsonObject,
  blocks: readonly JsonValue[],
): string {
  if (typeof message.content === "string" && message.content.trim().length > 0) {
    return message.content;
  }

  return blocks
    .flatMap((block) => {
      if (!isJsonObject(block as JsonValue)) {
        return [];
      }
      const record = block as JsonObject;
      if (record.type !== "text" || typeof record.text !== "string") {
        return [];
      }
      return [record.text];
    })
    .join("\n\n")
    .trim();
}
