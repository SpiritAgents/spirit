import type { JsonObject, JsonValue } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

/**
 * Top-level Responses API fields rejected by stateless streaming-only Responses endpoints.
 * Omitted when `options.statelessStreamingResponses` is declared.
 */
const STATELESS_STREAMING_UNSUPPORTED_FIELDS: readonly string[] = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "previous_response_id",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
];

export function isStatelessStreamingResponsesConfig(
  config: Pick<OpenResponsesTransportConfig, "options">,
): boolean {
  return config.options?.statelessStreamingResponses === true;
}

export function patchStatelessStreamingResponsesBody(body: JsonObject): JsonObject {
  const patched: JsonObject = { ...body };
  for (const field of STATELESS_STREAMING_UNSUPPORTED_FIELDS) {
    delete patched[field];
  }
  patched.store = false;
  patched.stream = true;

  if (Array.isArray(patched.input)) {
    patched.input = patched.input.map((item) => {
      if (isJsonObject(item) && item.role === "system") {
        return { ...item, role: "developer" };
      }
      return item;
    });
  }

  return patched;
}

export function createStatelessStreamingResponsesFetch(
  config: Pick<OpenResponsesTransportConfig, "options">,
  baseFetch: typeof fetch,
): typeof fetch {
  if (!isStatelessStreamingResponsesConfig(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    if (!init?.body || typeof init.body !== "string") {
      return baseFetch(input, init);
    }

    try {
      const parsed = JSON.parse(init.body) as JsonValue;
      if (!isJsonObject(parsed)) {
        return baseFetch(input, init);
      }
      return baseFetch(input, {
        ...init,
        body: JSON.stringify(patchStatelessStreamingResponsesBody(parsed)),
      });
    } catch {
      return baseFetch(input, init);
    }
  };
}
