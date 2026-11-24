import { AsyncLocalStorage } from "node:async_hooks";
import {
  extractProviderErrorDetailFromBody,
  isNonRetryableProviderErrorCode,
  NonRetryableProviderError,
} from "./openai/ai-sdk-provider-error.js";

/** AI SDK `maxRetries`: number of retries allowed beyond the initial request. */
export const LLM_MAX_RETRIES = 2;

export type LlmRetryObserverEvent =
  | {
      kind: "retry";
      attempt: number;
      maxAttempts: number;
      error: string;
    }
  | { kind: "cleared" };

export type LlmRetryObserver = (event: LlmRetryObserverEvent) => void;

interface LlmRetryObservationStore {
  observer?: LlmRetryObserver;
  maxRetries: number;
  retryableFailureCount: number;
}

const llmRetryObservationStore = new AsyncLocalStorage<LlmRetryObservationStore>();

export function runInLlmRetryObservationContext<T>(
  input: {
    observer?: LlmRetryObserver;
    maxRetries?: number;
  },
  fn: () => T,
): T {
  const store: LlmRetryObservationStore = {
    maxRetries: input.maxRetries ?? LLM_MAX_RETRIES,
    retryableFailureCount: 0,
    ...(input.observer ? { observer: input.observer } : {}),
  };
  return llmRetryObservationStore.run(store, fn);
}

function isRetryableLlmHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function readLlmRetryErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const cloned = response.clone();
    const bodyText = await cloned.text();
    const trimmed = bodyText.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const nestedError = record.error;
        if (nestedError && typeof nestedError === "object") {
          const message = (nestedError as Record<string, unknown>).message;
          if (typeof message === "string" && message.trim()) {
            return message.trim();
          }
        }
        const message = record.message;
        if (typeof message === "string" && message.trim()) {
          return message.trim();
        }
      }
    } catch {
      // fall through to raw body
    }
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  } catch {
    return undefined;
  }
}

export async function observeLlmFetchResponse(response: Response): Promise<Response> {
  if (isRetryableLlmHttpStatus(response.status)) {
    const clonedText = await response
      .clone()
      .text()
      .catch(() => "");
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const detail = extractProviderErrorDetailFromBody(clonedText, response.status, requestId);
    if (isNonRetryableProviderErrorCode(detail?.code)) {
      const errorMessage = (await readLlmRetryErrorMessage(response)) ?? `HTTP ${response.status}`;
      throw new NonRetryableProviderError(errorMessage, {
        ...detail,
        status: response.status,
      });
    }

    const store = llmRetryObservationStore.getStore();
    if (store?.observer) {
      store.retryableFailureCount += 1;
      const maxAttempts = store.maxRetries + 1;
      const error = (await readLlmRetryErrorMessage(response)) ?? `HTTP ${response.status}`;
      store.observer({
        kind: "retry",
        attempt: store.retryableFailureCount,
        maxAttempts,
        error,
      });
    }
    return response;
  }

  const store = llmRetryObservationStore.getStore();
  if (store?.observer && response.ok && store.retryableFailureCount > 0) {
    store.observer({ kind: "cleared" });
  }

  return response;
}
