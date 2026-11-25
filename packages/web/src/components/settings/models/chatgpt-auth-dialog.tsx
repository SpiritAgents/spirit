import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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

type ChatGptAuthPhase =
  | { phase: "loading" }
  | { phase: "waiting"; authorizationUrl: string }
  | { phase: "connected"; email?: string }
  | { phase: "error"; message: string; code?: string };

export type ChatGptAuthDialogProps = {
  providerId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBeginChatGptOAuth: (request?: BeginChatGptOAuthRequest) => Promise<BeginChatGptOAuthResponse>;
  onCompleteChatGptOAuth: (
    request: CompleteChatGptOAuthRequest,
  ) => Promise<CompleteChatGptOAuthResponse>;
  onCancelChatGptOAuth: (request: CancelChatGptOAuthRequest) => Promise<{ ok: true }>;
  onOpenExternalUrl: (url: string) => Promise<void>;
};

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

/**
 * Browser-based OAuth authorization dialog for ChatGPT, modeled on the Vercel non-Device-Flow
 * authorization view (loading -> waiting with spinner and reopen button -> connected / error).
 */
export function ChatGptAuthDialog({
  providerId = "chatgpt",
  open,
  onOpenChange,
  onBeginChatGptOAuth,
  onCompleteChatGptOAuth,
  onCancelChatGptOAuth,
  onOpenExternalUrl,
}: ChatGptAuthDialogProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ChatGptAuthPhase>({ phase: "loading" });
  const [externalError, setExternalError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const promptConsentNextRef = useRef(false);

  const cancelActiveSession = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      return;
    }
    activeSessionIdRef.current = undefined;
    void onCancelChatGptOAuth({ sessionId }).catch(() => undefined);
  }, [onCancelChatGptOAuth]);

  useEffect(() => {
    if (!open) {
      cancelActiveSession();
      return;
    }

    let cancelled = false;
    const runAttempt = attempt;

    void (async () => {
      try {
        void runAttempt;
        const promptConsent = promptConsentNextRef.current;
        promptConsentNextRef.current = false;
        const begun = await onBeginChatGptOAuth({
          providerId,
          ...(promptConsent ? { promptConsent: true } : {}),
        });
        if (cancelled) {
          void onCancelChatGptOAuth({ sessionId: begun.sessionId }).catch(() => undefined);
          return;
        }
        activeSessionIdRef.current = begun.sessionId;
        setState({ phase: "waiting", authorizationUrl: begun.authorizationUrl });

        const completed = await onCompleteChatGptOAuth({ sessionId: begun.sessionId });
        if (activeSessionIdRef.current === begun.sessionId) {
          activeSessionIdRef.current = undefined;
        }
        if (cancelled) {
          return;
        }
        if (completed.phase === "connected") {
          setState({
            phase: "connected",
            ...(completed.email ? { email: completed.email } : {}),
          });
          onOpenChange(false);
          return;
        }
        if (completed.code === "chatpass_v2_scope_not_authorized") {
          promptConsentNextRef.current = true;
        }
        setState({
          phase: "error",
          ...(completed.code ? { code: completed.code } : {}),
          message: localizedAuthError(completed.code, completed.message, (key) => t(key)),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : t("chatgptAuth.errorGeneric"),
        });
      }
    })();

    return () => {
      cancelled = true;
      cancelActiveSession();
    };
  }, [
    attempt,
    cancelActiveSession,
    onBeginChatGptOAuth,
    onCancelChatGptOAuth,
    onCompleteChatGptOAuth,
    onOpenChange,
    open,
    providerId,
    t,
  ]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      cancelActiveSession();
    }
    onOpenChange(nextOpen);
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
                  onClick={() => {
                    setExternalError(undefined);
                    void onOpenExternalUrl(state.authorizationUrl).catch((error) =>
                      setExternalError(String(error)),
                    );
                  }}
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
                    setState({ phase: "loading" });
                    setAttempt((count) => count + 1);
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
