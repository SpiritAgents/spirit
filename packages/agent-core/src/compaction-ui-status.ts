import { llmMessageTextContent, type LlmMessage } from "./ports.js";

export const MANUAL_COMPACTION_SKIPPED_STATUS =
  "Not enough history to compact yet; compaction skipped.";

/** UI-only manual compaction status lines; must not enter llmHistory or session transcripts. */
export function isManualCompactionUiStatusText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (normalized === MANUAL_COMPACTION_SKIPPED_STATUS) {
    return true;
  }
  if (normalized.startsWith("Compaction complete: context messages")) {
    return true;
  }
  if (normalized.startsWith("Compaction failed:")) {
    return true;
  }
  return false;
}

export function isManualCompactionUiStatusLlmMessage(message: LlmMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return false;
  }
  return isManualCompactionUiStatusText(llmMessageTextContent(message.content));
}
