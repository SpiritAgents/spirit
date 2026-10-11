import type { JsonObject } from "./ports.js";
import type { ModelReasoningProvider } from "./reasoning-effort.js";
import type { ModelServiceTier } from "./model-service-tier.js";
import {
  isVertexGlobalServiceTierEndpoint,
  resolveServiceTierUpstreamProvider,
  type ServiceTierUpstreamProvider,
} from "./model-service-tier.js";
import { isOpenAiUltrafastModel } from "./openai/gpt-reasoning-controls.js";

/**
 * Wire surface a language-model request is serialized for. `gateway-v3` is the Vercel AI Gateway
 * v3 language-model protocol (chat `createGateway(...)` and the Responses web-search path);
 * `responses` covers both the official OpenAI SDK and generic Open Responses endpoints.
 */
export type ServiceTierRequestSurface =
  | "chat-completions"
  | "responses"
  | "gateway-v3"
  | "messages";

export interface ServiceTierRequestContext {
  /** Host provider id (aligned with transport `llmVendor`). */
  provider?: ModelReasoningProvider;
  /** Model id as configured; aggregator routes may carry an `upstream/` prefix. */
  model?: string;
  /** Canonical per-model preference; unset preserves the current request byte-for-byte. */
  serviceTier?: ModelServiceTier;
  /** Catalog-provided upstream identity fact; authoritative when present. */
  upstreamProvider?: string;
  /** Vertex AI location; Flex/Priority are gated to the global endpoint. */
  vertexLocation?: string;
  surface: ServiceTierRequestSurface;
}

export interface ServiceTierRequestPlan {
  /** Deep-merged per namespace into AI SDK providerOptions. */
  providerOptions?: Record<string, JsonObject>;
  /** Top-level body `service_tier` patch for surfaces without SDK support. */
  bodyServiceTier?: string;
  /** Extra request headers (direct OpenAI Ultrafast only; never on aggregators). */
  headers?: Record<string, string>;
  /** True when the canonical tier is `flex`; selects the extended-wait dispatcher. */
  flexWaiting?: boolean;
}

const OPENAI_ULTRAFAST_HEADER = "OpenAI-Service-Tier";

/**
 * Maps the canonical per-model `serviceTier` preference to per-route request fields. Routes and
 * values not listed in the capability matrix resolve to an empty plan (no injection); unsupported
 * combinations are rejected earlier at config parse time (`parseModelServiceTierConfig`).
 */
export function resolveServiceTierRequestPlan(
  context: ServiceTierRequestContext,
): ServiceTierRequestPlan {
  const tier = context.serviceTier;
  if (tier === undefined) {
    return {};
  }

  switch (context.provider) {
    case "openai":
      return openAiDirectServiceTierPlan(context, tier);
    case "xai":
      return xaiServiceTierPlan(context, tier);
    case "google":
      return googleServiceTierPlan(context, tier);
    case "google-vertex-ai":
      return vertexServiceTierPlan(context, tier);
    case "vercel-ai-gateway":
      return vercelGatewayServiceTierPlan(context, tier);
    case "openrouter":
      return openRouterServiceTierPlan(context, tier);
    default:
      return {};
  }
}

/**
 * Namespace-level merge of a plan's providerOptions into an existing builder result: plan keys
 * join the existing namespace object instead of replacing it, so reasoning/store/
 * previousResponseId/tools options built by vendor branches survive.
 */
export function mergeServiceTierProviderOptions(
  base: Record<string, JsonObject>,
  plan: ServiceTierRequestPlan,
): Record<string, JsonObject> {
  const patch = plan.providerOptions;
  if (patch === undefined || Object.keys(patch).length === 0) {
    return base;
  }

  const merged: Record<string, JsonObject> = { ...base };
  for (const [namespace, values] of Object.entries(patch)) {
    merged[namespace] = { ...merged[namespace], ...values };
  }
  return merged;
}

function withFlexWaiting(
  plan: ServiceTierRequestPlan,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  return tier === "flex" ? { ...plan, flexWaiting: true } : plan;
}

function isUltrafastModel(model: string | undefined): boolean {
  return isOpenAiUltrafastModel(model ?? "");
}

function openAiDirectServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  // Direct OpenAI language-model requests run on the open-responses transport (official SDK).
  if (context.surface !== "responses") {
    return {};
  }

  if (tier === "ultrafast") {
    if (!isUltrafastModel(context.model)) {
      return {};
    }
    // @ai-sdk/openai >= 4.0.58 accepts "ultrafast" in its official serviceTier enum, so the
    // value rides the SDK provider option. The extra header is user-specified behavior for
    // direct OpenAI only and is never sent to aggregators.
    return {
      providerOptions: { openai: { serviceTier: "ultrafast" } },
      headers: { [OPENAI_ULTRAFAST_HEADER]: "ultrafast" },
    };
  }

  if (tier === "auto" || tier === "default" || tier === "flex" || tier === "fast") {
    return withFlexWaiting({ providerOptions: { openai: { serviceTier: tier } } }, tier);
  }

  return {};
}

function xaiServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  if (context.surface !== "chat-completions" && context.surface !== "responses") {
    return {};
  }

  if (tier === "default" || tier === "priority") {
    return { providerOptions: { xai: { serviceTier: tier } } };
  }

  return {};
}

function googleServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  if (context.surface !== "chat-completions") {
    return {};
  }

  // Gemini Developer API serializes SDK `google.serviceTier` as top-level body `serviceTier`.
  const mapped =
    tier === "default"
      ? "standard"
      : tier === "flex"
        ? "flex"
        : tier === "priority"
          ? "priority"
          : undefined;
  if (mapped === undefined) {
    return {};
  }

  return withFlexWaiting({ providerOptions: { google: { serviceTier: mapped } } }, tier);
}

function vertexServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  if (context.surface !== "chat-completions") {
    return {};
  }
  // Flex/Priority are gated to the global endpoint; regional configs are rejected at parse time.
  if (!isVertexGlobalServiceTierEndpoint(context.vertexLocation)) {
    return {};
  }
  // Default keeps provisioned/on-demand behavior; only non-default tiers opt into shared capacity.
  if (tier !== "flex" && tier !== "priority") {
    return {};
  }

  // The SDK serializes these as the X-Vertex-AI-LLM-Shared-Request-Type / X-Vertex-AI-LLM-Request-Type
  // request headers, not as a body field.
  return withFlexWaiting(
    { providerOptions: { vertex: { sharedRequestType: tier, requestType: "shared" } } },
    tier,
  );
}

/** Allowed values shared by the v3 gateway row and the generic Vercel Responses row. */
function vercelUpstreamServiceTierValue(
  upstream: ServiceTierUpstreamProvider,
  tier: ModelServiceTier,
  model: string | undefined,
): "flex" | "fast" | "priority" | "ultrafast" | undefined {
  switch (upstream) {
    case "openai":
      if (tier === "ultrafast") {
        return isUltrafastModel(model) ? "ultrafast" : undefined;
      }
      // OpenAI upstreams natively speak Fast; the gateway forwards it.
      return tier === "flex" || tier === "fast" ? tier : undefined;
    case "google":
      // Google upstream tiers are priority processing, not Fast aliases.
      return tier === "flex" || tier === "priority" ? tier : undefined;
    case "xai":
      // SpaceXAI upstream tiers are priority processing, not Fast aliases.
      return tier === "priority" ? "priority" : undefined;
    default:
      // Anthropic and unknown upstreams get no service tier injection behind Vercel.
      return undefined;
  }
}

function vercelGatewayServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  const upstream = resolveServiceTierUpstreamProvider(context);
  if (upstream === undefined) {
    return {};
  }

  const value = vercelUpstreamServiceTierValue(upstream, tier, context.model);
  if (value === undefined) {
    return {};
  }

  if (context.surface === "gateway-v3") {
    // Ultrafast is not part of the gateway unified enum; it is forwarded to the upstream through
    // the openai namespace instead.
    if (value === "ultrafast") {
      return { providerOptions: { openai: { serviceTier: "ultrafast" } } };
    }
    return withFlexWaiting({ providerOptions: { gateway: { serviceTier: value } } }, tier);
  }

  if (context.surface === "responses") {
    // Generic native-compatible Responses route: top-level body service_tier per the native contract.
    return withFlexWaiting({ bodyServiceTier: value }, tier);
  }

  return {};
}

/** OpenRouter top-level body `service_tier`; explicit "default" overrides :nitro/:floor admission. */
function openRouterServiceTierPlan(
  context: ServiceTierRequestContext,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  if (context.surface !== "chat-completions" && context.surface !== "responses") {
    return {};
  }

  const upstream = resolveServiceTierUpstreamProvider(context);
  if (upstream === undefined) {
    return {};
  }

  switch (upstream) {
    case "openai":
      if (tier === "ultrafast") {
        return isUltrafastModel(context.model) ? { bodyServiceTier: "ultrafast" } : {};
      }
      return tier === "default" || tier === "flex" || tier === "fast"
        ? withFlexWaiting({ bodyServiceTier: tier }, tier)
        : {};
    case "google":
      return tier === "default" || tier === "flex" || tier === "priority"
        ? withFlexWaiting({ bodyServiceTier: tier }, tier)
        : {};
    case "anthropic":
    case "xai":
      // OpenRouter maps `priority` for these upstreams itself; Spirit never injects Anthropic
      // speed/beta here.
      return tier === "default" || tier === "priority" ? { bodyServiceTier: tier } : {};
    default:
      return {};
  }
}
