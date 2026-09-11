import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DESKTOP_ITEM_CARD_HOVER_BORDER,
  DESKTOP_ITEM_CARD_SURFACE,
  DESKTOP_OUTLINE_FILL_HOVER,
} from "@/lib/desktop-chrome";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { EmptyCard } from "@/components/ui/empty";
import type { DesktopAutomationListItem, DesktopSnapshot } from "@/types";
import { buildAutomationTriggerFormatLabels } from "@/lib/automation-trigger-i18n";
import { formatDesktopAutomationTriggerLabel } from "@/lib/automation-trigger";
import { cn } from "@/lib/utils";

type AutomationsViewProps = {
  snapshot: DesktopSnapshot | null;
  apiReady: boolean;
  busyAction: string;
  githubConnected: boolean;
  onCreateAutomation: () => void;
  onGenerateAutomation: () => void;
  onOpenAutomation: (automationId: string) => void;
  onDeleteAutomation?: (automationId: string) => void | Promise<void>;
};

export function AutomationsView({
  snapshot,
  apiReady,
  busyAction,
  githubConnected,
  onCreateAutomation,
  onGenerateAutomation,
  onOpenAutomation,
  onDeleteAutomation,
}: AutomationsViewProps) {
  const { t } = useTranslation();
  const items = snapshot?.automationsList ?? [];
  const automationBusy = busyAction === "automation";
  const generateBusy = busyAction === "reset";
  const canDeleteAutomation = Boolean(onDeleteAutomation) && apiReady && !automationBusy;

  const [contextMenuAutomation, setContextMenuAutomation] =
    useState<DesktopAutomationListItem | null>(null);
  const contextMenuAutomationRef = useRef<DesktopAutomationListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesktopAutomationListItem | null>(null);

  const automationById = useMemo(() => {
    const map = new Map<string, DesktopAutomationListItem>();
    for (const item of items) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  const handleAutomationContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest("[data-automation-id]");
      if (!row) {
        event.preventDefault();
        return;
      }
      const automationId = row.getAttribute("data-automation-id");
      const automation = automationId ? automationById.get(automationId) : undefined;
      if (!automation) {
        event.preventDefault();
        return;
      }
      contextMenuAutomationRef.current = automation;
      setContextMenuAutomation(automation);
    },
    [automationById],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      contextMenuAutomationRef.current = null;
      setContextMenuAutomation(null);
    }
  }, []);

  const handleContextMenuDelete = useCallback((automation: DesktopAutomationListItem) => {
    contextMenuAutomationRef.current = null;
    setContextMenuAutomation(null);
    setDeleteTarget(automation);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Shares the conversation message list's max width and gutter: full width up to
          the cap, then proportional side margins on narrower windows. */}
      <div
        className={cn(
          "mx-auto flex w-full min-h-0 flex-1 flex-col py-8",
          CONVERSATION_GUTTER_X,
          CONVERSATION_MESSAGE_LIST_MAX_W,
        )}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("automations.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("automations.subtitle")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={!apiReady || automationBusy || generateBusy}
                title={t("automations.generateTooltip")}
                onClick={onGenerateAutomation}
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
                {t("automations.generate")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={!apiReady || automationBusy}
                onClick={onCreateAutomation}
              >
                {t("automations.create")}
              </Button>
            </div>
          </div>

          <AutomationListNav
            canDeleteAutomation={canDeleteAutomation}
            contextMenuAutomation={contextMenuAutomation}
            contextMenuAutomationRef={contextMenuAutomationRef}
            deleteAutomationBusy={automationBusy}
            onAutomationContextMenuCapture={handleAutomationContextMenuCapture}
            onContextMenuOpenChange={handleContextMenuOpenChange}
            onRequestDelete={handleContextMenuDelete}
          >
            {items.length === 0 ? (
              <EmptyCard>{t("automations.empty")}</EmptyCard>
            ) : (
              <div
                className={cn(
                  DESKTOP_ITEM_CARD_SURFACE,
                  "divide-y divide-border/35 overflow-hidden",
                  DESKTOP_ITEM_CARD_HOVER_BORDER,
                )}
              >
                {items.map((item) => (
                  <AutomationListRow
                    key={item.id}
                    item={item}
                    githubConnected={githubConnected}
                    onOpen={() => onOpenAutomation(item.id)}
                  />
                ))}
              </div>
            )}
          </AutomationListNav>
        </div>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title={t("automations.deleteAutomationConfirmTitle", { name: deleteTarget?.title ?? "" })}
        description={t("automations.deleteAutomationConfirmDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={automationBusy}
        onConfirm={async () => {
          const target = deleteTarget;
          if (!target || !onDeleteAutomation) {
            return;
          }
          await onDeleteAutomation(target.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

type AutomationListNavProps = {
  canDeleteAutomation: boolean;
  contextMenuAutomation: DesktopAutomationListItem | null;
  contextMenuAutomationRef: RefObject<DesktopAutomationListItem | null>;
  deleteAutomationBusy?: boolean;
  onAutomationContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenuOpenChange(open: boolean): void;
  onRequestDelete(automation: DesktopAutomationListItem): void;
  children: ReactNode;
};

function AutomationListNav({
  canDeleteAutomation,
  contextMenuAutomation,
  contextMenuAutomationRef,
  deleteAutomationBusy,
  onAutomationContextMenuCapture,
  onContextMenuOpenChange,
  onRequestDelete,
  children,
}: AutomationListNavProps) {
  const { t } = useTranslation();

  const list = (
    <div onContextMenuCapture={canDeleteAutomation ? onAutomationContextMenuCapture : undefined}>
      {children}
    </div>
  );

  if (!canDeleteAutomation) {
    return list;
  }

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>{list}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("automations.listActions")}>
        <ContextMenuItem
          variant="destructive"
          disabled={deleteAutomationBusy}
          onSelect={() => {
            const automation = contextMenuAutomationRef.current ?? contextMenuAutomation;
            if (automation) {
              onRequestDelete(automation);
            }
          }}
        >
          <Trash2 aria-hidden />
          {t("automations.deleteAutomation")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AutomationListRow({
  item,
  githubConnected,
  onOpen,
}: {
  item: DesktopAutomationListItem;
  githubConnected: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const triggerLabel = item.trigger
    ? formatDesktopAutomationTriggerLabel(item.trigger, buildAutomationTriggerFormatLabels(t))
    : item.scheduleLabel;

  return (
    <button
      type="button"
      data-automation-id={item.id}
      onClick={onOpen}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-4 text-left",
        DESKTOP_OUTLINE_FILL_HOVER,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-normal text-foreground">{item.title}</span>
        {!item.enabled ? (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("automations.disabled")}
          </span>
        ) : null}
        {!githubConnected && item.trigger?.kind === "github" ? (
          <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
            {t("automations.githubDisconnectedPause")}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{triggerLabel}</p>
      {item.githubPollError ? (
        <p className="text-xs text-destructive">{item.githubPollError}</p>
      ) : null}
    </button>
  );
}
