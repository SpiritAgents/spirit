import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Sparkles } from "lucide-react";
import { product } from "@spiritagent/product";

import { InstructionLocationFields } from "@/components/settings/instruction-location-fields";
import { SettingsListItemHeading } from "@/components/settings/settings-list-item-heading";
import { EmptyCard } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { RovingFocusGroup, RovingFocusItem } from "@/components/ui/roving-focus-group";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DESKTOP_SETTINGS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import type {
  DeleteHookEntryRequest,
  DesktopHookEventName,
  DesktopHookListItem,
  DesktopHookScope,
  DesktopSnapshot,
  DesktopWorkspaceBinding,
  SaveHookEntryRequest,
} from "@/types";

const HOOK_EVENTS: DesktopHookEventName[] = [
  "sessionStart",
  "sessionEnd",
  "submitPrompt",
  "preToolUse",
  "postToolUse",
  "subagentStart",
  "subagentEnd",
];

type HooksSettingsPanelProps = {
  snapshot: DesktopSnapshot | null;
  hooksBusy?: boolean;
  apiReady?: boolean;
  workspaceBinding: DesktopWorkspaceBinding;
  onSaveHookEntry(request: SaveHookEntryRequest): void | Promise<void>;
  onDeleteHookEntry(request: DeleteHookEntryRequest): void | Promise<void>;
  onGenerateHookNavigate?: () => void;
};

export function HooksSettingsPanel({
  snapshot,
  hooksBusy,
  apiReady,
  workspaceBinding,
  onSaveHookEntry,
  onDeleteHookEntry,
  onGenerateHookNavigate,
}: HooksSettingsPanelProps) {
  const { t } = useTranslation();
  const workspaceBindingDisabled = workspaceBinding === "none";
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DesktopHookListItem | null>(null);
  const [createScope, setCreateScope] = useState<DesktopHookScope>(
    workspaceBindingDisabled ? "user" : "workspace",
  );
  const [event, setEvent] = useState<DesktopHookEventName>("preToolUse");
  const [command, setCommand] = useState("hooks/log-hook.sh");
  const [timeout, setTimeoutValue] = useState("30");
  const [matcher, setMatcher] = useState("");
  const [failClosed, setFailClosed] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      (snapshot?.hooksList ?? []).filter(
        (item) => !workspaceBindingDisabled || item.scope === "user",
      ),
    [snapshot?.hooksList, workspaceBindingDisabled],
  );

  const resetForm = () => {
    setCreateScope(workspaceBindingDisabled ? "user" : "workspace");
    setEvent("preToolUse");
    setCommand("hooks/log-hook.sh");
    setTimeoutValue("30");
    setMatcher("");
    setFailClosed(false);
  };

  async function handleCreate() {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }
    const parsedTimeout = timeout.trim() ? Number(timeout) : undefined;
    if (parsedTimeout !== undefined && (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0)) {
      setCreateError(t("settings.hooksTimeoutInvalid"));
      return;
    }
    setCreateError(null);
    try {
      await onSaveHookEntry({
        scope: createScope,
        event,
        command: trimmedCommand,
        ...(parsedTimeout !== undefined && Number.isFinite(parsedTimeout)
          ? { timeout: parsedTimeout }
          : {}),
        ...(matcher.trim() ? { matcher: matcher.trim() } : {}),
        ...(failClosed ? { failClosed: true } : {}),
      });
      setAddDialogOpen(false);
      resetForm();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("settings.hooksSaveFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.hooks")}</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t("app.noWorkspaceBindingHint")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateHookNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title={t("settings.generateHookTooltip")}
              onClick={() => onGenerateHookNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
              {t("settings.generateHook")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={hooksBusy}
            onClick={() => {
              resetForm();
              setAddDialogOpen(true);
            }}
          >
            {t("settings.hooksAdd")}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyCard
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          icon={<Code2 strokeWidth={1.75} />}
          title={t("settings.hooksEmpty")}
        />
      ) : (
        <RovingFocusGroup
          orientation="vertical"
          className={cn(DESKTOP_SETTINGS_CARD_SURFACE, "divide-y divide-settings-card-divider")}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <SettingsListItemHeading
                  title={item.event}
                  path={
                    item.scope === "user"
                      ? "hooks.json"
                      : `${product.workspaceDataFolderName}/hooks.json`
                  }
                />
                <p className="break-all text-xs text-muted-foreground" title={item.command}>
                  {item.command}
                </p>
              </div>
              <RovingFocusItem asChild tabStopId={item.id} focusable={!hooksBusy}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 self-start sm:self-center"
                  disabled={hooksBusy}
                  onClick={() => setDeleteTarget(item)}
                >
                  {t("common.delete")}
                </Button>
              </RovingFocusItem>
            </div>
          ))}
        </RovingFocusGroup>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={t("settings.deleteHookConfirmTitle", { event: deleteTarget?.event ?? "" })}
        description={
          <>
            {t("settings.deleteHookConfirmDescription")}
            {deleteError ? (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            ) : null}
          </>
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={hooksBusy}
        onConfirm={async () => {
          const target = deleteTarget;
          if (!target) {
            return;
          }
          try {
            setDeleteError(null);
            await onDeleteHookEntry({
              scope: target.scope,
              event: target.event,
              index: target.index,
            });
            setDeleteTarget(null);
          } catch (error) {
            setDeleteError(
              error instanceof Error ? error.message : t("settings.hooksDeleteFailed"),
            );
          }
        }}
      />

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.hooksAdd")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <InstructionLocationFields
              idPrefix="new-hook-location"
              rootKind={createScope === "user" ? "user" : "workspaceSpirit"}
              onRootKindChange={(rootKind) =>
                setCreateScope(rootKind === "user" ? "user" : "workspace")
              }
              disabled={hooksBusy ?? false}
              workspaceDisabled={workspaceBindingDisabled}
              includeGeneric={false}
            />

            <div className="grid gap-2">
              <Label htmlFor="hook-event">{t("settings.hooksEvent")}</Label>
              <Select
                value={event}
                onValueChange={(value) => setEvent(value as DesktopHookEventName)}
              >
                <SelectTrigger id="hook-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_EVENTS.map((hookEvent) => (
                    <SelectItem key={hookEvent} value={hookEvent}>
                      {hookEvent}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-command">{t("settings.hooksCommand")}</Label>
              <DesktopFormInput
                id="hook-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="hooks/my-hook.sh"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-timeout">{t("settings.hooksTimeout")}</Label>
              <DesktopFormInput
                id="hook-timeout"
                value={timeout}
                onChange={(e) => {
                  setTimeoutValue(e.target.value);
                  setCreateError(null);
                }}
                autoComplete="off"
              />
            </div>
            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
            <div className="grid gap-2">
              <Label htmlFor="hook-matcher">{t("settings.hooksMatcher")}</Label>
              <DesktopFormInput
                id="hook-matcher"
                value={matcher}
                onChange={(e) => setMatcher(e.target.value)}
                placeholder="shell"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="hook-fail-closed">{t("settings.hooksFailClosed")}</Label>
              <Switch
                id="hook-fail-closed"
                checked={failClosed}
                onCheckedChange={(checked) => setFailClosed(checked === true)}
                disabled={hooksBusy}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogFooterActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={hooksBusy || !command.trim()}
                onClick={() => void handleCreate()}
              >
                {hooksBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("common.save")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
