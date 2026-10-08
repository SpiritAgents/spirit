import type { JsonObject, JsonValue } from "../ports.js";
import type { ServiceTierRequestPlan } from "../service-tier-request.js";
import { isJsonObject } from "../tool-agent.js";

type FetchFn = typeof fetch;

/**
 * Applies the parts of a resolved service tier plan that AI SDK provider options cannot express:
 * patches the serialized top-level body `service_tier` and adds plan headers (direct OpenAI
 * Ultrafast's user-specified `OpenAI-Service-Tier` header) after SDK serialization, preserving
 * the remaining body, headers, signal, and streaming behavior.
 */
export function createServiceTierResponsesFetch(
  plan: ServiceTierRequestPlan,
  baseFetch: FetchFn,
): FetchFn {
  if (plan.bodyServiceTier === undefined && plan.headers === undefined) {
    return baseFetch;
  }

  return async (input, init) => baseFetch(input, patchServiceTierRequestInit(init, plan));
}

function patchServiceTierRequestInit(
  init: RequestInit | undefined,
  plan: ServiceTierRequestPlan,
): RequestInit | undefined {
  if (init === undefined) {
    return init;
  }

  let next = init;
  if (plan.bodyServiceTier !== undefined && typeof next.body === "string") {
    try {
      const body = JSON.parse(next.body) as JsonValue;
      if (isJsonObject(body)) {
        const patched: JsonObject = { ...body, service_tier: plan.bodyServiceTier };
        next = { ...next, body: JSON.stringify(patched) };
      }
    } catch {
      // Non-JSON bodies (e.g. multipart uploads) are left untouched.
    }
  }

  if (plan.headers !== undefined) {
    const headers = new Headers(next.headers);
    for (const [name, value] of Object.entries(plan.headers)) {
      headers.set(name, value);
    }
    next = { ...next, headers };
  }

  return next;
}
