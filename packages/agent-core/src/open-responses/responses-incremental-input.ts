import { AsyncLocalStorage } from "node:async_hooks";

import type { JsonValue } from "../ports.js";
import { cloneJsonValue, isJsonObject } from "../tool-agent.js";
import { findAnchorIndexForResponseId, findPreviousResponseId } from "./provider-state.js";
import { isAwsSigV4AuthConfig, type OpenResponsesTransportConfig } from "./responses-compat.js";

export type ResponsesRoundInputMode = "full" | "incremental";

export interface ResponsesRoundInput {
  apiMessages: JsonValue[];
  previousResponseId?: string;
  mode: ResponsesRoundInputMode;
}

const storedStateRequestStore = new AsyncLocalStorage<{ previousResponseId?: string }>();

function responsesStoredStateRequestStore(previousResponseId: string | undefined): {
  previousResponseId?: string;
} {
  return previousResponseId !== undefined ? { previousResponseId } : {};
}

/**
 * Server-side stored state (`store` / `previous_response_id` continuation): the official
 * OpenAI/Azure adapters speak it natively; a generic Open Responses endpoint opts in via the
 * declared `options.storedState`. The SigV4 (Bedrock Mantle) surface uses the OpenAI adapter shape
 * but does not support the OpenAI-style remote store chain.
 */
export function responsesUsesStoredState(config: OpenResponsesTransportConfig): boolean {
  if (isAwsSigV4AuthConfig(config)) {
    return false;
  }

  if (config.options?.storedState === true) {
    return true;
  }

  return config.sdk === "@ai-sdk/openai" || config.sdk === "@ai-sdk/azure";
}

/** Lets compatible fetch paths such as Bailian/Volcengine Ark read this round's previous_response_id. */
export function readResponsesStoredStateRequestPreviousResponseId(): string | undefined {
  return storedStateRequestStore.getStore()?.previousResponseId;
}

export async function runWithResponsesStoredStateRequestContext<T>(
  previousResponseId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return storedStateRequestStore.run(responsesStoredStateRequestStore(previousResponseId), fn);
}

export function runInResponsesStoredStateRequestContextSync<T>(
  previousResponseId: string | undefined,
  fn: () => T,
): T {
  return storedStateRequestStore.run(responsesStoredStateRequestStore(previousResponseId), fn);
}

/** Streaming Responses triggers fetch while iterating chunks; ALS must be entered per iteration to avoid cross-chain leakage. */
export function bindResponsesStoredStateRequestContextAsyncIterable<T>(
  previousResponseId: string | undefined,
  iterable: AsyncIterable<T>,
): AsyncIterable<T> {
  const store = responsesStoredStateRequestStore(previousResponseId);
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]();
      return {
        next() {
          return storedStateRequestStore.run(store, () => inner.next());
        },
        return(value?: T | PromiseLike<T>) {
          return storedStateRequestStore.run(
            store,
            () =>
              inner.return?.(value) ??
              Promise.resolve({
                done: true,
                value: undefined,
              }),
          );
        },
        throw(error?: unknown) {
          return storedStateRequestStore.run(
            store,
            () => inner.throw?.(error) ?? Promise.reject(error),
          );
        },
      };
    },
  };
}

export function buildResponsesRoundInput(
  requestMessages: readonly JsonValue[],
  config: OpenResponsesTransportConfig,
  stepIndex: number,
): ResponsesRoundInput {
  const cloned = requestMessages.map((message) => cloneJsonValue(message));

  if (!responsesUsesStoredState(config)) {
    return { apiMessages: cloned, mode: "full" };
  }

  const previousResponseId = findPreviousResponseId(requestMessages);
  if (!previousResponseId) {
    return { apiMessages: cloned, mode: "full" };
  }

  const anchorIndex = findAnchorIndexForResponseId(requestMessages, previousResponseId);
  if (anchorIndex < 0) {
    return { apiMessages: cloned, mode: "full" };
  }

  let delta = requestMessages.slice(anchorIndex + 1).map((message) => cloneJsonValue(message));

  if (stepIndex === 1) {
    const systemMessage = requestMessages.find(
      (message) => isJsonObject(message) && message.role === "system",
    );
    const deltaHasSystem = delta.some(
      (message) => isJsonObject(message) && message.role === "system",
    );
    if (systemMessage && !deltaHasSystem) {
      delta = [cloneJsonValue(systemMessage), ...delta];
    }
  }

  return {
    apiMessages: delta,
    previousResponseId,
    mode: "incremental",
  };
}
