import type { JsonObject } from "./ports.js";

export type LlmTransportKind = "openai-compatible" | "open-responses" | "anthropic" | "bedrock";

/** Policy profile distinguishing main Agent conversations from non-Agent lightweight LLM requests such as code completion. */
export type TransportRequestProfile = "agent" | "code-completion";

export interface LlmModelCapabilities {
  languageModel?: true;
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
  imageGeneration?: true;
}

/**
 * User-level opt-out switches for the built-in web tools and provider-declared tools, resolved by
 * the host from config.json (`agents.webFetch.enabled` / `agents.providerTools.enabled`).
 * Undefined means enabled; only an explicit `false` hides the tool from the model.
 */
export interface LlmWebToolExposure {
  webFetchEnabled?: boolean;
  providerToolsEnabled?: boolean;
}

/** Literal wire patch merged when the thinking switch is toggled to the owning state. */
export interface ThinkingSwitchWirePatch {
  body?: JsonObject;
  headers?: Record<string, string>;
}

/**
 * Declared wire encoding for a model thinking on/off switch (`thinkingSwitch`); absent = the
 * transport's default thinking encoding applies.
 */
export interface ThinkingSwitchDeclaration {
  on?: ThinkingSwitchWirePatch;
  off?: ThinkingSwitchWirePatch;
}
