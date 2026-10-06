import { X } from "@spiritagent/icons/x";
import { Check } from "@spiritagent/icons/check";
import { ArrowUp, CircleAlert, CornerDownLeft, ShieldCheck } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { DirectoryListPreview } from "@/components/directory-list-preview";
import {
  JsonToolArgumentsHighlight,
  ShellToolCommandHighlight,
} from "@/components/shell-tool-command-highlight";
import { FileContentPreviewFrame } from "@/components/file-content-preview-frame";
import { FileDiffPreviewFrame } from "@/components/file-diff-preview-frame";
import { APPROVAL_LEVEL_ICONS } from "@/components/approval-level-menu";
import { ComposerSendEnterKbd } from "@/components/composer/composer-shortcut-kbds";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  /** Hides the auto-review / hook reason note under the title (approval demo gallery toggle). */
  hideReasonNotes?: boolean;
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
  hideReasonNotes = false,
  onApprovalGuidanceChange,
  onSubmitApproval,
}: PendingApprovalCardProps) {
  const { t } = useTranslation();
  const shellCommand = pendingApproval.shellCommand?.trim() || undefined;
  const mcpToolCallArgumentsJson = pendingApproval.mcpToolCallArgumentsJson?.trim() || undefined;
  const guidanceSendDisabled = approveBusy || approvalGuidance.trim().length === 0;
  const automationApprovalLevel = pendingApproval.automationApprovalLevel;
  const AutomationLevelIcon = automationApprovalLevel
    ? APPROVAL_LEVEL_ICONS[automationApprovalLevel]
    : ShieldCheck;
  const automationLevelLabel =
    automationApprovalLevel === "auto-approval"
      ? t("composer.approvalAuto")
      : automationApprovalLevel === "bypass-approval"
        ? t("composer.approvalBypass")
        : t("composer.approvalDefault");

  const handleGuidanceKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (!guidanceSendDisabled) {
      onSubmitApproval({ kind: "guidance", userMessage: approvalGuidance });
    }
  };

  // Same send affordance as the composer send button (ArrowUp + Enter kbd tooltip), minus the
  // abort state: this button only ever sends guidance.
  const guidanceSendButton = (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className="h-auto w-8 self-stretch rounded-none border-0 border-l border-border/60 bg-transparent text-muted-foreground shadow-none hover:bg-canvas-hover hover:text-chrome-emphasis disabled:bg-transparent"
      onClick={() =>
        onSubmitApproval({
          kind: "guidance",
          userMessage: approvalGuidance,
        })
      }
      disabled={guidanceSendDisabled}
      aria-label={t("app.sendGuidance")}
    >
      {/* Same weight as the composer send icon: both are the send affordance. */}
      <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
    </Button>
  );

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
        {automationApprovalLevel === undefined && !hideReasonNotes ? (
          <ApprovalReasonNotes pendingApproval={pendingApproval} />
        ) : null}
        {automationApprovalLevel !== undefined ? (
          <>
            {/* Automation approvals: the body is the overview verbatim (dialog proportions:
                title text-lg → overview text-sm maps to card title text-sm → text-xs), with the
                reason notes and the run approval level on their own lines below it so the
                title/body rhythm stays intact. */}
            {pendingApproval.prompt.trim() ? (
              <CardDescription className="text-xs leading-relaxed text-foreground">
                <ScrollArea
                  type="always"
                  className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-24 [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
                >
                  <div className="whitespace-pre-wrap">{pendingApproval.prompt}</div>
                </ScrollArea>
              </CardDescription>
            ) : null}
            {!hideReasonNotes ? <ApprovalReasonNotes pendingApproval={pendingApproval} /> : null}
            <div className="flex items-start gap-1.5 text-xs leading-normal text-muted-foreground">
              {/* Icon inherits the row's muted color, matching the reason note's CircleAlert. */}
              <AutomationLevelIcon
                strokeWidth={1.75}
                className="mt-[3px] size-3 shrink-0"
                aria-hidden
              />
              <div className="min-w-0">{automationLevelLabel}</div>
            </div>
          </>
        ) : pendingApproval.fileDiffPreviews?.length ? (
          // flex-col (not grid): a grid's implicit auto track sizes to the frame's max-content
          // and would blow past the card; the flex column follows the card width and lets the
          // frame's overflow-x-auto scroll long lines instead.
          <CardDescription className="flex min-w-0 flex-col gap-2 text-xs leading-normal">
            {pendingApproval.fileDiffPreviews.map((preview) => (
              <FileDiffPreviewFrame key={preview.relativePath} {...preview} />
            ))}
          </CardDescription>
        ) : pendingApproval.fileContentPreview ? (
          <CardDescription className="flex min-w-0 flex-col gap-2 text-xs leading-normal">
            {pendingApproval.fileContentPreview.directory ? (
              // ls: a bare listing box — no frame chrome, so it reads as "these entries come
              // back", not "the directory gets uploaded".
              <DirectoryListPreview content={pendingApproval.fileContentPreview.content} />
            ) : (
              <FileContentPreviewFrame {...pendingApproval.fileContentPreview} />
            )}
          </CardDescription>
        ) : shellCommand ? (
          <CardDescription className="text-xs leading-normal">
            {/* Same border/size as the message-list shell card detail, but no fill so it blends
                into the card; capped like the file frames so long scripts scroll instead of
                stretching the card. */}
            <div className="max-h-[min(420px,50vh)] overflow-auto rounded-md border border-border/20 p-2">
              <ShellToolCommandHighlight command={shellCommand} />
            </div>
          </CardDescription>
        ) : mcpToolCallArgumentsJson ? (
          <CardDescription className="text-xs leading-normal">
            {/* MCP arguments reuse the shell command card shell, highlighted as JSON. */}
            <div className="max-h-[min(420px,50vh)] overflow-auto rounded-md border border-border/20 p-2">
              <JsonToolArgumentsHighlight argumentsJson={mcpToolCallArgumentsJson} />
            </div>
          </CardDescription>
        ) : pendingApproval.prompt.trim() && !pendingApproval.hookMessage ? (
          <CardDescription className="text-xs leading-normal">
            <ScrollArea
              type="always"
              className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-24 [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
            >
              <div className="whitespace-pre-wrap">{pendingApproval.prompt}</div>
            </ScrollArea>
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2 px-3 pb-0 pt-0">
        <div className="grid gap-1.5">
          <Button
            size="sm"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow" })}
            disabled={approveBusy}
          >
            <Check data-icon="inline-start" strokeWidth={1.75} />
            {t("app.allow")}
            <Kbd
              aria-label={t("composer.sendEnterKey")}
              className="ml-auto h-auto min-w-0 shrink-0 bg-transparent px-0 text-inherit"
            >
              <CornerDownLeft className="size-3" aria-hidden strokeWidth={1.75} />
            </Kbd>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow", remember: "config" })}
            disabled={approveBusy || !pendingApproval.rememberTarget}
          >
            <ShieldCheck data-icon="inline-start" strokeWidth={1.75} />
            {t("app.alwaysAllow")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "deny" })}
            disabled={approveBusy}
          >
            <X data-icon="inline-start" strokeWidth={1.75} />
            {t("app.deny")}
          </Button>
        </div>
        <div className={cn("flex min-h-8 items-stretch", DESKTOP_FORM_INPUT_SHELL)}>
          <Textarea
            value={approvalGuidance}
            onChange={(event) => onApprovalGuidanceChange(event.target.value)}
            onKeyDown={handleGuidanceKeyDown}
            placeholder={t("app.approvalGuidancePlaceholder")}
            className={DESKTOP_FORM_TEXTAREA_INNER}
          />
          {guidanceSendDisabled ? (
            guidanceSendButton
          ) : (
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>{guidanceSendButton}</TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {t("app.send")} <ComposerSendEnterKbd />
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovalReasonNotes({
  pendingApproval,
}: {
  pendingApproval: PendingToolApprovalSnapshot;
}) {
  return (
    <>
      {pendingApproval.autoReviewBlockReason ? (
        <div className="flex items-start gap-1.5 text-xs leading-normal text-muted-foreground">
          <CircleAlert strokeWidth={1.75} className="mt-[3px] size-3 shrink-0" aria-hidden />
          <div className="min-w-0 whitespace-pre-wrap">{pendingApproval.autoReviewBlockReason}</div>
        </div>
      ) : null}
      {pendingApproval.hookMessage ? (
        <div className="flex items-start gap-1.5 text-xs leading-normal text-muted-foreground">
          <CircleAlert strokeWidth={1.75} className="mt-[3px] size-3 shrink-0" aria-hidden />
          <div className="min-w-0 whitespace-pre-wrap">{pendingApproval.hookMessage}</div>
        </div>
      ) : null}
    </>
  );
}
