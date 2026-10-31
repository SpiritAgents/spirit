import { X } from "@spiritagent/icons/x";
import { Check } from "@spiritagent/icons/check";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHostApi } from "@/hooks/useHostApi";
import { clickableToolCardTriggerClass } from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type { WorkspaceCapabilityTrustDecision, WorkspaceCapabilityTrustRequest } from "@/types";

export type WorkspaceCapabilityTrustDialogProps = {
  pending: WorkspaceCapabilityTrustRequest | undefined;
  busy?: boolean;
  onReply(decision: WorkspaceCapabilityTrustDecision): void;
};

export function WorkspaceCapabilityTrustDialog({
  pending,
  busy = false,
  onReply,
}: WorkspaceCapabilityTrustDialogProps) {
  // Keep the last request rendered while the close animation plays: visibility
  // and payload are decoupled (same pattern as the sidebar delete dialog).
  const [displayed, setDisplayed] = useState(pending);
  const [open, setOpen] = useState(pending !== undefined);

  useEffect(() => {
    if (pending !== undefined) {
      setDisplayed(pending);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [pending]);

  return (
    <Dialog open={open}>
      <DialogContent
        className="outline-none sm:max-w-lg"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget;
          if (content instanceof HTMLElement) {
            content.focus({ preventScroll: true });
          }
        }}
      >
        {displayed !== undefined ? (
          <WorkspaceCapabilityTrustDialogBody pending={displayed} busy={busy} onReply={onReply} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceCapabilityTrustDialogBody({
  pending,
  busy,
  onReply,
}: {
  pending: WorkspaceCapabilityTrustRequest;
  busy: boolean;
  onReply(decision: WorkspaceCapabilityTrustDecision): void;
}) {
  const { t } = useTranslation();
  const { api } = useHostApi();
  const hasHooks = pending.hooks.length > 0;
  const tasks = pending.tasks;
  const hasTasks = (tasks?.items.length ?? 0) > 0;
  const riskKey = hasHooks
    ? hasTasks
      ? "workspaceTrust.riskBoth"
      : "workspaceTrust.risk"
    : "workspaceTrust.riskTasks";
  const openPathInDefaultApp = api?.openPathInDefaultApp;
  const hooksChanged = hasHooks && pending.hashChanged;
  const tasksChanged = hasTasks && tasks?.hashChanged === true;
  const bannerKey = hooksChanged
    ? tasksChanged
      ? "workspaceTrust.bothChanged"
      : "workspaceTrust.hooksChanged"
    : tasksChanged
      ? "workspaceTrust.tasksChanged"
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("workspaceTrust.title")}</DialogTitle>
        <DialogDescription>{t(riskKey)}</DialogDescription>
      </DialogHeader>

      {bannerKey ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
        >
          {t(bannerKey)}
        </div>
      ) : null}

      {hasHooks ? (
        <div className="grid gap-1.5">
          {hasTasks ? (
            <div className="text-xs font-normal text-muted-foreground">
              {t("workspaceTrust.hooksSection")}
            </div>
          ) : null}
          <ScrollArea type="always" className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-40">
            <ul className="grid gap-1.5">
              {pending.hooks.map((hook) => {
                const canOpen = Boolean(openPathInDefaultApp && hook.resolvedPath);
                return (
                  <li key={`${hook.event}:${hook.command}`}>
                    <button
                      type="button"
                      disabled={!canOpen || busy}
                      title={t("workspaceTrust.openHookScript")}
                      className={cn(
                        "w-full min-w-0 rounded-md border border-border/40 bg-muted/15 px-2.5 py-2 text-left outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring/50",
                        canOpen && "cursor-pointer",
                        canOpen && clickableToolCardTriggerClass,
                      )}
                      onClick={() => {
                        if (!openPathInDefaultApp || !hook.resolvedPath) {
                          return;
                        }
                        void openPathInDefaultApp(hook.resolvedPath);
                      }}
                    >
                      <div className="text-xs font-normal text-foreground/80">{hook.event}</div>
                      <div
                        data-spirit-selectable="text"
                        className="break-all font-mono text-[0.65rem] text-muted-foreground"
                      >
                        {hook.command}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>
      ) : null}

      {tasks !== undefined && hasTasks ? (
        <div className="grid gap-1.5">
          {hasHooks ? (
            <div className="text-xs font-normal text-muted-foreground">
              {t("workspaceTrust.tasksSection")}
            </div>
          ) : null}
          <ScrollArea type="always" className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-40">
            <ul className="grid gap-1.5">
              {tasks.items.map((item) => {
                const canOpen = Boolean(openPathInDefaultApp);
                return (
                  <li key={`${item.sourcePath}:${item.label}`}>
                    <button
                      type="button"
                      disabled={!canOpen || busy}
                      title={t("workspaceTrust.openTaskFile")}
                      className={cn(
                        "w-full min-w-0 rounded-md border border-border/40 bg-muted/15 px-2.5 py-2 text-left outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring/50",
                        canOpen && "cursor-pointer",
                        canOpen && clickableToolCardTriggerClass,
                      )}
                      onClick={() => {
                        if (!openPathInDefaultApp) {
                          return;
                        }
                        void openPathInDefaultApp(item.sourcePath);
                      }}
                    >
                      <div className="text-xs font-normal text-foreground/80">{item.label}</div>
                      <div
                        data-spirit-selectable="text"
                        className="break-all font-mono text-[0.65rem] text-muted-foreground"
                      >
                        {item.command}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>
      ) : null}

      <DialogFooter>
        <DialogFooterActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onReply("deny")}
          >
            <X data-icon="inline-start" strokeWidth={1.75} />
            {t("workspaceTrust.deny")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onReply("alwaysTrust")}
          >
            <ShieldCheck data-icon="inline-start" strokeWidth={1.75} />
            {t("workspaceTrust.alwaysTrust")}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => onReply("allowOnce")}>
            <Check data-icon="inline-start" strokeWidth={1.75} />
            {t("workspaceTrust.allowOnce")}
          </Button>
        </DialogFooterActions>
      </DialogFooter>
    </>
  );
}
