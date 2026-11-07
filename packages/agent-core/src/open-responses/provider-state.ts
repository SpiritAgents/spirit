import type { JsonObject, JsonValue } from "../ports.js";
import { cloneJsonValue, isJsonObject } from "../tool-agent.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const RESPONSE_ID_PROVIDER_KEYS = ["openAiResponses", "openResponses"] as const;

export interface ResponsesReasoningReplayItem {
  id?: string;
  encryptedContent?: string;
  summaryText: string;
}

export function extractResponsesReasoningReplayItems(
  responseBody: unknown,
): ResponsesReasoningReplayItem[] {
  const body = responseBody as JsonValue;
  if (!isJsonObject(body) || !Array.isArray(body.output)) {
    return [];
  }
  const items: ResponsesReasoningReplayItem[] = [];
  for (const rawOutput of body.output) {
    const output = rawOutput as JsonValue;
    if (!isJsonObject(output) || output.type !== "reasoning") {
      continue;
    }
    const summaryText = Array.isArray(output.summary)
      ? output.summary
          .map((rawPart) => {
            const part = rawPart as JsonValue;
            return isJsonObject(part) && typeof part.text === "string" ? part.text : "";
          })
          .join("")
      : "";
    items.push({
      ...(typeof output.id === "string" && output.id ? { id: output.id } : {}),
      ...(typeof output.encrypted_content === "string" && output.encrypted_content
        ? { encryptedContent: output.encrypted_content }
        : {}),
      summaryText,
    });
  }
  return items;
}

export function attachReasoningReplayToAssistantMessage(
  config: OpenResponsesTransportConfig,
  message: JsonValue,
  items: readonly ResponsesReasoningReplayItem[],
): JsonValue {
  if (items.length === 0 || !isJsonObject(message)) {
    return message;
  }
  return mergeOpenResponsesProviderBucket(message, openResponsesProviderKey(config), {
    reasoningItems: items.map((item) => ({
      ...(item.id !== undefined ? { id: item.id } : {}),
      ...(item.encryptedContent !== undefined ? { encryptedContent: item.encryptedContent } : {}),
      summaryText: item.summaryText,
    })),
  });
}

export function readResponsesReasoningReplayItems(
  message: JsonObject,
  config: Pick<OpenResponsesTransportConfig, "sdk">,
): ResponsesReasoningReplayItem[] {
  if (!isJsonObject(message.providerState)) {
    return [];
  }
  const bucket = message.providerState[openResponsesProviderKey(config)];
  if (!isJsonObject(bucket) || !Array.isArray(bucket.reasoningItems)) {
    return [];
  }
  return bucket.reasoningItems.flatMap((item) => {
    if (!isJsonObject(item) || typeof item.summaryText !== "string") {
      return [];
    }
    return [
      {
        ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
        ...(typeof item.encryptedContent === "string" && item.encryptedContent
          ? { encryptedContent: item.encryptedContent }
          : {}),
        summaryText: item.summaryText,
      },
    ];
  });
}

function readResponseIdFromProviderBucket(bucket: unknown): string | undefined {
  if (!isJsonObject(bucket as JsonValue | undefined)) {
    return undefined;
  }

  const responseId = (bucket as JsonObject).responseId;
  return typeof responseId === "string" && responseId.length > 0 ? responseId : undefined;
}

export function readResponseIdFromMessage(message: JsonObject): string | undefined {
  const fromNested = readResponseIdFromProviderState(message);
  if (fromNested) {
    return fromNested;
  }

  for (const key of RESPONSE_ID_PROVIDER_KEYS) {
    const responseId = readResponseIdFromProviderBucket(message[key]);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function findPreviousResponseId(messages: readonly JsonValue[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonObject(message) || message.role !== "assistant") {
      continue;
    }

    const responseId = readResponseIdFromMessage(message);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function findAnchorIndexForResponseId(
  messages: readonly JsonValue[],
  responseId: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonObject(message) || message.role !== "assistant") {
      continue;
    }

    if (readResponseIdFromMessage(message) === responseId) {
      return index;
    }
  }

  return -1;
}

export function readResponseIdFromProviderState(message: JsonObject): string | undefined {
  if (!isJsonObject(message.providerState)) {
    return undefined;
  }

  for (const key of RESPONSE_ID_PROVIDER_KEYS) {
    const responseId = readResponseIdFromProviderBucket(message.providerState[key]);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

function openResponsesProviderKey(
  config: Pick<OpenResponsesTransportConfig, "sdk">,
): (typeof RESPONSE_ID_PROVIDER_KEYS)[number] {
  return config.sdk === "@ai-sdk/openai" ? "openAiResponses" : "openResponses";
}

function mergeOpenResponsesProviderBucket(
  message: JsonObject,
  providerKey: (typeof RESPONSE_ID_PROVIDER_KEYS)[number],
  patch: JsonObject,
): JsonValue {
  const existingProviderState: JsonObject = isJsonObject(message.providerState)
    ? (cloneJsonValue(message.providerState) as JsonObject)
    : {};
  const existingBucketValue = existingProviderState[providerKey];
  const existingBucket = isJsonObject(existingBucketValue)
    ? (cloneJsonValue(existingBucketValue) as JsonObject)
    : {};

  return {
    ...message,
    providerState: {
      ...existingProviderState,
      [providerKey]: {
        ...existingBucket,
        ...patch,
      },
    },
  };
}

export function attachResponseIdToAssistantMessage(
  config: OpenResponsesTransportConfig,
  message: JsonValue,
  responseId: string | undefined,
): JsonValue {
  if (!responseId || !isJsonObject(message)) {
    return message;
  }

  return mergeOpenResponsesProviderBucket(message, openResponsesProviderKey(config), {
    responseId,
  });
}

export function extractResponseIdFromGenerateTextResult(result: {
  providerMetadata?: unknown;
  response?: { id?: string };
}): string | undefined {
  const fromResponse =
    result.response && typeof result.response.id === "string" && result.response.id.length > 0
      ? result.response.id
      : undefined;
  if (fromResponse) {
    return fromResponse;
  }

  if (!isJsonObject(result.providerMetadata as JsonValue | undefined)) {
    return undefined;
  }

  const openai = (result.providerMetadata as JsonObject).openai;
  if (
    isJsonObject(openai) &&
    typeof openai.responseId === "string" &&
    openai.responseId.length > 0
  ) {
    return openai.responseId;
  }

  return undefined;
}
