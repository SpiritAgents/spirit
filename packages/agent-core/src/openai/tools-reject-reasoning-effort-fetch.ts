import { getLlmFetch } from "../llm-fetch.js";
import type { JsonValue } from "../ports.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

type FetchFn = typeof fetch;

/**
 * `options.toolsRejectReasoningEffort: true` — the upstream rejects function tools combined with a
 * non-`none` reasoning effort (the CF REST `/chat/completions` behavior this restores). When both
 * appear in one request, every reasoning effort field is forced to `"none"`.
 */
export function shouldForceNoneReasoningEffortWithTools(
  config: Pick<OpenAiTransportConfig, "options">,
): boolean {
  return config.options?.toolsRejectReasoningEffort === true;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestHasFunctionTools(body: Record<string, unknown>): boolean {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return false;
  }
  return tools.some((tool) => isJsonRecord(tool) && tool.type === "function");
}

/**
 * Forces both the top-level `reasoning_effort` and a nested `reasoning.effort` to `"none"` when the
 * request carries at least one function tool and a non-`none` effort; anything else passes through
 * unchanged (same reference, no re-serialization).
 */
export function patchToolsRejectReasoningEffortBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!requestHasFunctionTools(body)) {
    return body;
  }

  const topLevelEffort = body.reasoning_effort;
  const reasoning = body.reasoning;
  const nestedEffort = isJsonRecord(reasoning) ? reasoning.effort : undefined;
  const hasNonNoneEffort =
    (topLevelEffort !== undefined && topLevelEffort !== null && topLevelEffort !== "none") ||
    (nestedEffort !== undefined && nestedEffort !== null && nestedEffort !== "none");

  if (!hasNonNoneEffort) {
    return body;
  }

  const patched: Record<string, unknown> = {
    ...body,
    reasoning_effort: "none",
  };

  if (
    isJsonRecord(reasoning) &&
    nestedEffort !== undefined &&
    nestedEffort !== null &&
    nestedEffort !== "none"
  ) {
    patched.reasoning = {
      ...reasoning,
      effort: "none",
    };
  }

  return patched;
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * Conditional body patch on POST `/chat/completions`. Wire it innermost in the chat fetch chain so
 * the force applies to the fully merged body (SDK serialization, `options.bodyBase`, and literal
 * `body` declarations alike) — the upstream rejects the combination, so no later merge may
 * re-introduce it.
 */
export function createToolsRejectReasoningEffortFetch(
  config: Pick<OpenAiTransportConfig, "options">,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  if (!shouldForceNoneReasoningEffortWithTools(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    if (
      init?.method?.toUpperCase() !== "POST" ||
      !resolveRequestUrl(input).includes("/chat/completions") ||
      typeof init.body !== "string"
    ) {
      return baseFetch(input, init);
    }

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(init.body) as JsonValue;
    } catch {
      return baseFetch(input, init);
    }
    if (!isJsonRecord(parsed)) {
      return baseFetch(input, init);
    }

    const patched = patchToolsRejectReasoningEffortBody(parsed);
    if (patched === parsed) {
      return baseFetch(input, init);
    }
    return baseFetch(input, { ...init, body: JSON.stringify(patched) });
  };
}
