import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  TurnErrorDetailSnapshot,
} from "../types.js";
import i18n from "./i18n-host.js";

export const TURN_ERROR_RETRYING_I18N_KEY = "app.turnErrorRetrying";

export const CHATGPT_MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
export const CHATGPT_UPGRADE_PLAN_URL = "https://chatgpt.com/#pricing";

const CHATGPT_REFRESH_EXPIRED_CODES: ReadonlySet<string> = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

const CHATGPT_SCOPE_ERROR_CODES: ReadonlySet<string> = new Set([
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
]);

export interface TurnErrorAction {
  label: string;
  url: string;
}

export interface ResolvedTurnErrorPresentation {
  message: string;
  action?: TurnErrorAction;
}

export type TurnErrorTranslate = (key: string) => string;

/**
 * Maps ChatGPT SIWC structured error metadata to localized 10-locale copy and optional
 * right-side Secondary action buttons (`Manage Usage` / `Upgrade Plan`). Unrecognized errors
 * keep their original upstream copy intact.
 */
export function resolveLocalizedTurnError(
  content: string,
  detail: TurnErrorDetailSnapshot | undefined,
  t: TurnErrorTranslate = (key) => i18n.t(key),
): ResolvedTurnErrorPresentation {
  const code = detail?.code?.trim();
  const status = detail?.status;
  const isChatGptProvider = detail?.providerId === "chatgpt";

  if (code === "subscription_sharing_usage_limit_exceeded") {
    return {
      message: t("chatgptErrors.usageLimitExceeded"),
      action: {
        label: t("chatgptErrors.manageUsage"),
        url: CHATGPT_MANAGE_USAGE_URL,
      },
    };
  }

  if (code === "subscription_sharing_user_not_eligible") {
    return {
      message: t("chatgptErrors.userNotEligible"),
      action: {
        label: t("chatgptErrors.upgradePlan"),
        url: CHATGPT_UPGRADE_PLAN_URL,
      },
    };
  }

  if (code === "subscription_sharing_invalid_user") {
    return { message: t("chatgptErrors.invalidUser") };
  }

  if (code && CHATGPT_SCOPE_ERROR_CODES.has(code)) {
    return { message: t("chatgptErrors.scopeNotAuthorized") };
  }

  if (isChatGptProvider) {
    if (code && CHATGPT_REFRESH_EXPIRED_CODES.has(code)) {
      return { message: t("chatgptErrors.refreshTokenExpired") };
    }
    if (code === "invalid_client") {
      return { message: t("chatgptErrors.invalidClient") };
    }
    if (status === 401) {
      return { message: t("chatgptErrors.invalidUser") };
    }
    if (status === 403) {
      return { message: t("chatgptErrors.policyRestricted") };
    }
    if (status === 503) {
      return { message: t("chatgptErrors.serviceUnavailable") };
    }
  }

  return { message: content.trim() };
}

export async function openTurnErrorExternalUrl(url: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const desktopBridge = (
    window as unknown as {
      spiritDesktop?: { openExternalUrl?: (request: { url: string }) => Promise<void> };
    }
  ).spiritDesktop;
  if (desktopBridge?.openExternalUrl) {
    await desktopBridge.openExternalUrl({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

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
