import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { ExternalLink } from "lucide-react";
import { Button } from "@spiritagent/ui/button";
import { DialogFooter, DialogFooterActions } from "@spiritagent/ui/dialog";
import type { GitHubAuthorizationState } from "../../extension.js";
export function GitHubAuthorizationView({
  state,
  close,
  openExternal,
}: {
  state: GitHubAuthorizationState;
  close(result?: unknown): void;
  openExternal(url: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const [externalError, setExternalError] = useState<string>();
  return (
    <div className="grid gap-4 p-4">
      <div className="flex min-h-[10rem] flex-col items-center justify-center py-2 text-center">
        {state.phase === "challenge" ? (
          <div className="space-y-4">
            <p
              data-spirit-selectable="text"
              className="text-3xl tracking-widest font-medium text-foreground"
            >
              {state.userCode}
            </p>
            <p className="text-xs text-muted-foreground">{t("github.waiting")}</p>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="size-8"
              aria-label={t("github.openDevicePage")}
              onClick={() => {
                void openExternal(state.verificationUri).catch((error) =>
                  setExternalError(String(error)),
                );
              }}
            >
              <ExternalLink className="size-4" aria-hidden strokeWidth={1.75} />
            </Button>
          </div>
        ) : state.phase === "loading" ? (
          <LoaderCircle
            className="size-8 animate-spin text-muted-foreground"
            aria-hidden
            strokeWidth={1.75}
          />
        ) : state.phase === "connected" ? (
          <p className="text-sm">{t("github.connectedAs", { login: state.login })}</p>
        ) : null}
      </div>
      {state.phase === "error" || externalError ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {state.phase === "error"
            ? state.unavailable
              ? t("github.oauthUnavailable")
              : state.message
            : externalError}
        </p>
      ) : null}
      {/* The page viewport is the dialog width, not the Desktop viewport. Keep the native desktop layout. */}
      <DialogFooter className="flex-row justify-end">
        <DialogFooterActions className="flex-row items-center justify-end">
          {state.phase === "connected" || (state.phase === "error" && state.canDisconnect) ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => close({ disconnect: true })}
            >
              {t("github.disconnect")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => close({ dismissed: true })}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooterActions>
      </DialogFooter>
    </div>
  );
}
