import type { ThinkingSwitchDeclaration } from "./llm-provider-shared.js";
import type { JsonObject, JsonValue } from "./ports.js";

type FetchFn = typeof fetch;

/**
 * `options.openRouterAnthropicReasoning: true` — OpenRouter's unified reasoning shape for its
 * public `anthropic/claude-*` route prefix (`{reasoning: {enabled, effort | max_tokens}}`),
 * replacing the OpenAI-style `reasoning_effort` field and the Anthropic-Messages `thinking`
 * field the declared `thinkingSwitch` merge would otherwise send. The per-model thinking mode
 * (adaptive vs budget) and the budget size come from the folded `thinkingSwitch` declaration —
 * no model family tables.
 */
export interface OpenRouterAnthropicReasoningConfig {
  options?: Record<string, unknown> | undefined;
  model: string;
  reasoningEffort?: string | undefined;
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

export function buildOpenRouterAnthropicReasoningBody(
  config: OpenRouterAnthropicReasoningConfig,
): JsonObject | undefined {
  if (!usesOpenRouterAnthropicReasoning(config)) {
    return undefined;
  }

  if (config.reasoningEffort === "none") {
    return { effort: "none" };
  }

  const thinking = isJsonRecord(config.thinkingSwitch?.on?.body?.["thinking"])
    ? (config.thinkingSwitch?.on?.body?.["thinking"] as JsonObject)
    : undefined;
  const thinkingType = thinking?.["type"];

  if (thinkingType === "adaptive") {
    // Always-on families (no `off` patch declared) cannot be disabled; everything else honors
    // the user's switch.
    if (config.vendorExtendedThinking === false && config.thinkingSwitch?.off !== undefined) {
      return { enabled: false };
    }
    const effort = config.reasoningEffort;
    if (effort !== undefined && effort !== "default") {
      return { enabled: true, effort };
    }
    return { enabled: true };
  }

  const budgetTokens = thinking?.["budget_tokens"];
  if (thinkingType === "enabled" && typeof budgetTokens === "number") {
    if (config.vendorExtendedThinking === false) {
      return { enabled: false };
    }
    return { enabled: true, max_tokens: budgetTokens };
  }

  return undefined;
}

/**
 * Wire this innermost in a fetch chain so the shape applies to the fully merged body: `reasoning`
 * is replaced wholesale (the unified shape carries no `summary`), and the `reasoning_effort` /
 * `thinking` fields other layers emitted for the route are dropped. Pass-through when the
 * mechanism is undeclared, the model is not an anthropic route, or the request has no JSON body.
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

    const patched: JsonObject = { ...parsed, reasoning };
    delete patched["reasoning_effort"];
    delete patched["thinking"];
    return baseFetch(input, { ...init, body: JSON.stringify(patched) });
  };
}
