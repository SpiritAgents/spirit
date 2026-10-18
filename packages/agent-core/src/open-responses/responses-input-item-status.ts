import { getLlmFetch } from "../llm-fetch.js";
import type { JsonObject, JsonValue } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

type FetchFn = typeof fetch;

/**
 * `options.defaultInputItemStatus: "<status>"` — the endpoint requires every replayed input item
 * to carry a status (the Ark Responses compatibility convention this restores, materialized as
 * `"completed"`); items missing one get the declared value filled in.
 */
export function declaredDefaultInputItemStatus(
  config: Pick<OpenResponsesTransportConfig, "options">,
): string | undefined {
  const value = config.options?.defaultInputItemStatus;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Fills the declared status onto every `input` item that lacks one; existing statuses are kept. */
export function patchResponsesInputItemStatus(body: JsonObject, status: string): void {
  const input = body.input;
  if (!Array.isArray(input)) {
    return;
  }

  for (let index = 0; index < input.length; index += 1) {
    const rawItem = input[index];
    if (!isJsonObject(rawItem as JsonValue)) {
      continue;
    }

    const item = rawItem as JsonObject;
    if (typeof item.status === "string" && item.status.trim().length > 0) {
      continue;
    }

    input[index] = {
      ...item,
      status,
    };
  }
}

/** Applies the declared default status to any request body carrying an `input` array. */
export function createDefaultInputItemStatusFetch(
  config: Pick<OpenResponsesTransportConfig, "options">,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  const status = declaredDefaultInputItemStatus(config);
  if (status === undefined) {
    return baseFetch;
  }

  return async (input, init) => {
    if (typeof init?.body !== "string") {
      return baseFetch(input, init);
    }

    try {
      const body = JSON.parse(init.body) as JsonValue;
      if (!isJsonObject(body) || !Array.isArray(body.input)) {
        return baseFetch(input, init);
      }

      const patched: JsonObject = { ...body };
      patchResponsesInputItemStatus(patched, status);
      return baseFetch(input, { ...init, body: JSON.stringify(patched) });
    } catch {
      return baseFetch(input, init);
    }
  };
}
