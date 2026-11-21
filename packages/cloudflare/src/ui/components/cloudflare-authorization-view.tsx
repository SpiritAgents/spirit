import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "@spiritagent/ui/button";
import { DialogFooter, DialogFooterActions } from "@spiritagent/ui/dialog";
import { Spinner } from "@spiritagent/ui/spinner";
import type { CloudflareAuthorizationState } from "../../extension.js";

export function CloudflareAuthorizationView({
  state,
  close,
  openExternal,
}: {
  state: CloudflareAuthorizationState;
  close(result?: unknown): void;
  openExternal(url: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const [externalError, setExternalError] = useState<string>();
  return (
    <div className="grid gap-4 p-4">
      <div className="flex min-h-[10rem] flex-col items-center justify-center py-2 text-center">
        {state.phase === "waiting" ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Spinner className="text-muted-foreground" />
              <span>{t("cloudflare.waiting")}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="size-8"
              aria-label={t("cloudflare.openAuthorizationPage")}
              onClick={() => {
                void openExternal(state.authorizationUrl).catch((error) =>
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
          <p className="text-sm">{t("cloudflare.connected")}</p>
        ) : null}
      </div>
      {state.phase === "error" || externalError ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {state.phase === "error" ? state.message : externalError}
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
              {t("cloudflare.disconnect")}
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
