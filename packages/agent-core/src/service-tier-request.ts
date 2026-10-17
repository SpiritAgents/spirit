import type { JsonObject } from "./ports.js";
import type {
  ModelServiceTier,
  ModelServiceTiersDeclaration,
  ModelServiceTiersLiteralDeclaration,
} from "./model-service-tier.js";

/**
 * Wire surface a language-model request is serialized for. `gateway-v3` is the Vercel AI Gateway
 * v3 language-model protocol (`createGateway(...)` chat); `responses` covers both the official
 * OpenAI SDK and generic Open Responses endpoints; `messages` is the Anthropic Messages API;
 * `generate-content` is the Gemini generateContent family (`@ai-sdk/google` / `google-vertex`).
 */
export type ServiceTierRequestSurface =
  | "chat-completions"
  | "responses"
  | "gateway-v3"
  | "messages"
  | "generate-content"
  | "bedrock";

export interface ServiceTierRequestContext {
  /** Canonical per-model preference; unset preserves the request byte-for-byte. */
  serviceTier?: ModelServiceTier;
  /** Declared `serviceTiers` block: a tier-name list (simple form) or a tier → wire map (literal). */
  serviceTiers?: ModelServiceTiersDeclaration;
  surface: ServiceTierRequestSurface;
}

export interface ServiceTierRequestPlan {
  /** Deep-merged per namespace into AI SDK providerOptions. */
  providerOptions?: Record<string, JsonObject>;
  /** Literal headers merged into the outbound request (override on conflict). */
  headers?: Record<string, string>;
  /** Literal fields merged into the serialized request body top level (override on conflict). */
  body?: JsonObject;
  /** True when the canonical tier is `flex`; selects the extended-wait dispatcher. */
  flexWaiting?: boolean;
}

/**
 * Maps the declared per-model `serviceTier` selection to request patches. The simple form maps
 * through a fixed table of public transport API facts (`service_tier` for the OpenAI family,
 * `gateway.serviceTier` for the gateway v3 protocol); the literal form applies the tier's declared
 * headers/body verbatim with zero mapping. Selection validity is enforced at config load.
 */
export function resolveServiceTierRequestPlan(
  context: ServiceTierRequestContext,
): ServiceTierRequestPlan {
  const tier = context.serviceTier;
  if (tier === undefined) {
    return {};
  }

  if (context.serviceTiers !== undefined && !Array.isArray(context.serviceTiers)) {
    // Literal form: the tier's declared headers/body apply verbatim with zero internal mapping; a
    // tier missing from the map is a config-load error, so the runtime maps nothing here.
    const literal = (context.serviceTiers as ModelServiceTiersLiteralDeclaration)[tier];
    return withFlexWaiting(literal !== undefined ? { ...literal } : {}, tier);
  }

  const plan = simpleFormPlan(context.surface, tier);
  return withFlexWaiting(plan, tier);
}

/**
 * Namespace-level merge of a plan's providerOptions into an existing builder result: plan keys
 * join the existing namespace object instead of replacing it, so reasoning/store/
 * previousResponseId options built elsewhere survive.
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

/**
 * Simple-form wire table: public transport API parameters only. Anthropic `speed` is applied by
 * the Anthropic transport itself (the SDK also merges the fast-mode beta header), and Bedrock has
 * no tier parameter, so those surfaces resolve to an empty plan; routes whose mapping varies per
 * upstream materialize the literal form instead.
 */
function simpleFormPlan(
  surface: ServiceTierRequestSurface,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  switch (surface) {
    case "chat-completions":
    case "responses":
      return { body: { service_tier: tier } };
    case "gateway-v3":
      // The gateway v3 language-model protocol accepts only flex/priority in its unified enum.
      return tier === "flex" || tier === "priority"
        ? { providerOptions: { gateway: { serviceTier: tier } } }
        : {};
    default:
      return {};
  }
}

function withFlexWaiting(
  plan: ServiceTierRequestPlan,
  tier: ModelServiceTier,
): ServiceTierRequestPlan {
  return tier === "flex" ? { ...plan, flexWaiting: true } : plan;
}
