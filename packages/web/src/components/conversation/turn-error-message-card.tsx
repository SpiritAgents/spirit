import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  openTurnErrorExternalUrl,
  resolveLocalizedTurnError,
  TURN_ERROR_RETRYING_I18N_KEY,
} from "@/lib/conversation-turn-error-ui";
import type { MessageAuxSnapshot } from "@/types";
import { cn } from "@/lib/utils";

export function TurnErrorMessageCard({
  content,
  detail,
  retry,
  onOpenExternalUrl,
  className,
}: {
  content: string;
  detail?: MessageAuxSnapshot["turnErrorDetail"];
  retry?: MessageAuxSnapshot["turnErrorRetry"];
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  className?: string;
}) {
  const { t } = useTranslation();
  const isRetrying = retry !== undefined;
  const resolved = isRetrying
    ? {
        message: t(TURN_ERROR_RETRYING_I18N_KEY, {
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
        }),
      }
    : resolveLocalizedTurnError(content, detail, (key) => t(key));
  if (!resolved.message) {
    return null;
  }

  return (
    <div className={cn("w-full max-w-[min(32rem,100%)] py-1", className)}>
      <div
        className="flex items-center gap-3 overflow-hidden rounded-md border border-border/45 bg-muted/20 px-4 py-3"
        data-spirit-surface="turn-error-card"
        data-spirit-turn-error-retrying={isRetrying ? "true" : "false"}
      >
        {isRetrying ? (
          <Spinner className="shrink-0 self-center text-foreground" />
        ) : (
          <TriangleAlertIcon
            className="size-4 shrink-0 self-center text-foreground"
            aria-hidden
            strokeWidth={1.75}
          />
        )}
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
          {resolved.message}
        </p>
        {resolved.action ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => {
              const targetUrl = resolved.action!.url;
              if (onOpenExternalUrl) {
                void onOpenExternalUrl(targetUrl);
              } else {
                void openTurnErrorExternalUrl(targetUrl);
              }
            }}
          >
            {resolved.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
