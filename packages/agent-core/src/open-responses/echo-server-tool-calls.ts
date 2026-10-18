import { AsyncLocalStorage } from "node:async_hooks";

import { getLlmFetch } from "../llm-fetch.js";
import type { JsonObject, JsonValue } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import { readBuiltInOutputItemsFromMessage } from "./provider-state.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

type FetchFn = typeof fetch;

/**
 * `options.echoServerToolCalls: true` — the endpoint expects server-side tool call items (e.g.
 * `web_search_call`) captured from assistant history to be passed back into the next round's
 * `input`, each inserted directly after the assistant item that produced it (the DeepSeek
 * Responses continuation convention). The insertions are collected from the round's messages at
 * the transport layer and applied to the serialized request body here, so the adapter's own
 * message conversion stays untouched.
 */
const echoServerToolCallsStore = new AsyncLocalStorage<ReadonlyMap<number, JsonObject[]>>();

/** Maps assistant-message ordinal (among assistant messages only) to its captured output items. */
export function collectEchoServerToolCallInsertions(
  messages: readonly JsonValue[],
): Map<number, JsonObject[]> {
  const insertions = new Map<number, JsonObject[]>();
  let assistantIndex = 0;
  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== "assistant") {
      continue;
    }
    const items = readBuiltInOutputItemsFromMessage(message);
    if (items.length > 0) {
      insertions.set(assistantIndex, items);
    }
    assistantIndex += 1;
  }
  return insertions;
}

/** Inserts each assistant item's captured server-side tool call items directly ahead of it. */
export function injectEchoServerToolCallInputItems(
  input: readonly JsonValue[],
  insertions: ReadonlyMap<number, JsonObject[]>,
): JsonValue[] {
  if (insertions.size === 0) {
    return [...input];
  }

  const result: JsonValue[] = [];
  let assistantIndex = 0;
  for (const item of input) {
    if (isAssistantResponsesInputItem(item)) {
      const extra = insertions.get(assistantIndex);
      if (extra && extra.length > 0) {
        result.push(...extra);
      }
      assistantIndex += 1;
    }
    result.push(item);
  }
  return result;
}

export function runWithEchoServerToolCallsContext<T>(
  insertions: ReadonlyMap<number, JsonObject[]>,
  fn: () => T,
): T {
  return echoServerToolCallsStore.run(insertions, fn);
}

/** Streaming triggers fetch while iterating chunks; ALS must be entered per iteration to avoid cross-chain leakage. */
export function bindEchoServerToolCallsContextAsyncIterable<T>(
  insertions: ReadonlyMap<number, JsonObject[]>,
  iterable: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]();
      return {
        next() {
          return echoServerToolCallsStore.run(insertions, () => inner.next());
        },
        return(value?: T | PromiseLike<T>) {
          return echoServerToolCallsStore.run(
            insertions,
            () =>
              inner.return?.(value) ??
              Promise.resolve({
                done: true,
                value: undefined,
              }),
          );
        },
        throw(error?: unknown) {
          return echoServerToolCallsStore.run(
            insertions,
            () => inner.throw?.(error) ?? Promise.reject(error),
          );
        },
      };
    },
  };
}

/** Runs `fn` with the round's echo insertions bound when the entry declares the mechanism. */
export function withEchoServerToolCallsContext<T>(
  config: Pick<OpenResponsesTransportConfig, "options">,
  messages: readonly JsonValue[],
  fn: () => T,
): T {
  if (config.options?.echoServerToolCalls !== true) {
    return fn();
  }
  return runWithEchoServerToolCallsContext(collectEchoServerToolCallInsertions(messages), fn);
}

export function bindEchoServerToolCallsContextIfNeeded<T>(
  config: Pick<OpenResponsesTransportConfig, "options">,
  messages: readonly JsonValue[],
  iterable: AsyncIterable<T>,
): AsyncIterable<T> {
  if (config.options?.echoServerToolCalls !== true) {
    return iterable;
  }
  return bindEchoServerToolCallsContextAsyncIterable(
    collectEchoServerToolCallInsertions(messages),
    iterable,
  );
}

function isAssistantResponsesInputItem(item: JsonValue): boolean {
  return isJsonObject(item) && item.role === "assistant";
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * Applies the round's echo insertions to the serialized `/responses` request body. Self-gates on
 * the declared option; without a bound context (or no captured items) the body passes through.
 */
export function createEchoServerToolCallsFetch(
  config: Pick<OpenResponsesTransportConfig, "options">,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  if (config.options?.echoServerToolCalls !== true) {
    return baseFetch;
  }

  return async (input, init) => {
    const insertions = echoServerToolCallsStore.getStore();
    if (
      !insertions ||
      insertions.size === 0 ||
      !readRequestUrl(input).includes("/responses") ||
      typeof init?.body !== "string"
    ) {
      return baseFetch(input, init);
    }

    try {
      const body = JSON.parse(init.body) as JsonValue;
      if (!isJsonObject(body) || !Array.isArray(body.input)) {
        return baseFetch(input, init);
      }

      return baseFetch(input, {
        ...init,
        body: JSON.stringify({
          ...body,
          input: injectEchoServerToolCallInputItems(body.input as JsonValue[], insertions),
        }),
      });
    } catch {
      return baseFetch(input, init);
    }
  };
}
