import { isCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import type { ThinkingSwitchDeclaration, TransportRequestProfile } from "../llm-provider-shared.js";
import { normalizeModelEffort } from "../model-effort.js";
import type { JsonObject, JsonValue } from "../ports.js";
import { resolveThinkingSwitchWirePatch } from "../thinking-switch.js";
import { isJsonObject } from "../tool-agent.js";
import type { AnthropicEffort } from "./anthropic-compat.js";

export interface AnthropicOutputWireConfig {
  body?: JsonObject;
  effort?: string;
  effortSemantics?: "output";
  thinkingSwitch?: ThinkingSwitchDeclaration;
  transportRequestProfile?: TransportRequestProfile;
  vendorExtendedThinking?: boolean;
}

export interface AnthropicOutputWireResolution {
  effort?: AnthropicEffort;
  thinking?: JsonValue;
  omitThinking: boolean;
}

export function resolveAnthropicOutputWire(
  config: AnthropicOutputWireConfig,
): AnthropicOutputWireResolution {
  const effort = isCodeCompletionTransportProfile(config)
    ? undefined
    : normalizeModelEffort(config.effort);
  const thinkingPatch = resolveThinkingSwitchWirePatch({
    ...(config.vendorExtendedThinking !== undefined
      ? { vendorExtendedThinking: config.vendorExtendedThinking }
      : {}),
    ...(config.thinkingSwitch !== undefined ? { thinkingSwitch: config.thinkingSwitch } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });
  const patchThinking = thinkingPatch === "omit" ? undefined : thinkingPatch?.body?.thinking;
  const explicitThinking = config.body?.thinking;
  let thinking = patchThinking ?? explicitThinking;
  if (thinkingPatch === "omit") {
    thinking = undefined;
  } else if (
    thinkingPatch === undefined &&
    thinking === undefined &&
    (isCodeCompletionTransportProfile(config) || config.vendorExtendedThinking === false)
  ) {
    thinking = { type: "disabled" };
  }

  return {
    ...(effort !== undefined ? { effort } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    omitThinking: thinking === undefined,
  };
}

export function applyAnthropicOutputWire(
  body: JsonObject,
  config: AnthropicOutputWireConfig,
  serializedBody?: JsonObject,
): JsonObject {
  const resolution = resolveAnthropicOutputWire(config);
  const result: JsonObject = { ...body };
  if (resolution.omitThinking) {
    delete result["thinking"];
  } else {
    result["thinking"] = resolution.thinking!;
  }

  const outputConfig = {
    ...(isJsonObject(serializedBody?.["output_config"]) ? serializedBody["output_config"] : {}),
    ...(isJsonObject(result["output_config"]) ? result["output_config"] : {}),
  };
  if (resolution.effort === undefined) {
    delete outputConfig["effort"];
  } else {
    outputConfig["effort"] = resolution.effort;
  }
  if (Object.keys(outputConfig).length === 0) {
    delete result["output_config"];
  } else {
    result["output_config"] = outputConfig;
  }
  return result;
}
