import type { ThinkingSwitchDeclaration } from "./llm-provider-shared.js";
import type { JsonObject, JsonValue } from "./ports.js";
import type { ModelServiceTier, ModelServiceTiersDeclaration } from "./model-service-tier.js";
import {
  resolveServiceTierRequestPlan,
  type ServiceTierRequestSurface,
} from "./service-tier-request.js";
import { resolveThinkingSwitchWirePatch } from "./thinking-switch.js";

/**
 * Literal declaration merge point (`headers` / `body` / `thinkingSwitch` / literal `serviceTiers`).
 * The runtime does not interpret the contents: declared headers are written into every outbound
 * request and declared body fields into every JSON request body, overriding transport defaults on
 * conflict (an explicit declaration beats the transport default encoding).
 */
export interface LlmDeclaredWireConfig {
  /** Provider-level literal headers, merged into every outbound request. */
  headers?: Record<string, string>;
  /** Provider-level literal body fields, merged unconditionally into every request body top level. */
  body?: JsonObject;
  /** Declared thinking on/off wire encoding; the user's switch state selects the patch. */
  thinkingSwitch?: ThinkingSwitchDeclaration;
  /** User thinking-switch state (`false` = off); read together with `thinkingSwitch`. */
  vendorExtendedThinking?: boolean;
  /** Selected service tier (validated at config load). */
  serviceTier?: ModelServiceTier;
  /** Declared service tiers; the literal map form carries the wire effect per tier. */
  serviceTiers?: ModelServiceTiersDeclaration;
}

/**
 * Wraps `baseFetch` so every outbound request carries the declared wire patches. Merge order, from
 * lowest to highest precedence: SDK-serialized request → `options.bodyBase` (transport-computed
 * wire fields, e.g. `reasoning_effort` for adapters without a native option) → provider-level
 * `headers`/`body` → thinking-switch state patch → selected service tier patch. The more specific
 * declaration wins.
 */
export function createDeclaredWireMergeFetch(
  config: LlmDeclaredWireConfig,
  surface: ServiceTierRequestSurface,
  baseFetch: typeof fetch,
  options?: { bodyBase?: JsonObject | undefined },
): typeof fetch {
  // Surfaces whose protocol has no raw top-level thinking field skip the patch:
  // - gateway v3: the language-model protocol carries the encoding in namespaced call
  //   providerOptions (the patch's `providerOptions` form), emitted by the open-responses
  //   provider-options builder; a top-level field is a stray the protocol does not define.
  // - bedrock: Converse defines no top-level `thinking` field; the encoding travels in
  //   `providerOptions.bedrock.reasoningConfig`, emitted by the bedrock provider-options builder.
  const thinkingPatch =
    surface === "gateway-v3" || surface === "bedrock"
      ? undefined
      : resolveThinkingSwitchWirePatch(config);
  const serviceTierPlan = resolveServiceTierRequestPlan({
    ...(config.serviceTier !== undefined ? { serviceTier: config.serviceTier } : {}),
    ...(config.serviceTiers !== undefined ? { serviceTiers: config.serviceTiers } : {}),
    surface,
  });

  const headers: Record<string, string> = {
    ...config.headers,
    ...thinkingPatch?.headers,
    ...serviceTierPlan.headers,
  };
  const headerEntries = Object.entries(headers);
  const bodyPatches = [
    options?.bodyBase,
    config.body,
    thinkingPatch?.body,
    serviceTierPlan.body,
  ].filter((patch): patch is JsonObject => patch !== undefined && Object.keys(patch).length > 0);

  if (headerEntries.length === 0 && bodyPatches.length === 0) {
    return baseFetch;
  }

  return async (input, init) => {
    let nextInit = init;
    if (headerEntries.length > 0) {
      const merged = new Headers(nextInit?.headers);
      for (const [key, value] of headerEntries) {
        merged.set(key, value);
      }
      nextInit = { ...nextInit, headers: merged };
    }

    if (bodyPatches.length > 0 && typeof nextInit?.body === "string") {
      const body = tryParseJsonObject(nextInit.body);
      if (body !== undefined) {
        const patched: JsonObject = { ...body };
        for (const patch of bodyPatches) {
          Object.assign(patched, patch);
        }
        nextInit = { ...nextInit, body: JSON.stringify(patched) };
      }
    }

    return baseFetch(input, nextInit);
  };
}

function tryParseJsonObject(body: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(body) as JsonValue;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
