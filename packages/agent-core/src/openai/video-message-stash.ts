import type { JsonValue } from "../ports.js";
import { cloneJsonValue } from "../tool-agent.js";

/**
 * video_url passthrough stash: the AI SDK chat adapters do not pass `video_url` content parts
 * upstream. Before issuing chat.completions, the resolved OpenAI-form messages (including inlined
 * data URLs) are stashed here; the fetch wrapper writes the `messages` field back when the actual
 * HTTP request is sent. Adapters with native video support (e.g. `@ai-sdk/moonshotai`) convert
 * video to AI SDK file parts instead of using this stash.
 */
let pendingVideoPassthroughMessages: JsonValue[] | undefined;

export function stashVideoPassthroughMessages(messages: readonly JsonValue[]): void {
  pendingVideoPassthroughMessages = messages.map((message) => cloneJsonValue(message));
}

export function takeVideoPassthroughMessages(): JsonValue[] | undefined {
  const messages = pendingVideoPassthroughMessages;
  pendingVideoPassthroughMessages = undefined;
  return messages;
}

export function peekVideoPassthroughMessages(): JsonValue[] | undefined {
  return pendingVideoPassthroughMessages;
}

export function clearVideoPassthroughMessages(): void {
  pendingVideoPassthroughMessages = undefined;
}

export function openAiMessagesContainVideoUrl(messages: readonly JsonValue[]): boolean {
  for (const message of messages) {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      continue;
    }

    const record = message as Record<string, JsonValue>;
    if (record.role !== "user" || !Array.isArray(record.content)) {
      continue;
    }

    for (const part of record.content) {
      if (typeof part === "object" && part !== null && !Array.isArray(part)) {
        const partRecord = part as Record<string, JsonValue>;
        if (partRecord.type === "video_url") {
          return true;
        }
      }
    }
  }

  return false;
}
