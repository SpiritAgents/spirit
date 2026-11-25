import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CUSTOM_PROVIDER_PRESET_ID,
  findProviderPreset,
} from "@spiritagent/agent-core/provider-presets";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type {
  BeginChatGptOAuthRequest,
  BeginChatGptOAuthResponse,
  CancelChatGptOAuthRequest,
  CompleteChatGptOAuthRequest,
  CompleteChatGptOAuthResponse,
} from "@spiritagent/api/types";

export type ChatGptAuthPhase =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected"; email?: string }
  | { phase: "error"; message: string; code?: string };

export function isChatGptOAuthProvider(providerId: string): boolean {
  if (providerId === CUSTOM_PROVIDER_PRESET_ID) {
    return false;
  }
  return findProviderPreset(providerId)?.credentials.kind === "chatgpt-oauth";
}

function localizedAuthError(
  code: string | undefined,
  fallbackMessage: string,
  t: (key: string) => string,
): string {
  switch (code) {
    case "timeout":
      return t("chatgptAuth.errorTimeout");
    case "cancelled":
      return t("chatgptAuth.errorCancelled");
    case "access_denied":
      return t("chatgptAuth.errorDenied");
    case "chatpass_v2_scope_not_authorized":
      return t("chatgptAuth.errorMissingPlanScope");
    case "invalid_client":
      return t("chatgptAuth.errorInvalidClient");
    default:
      return fallbackMessage.trim() || t("chatgptAuth.errorGeneric");
  }
}

export interface UseChatGptOAuthDialogInput {
  onBeginChatGptOAuth?: (request?: BeginChatGptOAuthRequest) => Promise<BeginChatGptOAuthResponse>;
  onCompleteChatGptOAuth?: (
    request: CompleteChatGptOAuthRequest,
  ) => Promise<CompleteChatGptOAuthResponse>;
  onCancelChatGptOAuth?: (request: CancelChatGptOAuthRequest) => Promise<{ ok: true }>;
}

/**
 * Event-driven controller for the ChatGPT browser OAuth flow.
 *
 * Starting authorization in user click handlers (`start` / `retry`) instead of a mount `useEffect`
 * ensures React StrictMode double-invocations and parent re-renders never launch duplicate browser
 * tabs or supersede an active loopback listener.
 */
