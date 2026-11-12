import type { ConversationMessageSnapshot, MessageAuxSnapshot } from "../types.js";
import i18n from "./i18n-host.js";

export const TURN_ERROR_RETRYING_I18N_KEY = "app.turnErrorRetrying";

export function isTurnErrorAssistantMessage(
  message: Pick<ConversationMessageSnapshot, "role" | "content" | "aux">,
): boolean {
  return (
    message.role === "assistant" &&
    message.aux?.turnError === true &&
    (message.aux.turnErrorRetry !== undefined || message.content.trim().length > 0)
  );
}

export function isTurnErrorRetryingAssistantMessage(
  message: Pick<ConversationMessageSnapshot, "aux">,
): boolean {
  return message.aux?.turnErrorRetry !== undefined;
}

export function formatTurnErrorRetryProgress(
  retry: NonNullable<MessageAuxSnapshot["turnErrorRetry"]>,
): string {
  return i18n.t(TURN_ERROR_RETRYING_I18N_KEY, {
    attempt: retry.attempt,
    maxAttempts: retry.maxAttempts,
  });
}
