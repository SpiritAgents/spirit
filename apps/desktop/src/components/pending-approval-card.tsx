import { Check, CornerDownLeft, MessageSquareText, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { DESKTOP_FORM_INPUT_SHELL, DESKTOP_FORM_TEXTAREA_INNER } from "@/lib/desktop-chrome";
import {
  DESKTOP_ELEVATION_SHADOW_SM,
  desktopComposerSurfaceBackdropClass,
} from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { PendingToolApprovalSnapshot } from "@/types";

type PendingApprovalCardProps = {
  pendingApproval: PendingToolApprovalSnapshot;
  approvalGuidance: string;
  approveBusy: boolean;
  useTranslucency?: boolean;
  onApprovalGuidanceChange(value: string): void;
  onSubmitApproval(decision: {
    kind: "allow" | "deny" | "guidance";
    remember?: "session" | "config";
    userMessage?: string;
  }): void;
};

export function PendingApprovalCard({
  pendingApproval,
  approvalGuidance,
  approveBusy,
  useTranslucency = false,
  onApprovalGuidanceChange,
  onSubmitApproval,
}: PendingApprovalCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      data-spirit-surface="pending-approval-card"
      className={cn(
        "gap-2 border border-ring/30 py-3 text-sm ring-0 dark:border-white/10",
        DESKTOP_ELEVATION_SHADOW_SM,
        desktopComposerSurfaceBackdropClass(useTranslucency),
      )}
    >
      {/* gap-2 compensates for the description's leading-relaxed half-leading, keeping the
          visual rhythm aligned with the 12px card padding. */}
      <CardHeader className="gap-2 px-3 py-0">
        <CardTitle className="min-w-0 truncate text-sm leading-tight">
          {pendingApproval.toolName}
        </CardTitle>
        <CardDescription className="text-xs leading-normal">
          <ScrollArea
            type="always"
            className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-24 [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
          >
            <div className="whitespace-pre-wrap">{pendingApproval.prompt}</div>
            {pendingApproval.autoReviewBlockReason ? (
              <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {t("app.autoReviewBlockReason", {
                  reason: pendingApproval.autoReviewBlockReason,
                })}
              </div>
            ) : null}
          </ScrollArea>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 px-3 pb-0 pt-0">
        <div className="grid gap-1.5">
          <Button
            size="sm"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow" })}
            disabled={approveBusy}
          >
            <Check data-icon="inline-start" />
            {t("app.allow")}
            <Kbd
              aria-label={t("composer.sendEnterKey")}
              className="ml-auto h-auto min-w-0 shrink-0 bg-transparent px-0 text-inherit opacity-70"
            >
              <CornerDownLeft className="size-3" aria-hidden />
            </Kbd>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow", remember: "config" })}
            disabled={approveBusy || !pendingApproval.rememberTarget}
          >
            <ShieldCheck data-icon="inline-start" />
            {t("app.alwaysAllow")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "deny" })}
            disabled={approveBusy}
          >
            <X data-icon="inline-start" />
            {t("app.deny")}
          </Button>
        </div>
        <div className={cn("flex min-h-9 items-stretch", DESKTOP_FORM_INPUT_SHELL)}>
          <Textarea
            value={approvalGuidance}
            onChange={(event) => onApprovalGuidanceChange(event.target.value)}
            placeholder={t("app.approvalGuidancePlaceholder")}
            className={DESKTOP_FORM_TEXTAREA_INNER}
          />
          <Button
            size="icon-sm"
            variant="outline"
            className="h-auto w-9 self-stretch rounded-none border-0 border-l border-border/60 bg-transparent text-muted-foreground shadow-none hover:bg-canvas-hover hover:text-chrome-emphasis disabled:bg-transparent"
            onClick={() =>
              onSubmitApproval({
                kind: "guidance",
                userMessage: approvalGuidance,
              })
            }
            disabled={approveBusy || approvalGuidance.trim().length === 0}
          >
            <MessageSquareText />
            <span className="sr-only">{t("app.sendGuidance")}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
