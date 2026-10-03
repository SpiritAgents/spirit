export type LlmTransportKind = "openai-compatible" | "open-responses" | "anthropic" | "bedrock";

/** Policy profile distinguishing main Agent conversations from non-Agent lightweight LLM requests such as code completion. */
export type TransportRequestProfile = "agent" | "code-completion";

export interface LlmModelCapabilities {
  chat?: true;
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
  imageGeneration?: true;
}

/**
 * User-level opt-out switches for the built-in web tools, resolved by the host from config.json
 * (`agents.webSearch.enabled` / `agents.webFetch.enabled`). Undefined means enabled; only an
 * explicit `false` hides the tool from the model.
 */
export interface LlmWebToolExposure {
  webSearchEnabled?: boolean;
  webFetchEnabled?: boolean;
}
