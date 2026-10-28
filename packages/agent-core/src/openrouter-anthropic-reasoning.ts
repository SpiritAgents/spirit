import type { ThinkingSwitchDeclaration } from "./llm-provider-shared.js";
import { normalizeModelEffort } from "./model-effort.js";
import type { JsonObject, JsonValue } from "./ports.js";
import { resolveThinkingSwitchState } from "./thinking-switch.js";

type FetchFn = typeof fetch;

/**
 * `options.openRouterAnthropicReasoning: true` — OpenRouter's unified reasoning shape for its
 * public `anthropic/claude-*` route prefix (`{reasoning: {enabled, effort | max_tokens}}`),
 * replacing the OpenAI-style `reasoning_effort` field and the Anthropic-Messages `thinking`
 * field the declared `thinkingSwitch` merge would otherwise send. The per-model thinking mode
 * (adaptive vs budget), off state, and output effort come from declarations — no model family
 * tables. Messages-only combinations fail explicitly instead of being degraded.
 */
export interface OpenRouterAnthropicReasoningConfig {
  options?: Record<string, unknown> | undefined;
  model: string;
  reasoningEffort?: string | undefined;
  effortSemantics?: "output" | undefined;
  effort?: string | undefined;
  vendorExtendedThinking?: boolean | undefined;
  thinkingSwitch?: ThinkingSwitchDeclaration | undefined;
}

export function usesOpenRouterAnthropicReasoning(
  config: Pick<OpenRouterAnthropicReasoningConfig, "options" | "model">,
): boolean {
  return (
    config.options?.["openRouterAnthropicReasoning"] === true &&
    config.model.trim().toLowerCase().startsWith("anthropic/claude-")
  );
}

function isJsonRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messagesRequired(detail: string): Error {
  return new Error(
    `${detail} requires Anthropic Messages; declare model-level transportKind "anthropic" and sdk "@ai-sdk/anthropic" on this OpenRouter model.`,
  );
}

export function buildOpenRouterAnthropicReasoningBody(
  config: OpenRouterAnthropicReasoningConfig,
): JsonObject | "omit" | undefined {
  if (!usesOpenRouterAnthropicReasoning(config)) {
    return undefined;
  }

  if (config.effortSemantics !== "output" && config.reasoningEffort === "none") {
    return { effort: "none" };
  }

  const output = config.effortSemantics === "output";
  const effort = output
    ? normalizeModelEffort(config.effort)
    : config.reasoningEffort !== undefined && config.reasoningEffort !== "default"
      ? config.reasoningEffort
      : undefined;
  const state = resolveThinkingSwitchState({
    ...(config.vendorExtendedThinking !== undefined
      ? { vendorExtendedThinking: config.vendorExtendedThinking }
      : {}),
    ...(config.thinkingSwitch !== undefined ? { thinkingSwitch: config.thinkingSwitch } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });
  const thinking = isJsonRecord(config.thinkingSwitch?.on?.body?.["thinking"])
    ? (config.thinkingSwitch?.on?.body?.["thinking"] as JsonObject)
    : undefined;
  const thinkingType = thinking?.["type"];
  const offPatch = config.thinkingSwitch?.off;
  const independentEffort = output ? effort : undefined;

  if (state === "off" && offPatch !== undefined) {
    if (offPatch === "omit") {
      return independentEffort !== undefined
        ? { enabled: false, effort: independentEffort }
        : "omit";
    }
    const offThinking = isJsonRecord(offPatch.body?.["thinking"])
      ? (offPatch.body?.["thinking"] as JsonObject)
      : undefined;
    if (offThinking?.["type"] === "between_tools") {
      throw messagesRequired("OpenRouter thinking type between_tools");
    }
    if (offThinking?.["type"] !== "disabled") {
      throw messagesRequired("This declared thinking-off encoding");
    }
    return independentEffort !== undefined
      ? { enabled: false, effort: independentEffort }
      : { enabled: false };
  }

  if (thinkingType === "adaptive") {
    return effort !== undefined ? { enabled: true, effort } : { enabled: true };
  }

  const budgetTokens = thinking?.["budget_tokens"];
  if (thinkingType === "enabled" && typeof budgetTokens === "number") {
    if (output && effort !== undefined) {
      throw messagesRequired("OpenRouter thinking budget combined with effort");
    }
    return { enabled: true, max_tokens: budgetTokens };
  }

  return undefined;
}

/**
 * Wire this innermost in a fetch chain so the shape applies to the fully merged body: `reasoning`
 * is replaced wholesale (or removed for a declared omit), and the `reasoning_effort` / `thinking`
 * fields other layers emitted for the route are dropped. Pass-through when the mechanism is
 * undeclared, the model is not an anthropic route, or the request has no JSON body.
 */
export function createOpenRouterAnthropicReasoningFetch(
  config: OpenRouterAnthropicReasoningConfig,
  baseFetch: FetchFn,
): FetchFn {
  const reasoning = buildOpenRouterAnthropicReasoningBody(config);
  if (reasoning === undefined) {
    return baseFetch;
  }

  return async (input, init) => {
    if (typeof init?.body !== "string") {
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

    const patched: JsonObject = { ...parsed };
    delete patched["reasoning"];
    delete patched["reasoning_effort"];
    delete patched["thinking"];
    if (reasoning !== "omit") {
      patched["reasoning"] = reasoning;
    }
    return baseFetch(input, { ...init, body: JSON.stringify(patched) });
  };
}
