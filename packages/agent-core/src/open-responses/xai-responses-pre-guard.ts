import type { ResolvedProviderTools } from "../provider-tools/runtime.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

/**
 * The `@ai-sdk/xai` Responses surface rejects local function tools unless provider web search is
 * active on the request (mechanism-keyed on the declared `sdk` package). Web search is active when
 * the global provider-tools switch is on and the resolved declarations contribute at least one
 * entry; the pre-guard fails the turn early with a clear message instead of surfacing the
 * upstream's rejection mid-round.
 */
export function xaiResponsesRejectsLocalFunctionTools(
  config: Pick<OpenResponsesTransportConfig, "sdk" | "providerToolsEnabled">,
  localFunctionToolCount: number,
  providerTools: Pick<ResolvedProviderTools, "functionTools" | "literalEntries">,
): boolean {
  if (config.sdk !== "@ai-sdk/xai" || localFunctionToolCount === 0) {
    return false;
  }

  // When the user opts out of provider tools on this surface, local function tools cannot be sent
  // either (the API rejects them without provider web search), so the turn inherits the same
  // failure path as an entry that never declared provider tools.
  if (config.providerToolsEnabled === false) {
    return true;
  }
  return providerTools.functionTools.length + providerTools.literalEntries.length === 0;
}

export function xaiResponsesLocalToolsUnsupportedMessage(): string {
  return "SpaceXAI Responses API does not support local function tools yet; please use the Chat Completions transport instead.";
}