export function useChatGptOAuthDialog({
  onBeginChatGptOAuth,
  onCompleteChatGptOAuth,
  onCancelChatGptOAuth,
}: UseChatGptOAuthDialogInput) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ChatGptAuthPhase>({ phase: "loading" });

  const providerIdRef = useRef("chatgpt");
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const runIdRef = useRef(0);
  const promptConsentNextRef = useRef(false);

  const callbacksRef = useRef({
    onBeginChatGptOAuth,
    onCompleteChatGptOAuth,
    onCancelChatGptOAuth,
    t,
  });
  useEffect(() => {
    callbacksRef.current = {
      onBeginChatGptOAuth,
      onCompleteChatGptOAuth,
      onCancelChatGptOAuth,
      t,
    };
  }, [onBeginChatGptOAuth, onCancelChatGptOAuth, onCompleteChatGptOAuth, t]);

  const cancelActiveSession = useCallback(() => {
    runIdRef.current += 1;
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      return;
    }
    activeSessionIdRef.current = undefined;
    void callbacksRef.current.onCancelChatGptOAuth?.({ sessionId }).catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      // Only cancels if a user-initiated OAuth session is actually active; initial StrictMode
      // mount/unmount has no active session and is a no-op.
      if (activeSessionIdRef.current !== undefined) {
        cancelActiveSession();
      }
    };
  }, [cancelActiveSession]);

  const launchAttempt = useCallback((providerId: string, promptConsent: boolean) => {
    const {
      onBeginChatGptOAuth: begin,
      onCompleteChatGptOAuth: complete,
      onCancelChatGptOAuth: cancel,
      t: translate,
    } = callbacksRef.current;

    runIdRef.current += 1;
    const runId = runIdRef.current;
    const previousSessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = undefined;
    if (previousSessionId) {
      void cancel?.({ sessionId: previousSessionId }).catch(() => undefined);
    }

    providerIdRef.current = providerId;
    setOpen(true);

    if (!begin || !complete) {
      setState({
        phase: "error",
        message: translate("chatgptAuth.errorGeneric"),
      });
      return;
    }

    setState({ phase: "loading" });

    void (async () => {
      try {
        const begun = await begin({
          providerId,
          ...(promptConsent ? { promptConsent: true } : {}),
        });
        if (runId !== runIdRef.current) {
          void callbacksRef.current
            .onCancelChatGptOAuth?.({ sessionId: begun.sessionId })
            .catch(() => undefined);
          return;
        }
        activeSessionIdRef.current = begun.sessionId;
        setState({ phase: "waiting", authorizationUrl: begun.authorizationUrl });

        const completed = await callbacksRef.current.onCompleteChatGptOAuth!({
          sessionId: begun.sessionId,
        });
        if (activeSessionIdRef.current === begun.sessionId) {
          activeSessionIdRef.current = undefined;
        }
        if (runId !== runIdRef.current) {
          return;
        }
        if (completed.phase === "connected") {
          promptConsentNextRef.current = false;
          setState({
            phase: "connected",
            ...(completed.email ? { email: completed.email } : {}),
          });
          setOpen(false);
          return;
        }
        if (completed.code === "chatpass_v2_scope_not_authorized") {
          promptConsentNextRef.current = true;
        }
        setState({
          phase: "error",
          ...(completed.code ? { code: completed.code } : {}),
          message: localizedAuthError(completed.code, completed.message, (key) =>
            callbacksRef.current.t(key),
          ),
        });
      } catch (error) {
        if (runId !== runIdRef.current) {
          return;
        }
        setState({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : callbacksRef.current.t("chatgptAuth.errorGeneric"),
        });
      }
    })();
  }, []);

  const start = useCallback(
    (providerId = "chatgpt") => {
      promptConsentNextRef.current = false;
      launchAttempt(providerId, false);
    },
    [launchAttempt],
  );

  const retry = useCallback(() => {
    const promptConsent = promptConsentNextRef.current;
    promptConsentNextRef.current = false;
    launchAttempt(providerIdRef.current, promptConsent);
  }, [launchAttempt]);

  const close = useCallback(() => {
    cancelActiveSession();
    setOpen(false);
  }, [cancelActiveSession]);

  return {
    open,
    state,
    start,
    retry,
    close,
  };
}

export type ChatGptAuthDialogProps = {
  open: boolean;
  state: ChatGptAuthPhase;
  onClose: () => void;
  onRetry: () => void;
  onOpenExternalUrl?: (url: string) => Promise<void>;
};

/**
 * Pure presentational browser OAuth dialog for ChatGPT, modeled on the Vercel non-Device-Flow
 * authorization view (loading -> waiting with spinner and reopen button -> connected / error).
 */
export function ChatGptAuthDialog({
  open,
  state,
  onClose,
  onRetry,
  onOpenExternalUrl,
}: ChatGptAuthDialogProps) {
  const { t } = useTranslation();
  const [externalError, setExternalError] = useState<string>();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setExternalError(undefined);
      onClose();
    }
  };

  const reopenExternalUrl = (url: string) => {
    setExternalError(undefined);
    if (onOpenExternalUrl) {
      void onOpenExternalUrl(url).catch((error) => setExternalError(String(error)));
      return;
    }
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("chatgptAuth.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex min-h-[10rem] flex-col items-center justify-center py-2 text-center">
            {state.phase === "waiting" ? (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Spinner className="text-muted-foreground" />
                  <span>{t("chatgptAuth.waiting")}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-8"
                  aria-label={t("chatgptAuth.openAuthorizationPage")}
                  onClick={() => reopenExternalUrl(state.authorizationUrl)}
                >
                  <ExternalLink className="size-4" aria-hidden strokeWidth={1.75} />
                </Button>
              </div>
            ) : state.phase === "loading" ? (
              <Spinner className="size-8 text-muted-foreground" />
            ) : state.phase === "connected" ? (
              <p className="text-sm">
                {state.email
                  ? t("chatgptAuth.connectedAs", { email: state.email })
                  : t("chatgptAuth.connected")}
              </p>
            ) : null}
          </div>
          {state.phase === "error" || externalError ? (
            <p role="alert" className="text-center text-sm text-destructive">
              {state.phase === "error" ? state.message : externalError}
            </p>
          ) : null}
          <DialogFooter className="flex-row justify-end">
            <DialogFooterActions className="flex-row items-center justify-end">
              {state.phase === "error" ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setExternalError(undefined);
                    onRetry();
                  }}
                >
                  {t("chatgptAuth.retry")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
