import type { AnthropicEffort } from "../anthropic/anthropic-compat.js";
import { buildGeminiThinkingConfigForEffort } from "../openai/gemini-thinking-config.js";
import type { JsonObject } from "../ports.js";
import { resolveThinkingSwitchWirePatch } from "../thinking-switch.js";
import {
  openResponsesReasoningEffort,
  resolveOpenResponsesReasoningSummary,
  type OpenResponsesTransportConfig,
} from "./responses-compat.js";

/**
 * The upstream route slug of a gateway model id (`anthropic/claude-…` → `anthropic`): the
 * gateway's public routing slug — a wire fact carried by every gateway model id.
 */
export function gatewayUpstreamRouteSlug(model: string): string | undefined {
  const normalized = model.trim();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }
  return normalized.slice(0, slashIndex).toLowerCase();
}

/** The Anthropic protocol's effort enum has no none/minimal/default; those tokens send no effort. */
const ANTHROPIC_EFFORT_TOKENS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** The xAI adapter's reasoningEffort enum (including `none`, which disables thinking). */
const XAI_REASONING_EFFORT_TOKENS: ReadonlySet<string> = new Set(["none", "low", "medium", "high"]);

function deepMergeProviderOptions(target: Record<string, JsonObject>, fragment: JsonObject): void {
  for (const [namespace, values] of Object.entries(fragment)) {
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      continue;
    }
    target[namespace] = { ...target[namespace], ...(values as JsonObject) };
  }
}

/**
 * Reasoning/thinking emission for the gateway v3 language-model protocol (`@ai-sdk/gateway`).
 * The v3 body is the serialized AI SDK call options; upstream-specific params travel in
 * providerOptions keyed by the upstream's namespace. Everything here is keyed on mechanism
 * facts: the model id's route slug (the gateway's public routing slug), the declared
 * `thinkingSwitch` state patch (`providerOptions` form), and the declared reasoning
 * effort/summary. The effort/summary namespace table encodes each upstream's public gateway
 * wire shape; routes without an entry take the OpenAI-namespaced Responses shape, the
 * protocol's fallback.
 */
export function buildGatewayV3ProviderOptions(
  config: Pick<
    OpenResponsesTransportConfig,
    | "model"
    | "reasoningEffort"
    | "reasoningSummary"
    | "options"
    | "thinkingSwitch"
    | "vendorExtendedThinking"
  >,
): Record<string, JsonObject> {
  const result: Record<string, JsonObject> = {};

  // Declared thinking on/off encoding, `providerOptions` form (per upstream namespace).
  const thinkingPatch = resolveThinkingSwitchWirePatch(config);
  if (thinkingPatch !== "omit" && thinkingPatch?.providerOptions !== undefined) {
    deepMergeProviderOptions(result, thinkingPatch.providerOptions);
  }

  const effort = openResponsesReasoningEffort(config);
  const summary = resolveOpenResponsesReasoningSummary(config);
  const slug = gatewayUpstreamRouteSlug(config.model);

  switch (slug) {
    case "anthropic": {
      // The upstream is the Anthropic AI SDK adapter: fine-grained tool streaming plus the
      // protocol's `effort` enum (none/minimal tokens are not Anthropic efforts).
      const anthropic: JsonObject = { toolStreaming: true };
      if (effort !== undefined && ANTHROPIC_EFFORT_TOKENS.has(effort)) {
        anthropic.effort = effort as AnthropicEffort;
      }
      result.anthropic = { ...anthropic, ...result.anthropic };
      break;
    }
    case "google": {
      const thinkingConfig = buildGeminiThinkingConfigForEffort(config.model, effort);
      if (thinkingConfig !== undefined) {
        result.google = { thinkingConfig, ...result.google } as JsonObject;
      }
      break;
    }
    case "deepseek": {
      if (effort !== undefined) {
        result.deepseek = { reasoningEffort: effort, ...result.deepseek };
      }
      break;
    }
    case "xai": {
      if (effort !== undefined && XAI_REASONING_EFFORT_TOKENS.has(effort)) {
        result.xai = { reasoningEffort: effort, ...result.xai };
      }
      break;
    }
    default: {
      // OpenAI-routed models (and every other route) take the Responses reasoning payload in
      // the openai namespace.
      const openai: JsonObject = {
        ...(effort !== undefined ? { reasoningEffort: effort } : {}),
        ...(summary !== undefined ? { reasoningSummary: summary } : {}),
      };
      if (Object.keys(openai).length > 0) {
        result.openai = { ...openai, ...result.openai };
      }
      break;
    }
  }

  return result;
}
