import {
  createLlmMessageContentFromTextAndImages,
  type JsonObject,
  type JsonValue,
} from "../ports.js";
import { buildToolAgentSystemMessage, cloneJsonValue } from "../tool-agent.js";

import type { OpenAiTransportConfig } from "./openai-compat.js";
import { llmMessageToOpenAiMessage } from "./openai-multimodal-messages.js";

export interface OpenAiJsonSchemaCompletionRequest {
  userPrompt: string;
  schemaName: string;
  schema: JsonObject;
  systemSections?: Array<string | undefined>;
  includeToolAgentHostPrompt?: boolean;
  imagePaths?: readonly string[];
  videoPaths?: readonly string[];
}

export interface OpenAiJsonSchemaCompletionResult<T extends JsonValue = JsonValue> {
  output: T;
  rawText: string;
  requestTrace: JsonValue[];
}

export interface OpenAiJsonSchemaTransport {
  createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>>;
}

export function buildJsonSchemaCompletionMessages(
  config: { model: string; workspaceRoot?: string; webFetchEnabled?: boolean },
  request: OpenAiJsonSchemaCompletionRequest,
): JsonObject[] {
  const sections = [...(request.systemSections ?? [])]
    .filter(
      (section): section is string => typeof section === "string" && section.trim().length > 0,
    )
    .map((section) => section.trim());
  return [
    {
      role: "system",
      content:
        request.includeToolAgentHostPrompt === false
          ? sections.join("\n\n")
          : buildToolAgentSystemMessage(
              config.model,
              undefined,
              { webFetchEnabled: config.webFetchEnabled },
              ...sections,
            ),
    },
    buildJsonSchemaCompletionUserMessage(config.workspaceRoot, request),
  ];
}

function buildJsonSchemaCompletionUserMessage(
  workspaceRoot: string | undefined,
  request: OpenAiJsonSchemaCompletionRequest,
): JsonObject {
  const imagePaths = request.imagePaths ?? [];
  const videoPaths = request.videoPaths ?? [];
  if (imagePaths.length === 0 && videoPaths.length === 0) {
    return {
      role: "user",
      content: request.userPrompt,
    };
  }

  return llmMessageToOpenAiMessage(
    {
      role: "user",
      content: createLlmMessageContentFromTextAndImages(request.userPrompt, imagePaths, videoPaths),
    },
    workspaceRoot ?? process.cwd(),
  );
}

export function extractJsonSchemaCompletionContent(response: {
  choices?: Array<{ message?: { content?: string | null } }>;
}): string {
  const content = response.choices?.at(0)?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("Structured output returned empty.");
  }

  return content;
}

export function parseJsonSchemaCompletionOutput<T extends JsonValue = JsonValue>(
  content: string,
): T {
  const candidates = collectJsonParseCandidates(content);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue trying progressively looser candidates.
    }
  }

  throw new Error("Structured output is not valid JSON.");
}

export function stringifyJsonSchemaCompletionOutput(output: JsonValue): string {
  return JSON.stringify(cloneJsonValue(output));
}

function collectJsonParseCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const next = value?.trim();
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };

  push(trimmed);

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  push(fenceMatch?.[1]);

  const firstObjectStart = trimmed.indexOf("{");
  const lastObjectEnd = trimmed.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    push(trimmed.slice(firstObjectStart, lastObjectEnd + 1));
  }

  const firstArrayStart = trimmed.indexOf("[");
  const lastArrayEnd = trimmed.lastIndexOf("]");
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    push(trimmed.slice(firstArrayStart, lastArrayEnd + 1));
  }

  return candidates;
}
