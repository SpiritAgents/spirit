import type { JsonObject } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";
import { isStepfunApiHostname } from "./stepfun-api-hosts.js";

const STEPFUN_ANTHROPIC_EFFORTS = new Set(["low", "medium", "high"]);

function isStepfunAnthropicApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isStepfunApiHostname(parsed.hostname) && parsed.pathname.includes("/messages");
  } catch {
    return false;
  }
}

function patchStepfunAnthropicRequestBody(body: JsonObject): JsonObject {
  const next: JsonObject = { ...body };

  const effort = next.effort;
  if (typeof effort === "string" && STEPFUN_ANTHROPIC_EFFORTS.has(effort)) {
    next.output_config = {
      ...(isJsonObject(next.output_config) ? next.output_config : {}),
      effort,
    };
    delete next.effort;
  }

  delete next.thinking;

  return next;
}

export function createStepfunAnthropicAwareFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (
      init?.method?.toUpperCase() === "POST" &&
      typeof init.body === "string" &&
      isStepfunAnthropicApiUrl(url)
    ) {
      try {
        const parsed = JSON.parse(init.body) as JsonObject;
        return fetchImpl(input, {
          ...init,
          body: JSON.stringify(patchStepfunAnthropicRequestBody(parsed)),
        });
      } catch {
        // Fall through to the original request when body is not JSON.
      }
    }

    return fetchImpl(input, init);
  };
}
