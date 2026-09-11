import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Sparkles } from "lucide-react";

import { skillRootKindLabel } from "@/components/settings/skill-rule-labels";
import type { SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterActions,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type {
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSkillListItem,
  DesktopSkillRootKind,
} from "@/types";
import {
  DESKTOP_EDITOR_TAB_CLASS,
  DESKTOP_LIST_ITEM_PRIMARY_CLASS,
  DESKTOP_PAGE_TITLE_CLASS,
} from "@/lib/desktop-typography";

function skillLocationLabel(item: DesktopSkillListItem): string {
  return skillRootKindLabel(item.rootKind);
}

const skillCreateRootOptions: Array<{
  kind: DesktopSkillRootKind;
  labelKey?: string;
  labelFallback: string;
  hintKey: string;
}> = [
  {
    kind: "user",
    labelKey: "settings.skillUserDirShort",
    labelFallback: "User",
    hintKey: "settings.skillUserDirHint",
  },
  {
    kind: "workspaceSpirit",
    labelFallback: ".spirit",
    hintKey: "settings.skillWorkspaceSpiritHint",
  },
  {
    kind: "workspaceAgents",
    labelFallback: ".agents",
    hintKey: "settings.skillWorkspaceAgentsHint",
  },
];

export function SkillsSettingsPanel({
  snapshot,
  skillsBusy,
  apiReady,
  onCreateSkill,
  onDeleteSkill,
  onGenerateSkillNavigate,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "skillsBusy"
  | "apiReady"
  | "onCreateSkill"
  | "onDeleteSkill"
  | "onGenerateSkillNavigate"
>) {
  const { t } = useTranslation();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSkillRequest | null>(null);
  const [newName, setNewName] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newContent, setNewContent] = useState("");
  const [createRootKind, setCreateRootKind] = useState<DesktopSkillRootKind>("user");

  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const items = (snapshot?.skillsList ?? []).filter(
    (item) => !workspaceBindingDisabled || item.scope === "user",
  );
  const availableSkillCreateRootOptions = workspaceBindingDisabled
    ? skillCreateRootOptions.filter((option) => option.kind === "user")
    : skillCreateRootOptions;
  const localizedSkillCreateRootOptions = availableSkillCreateRootOptions.map((option) => ({
    ...option,
    label: option.labelKey ? t(option.labelKey) : option.labelFallback,
    hint: t(option.hintKey),
  }));

  const resetForm = () => {
    setNewName("");
    setNewSummary("");
    setNewContent("");
    setCreateRootKind("user");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className={DESKTOP_PAGE_TITLE_CLASS}>Skills</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t("app.noWorkspaceBindingHint")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateSkillNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title={t("settings.generateSkillTooltip")}
              onClick={() => onGenerateSkillNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {t("settings.generateSkill")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => {
              resetForm();
              setAddDialogOpen(true);
            }}
            disabled={skillsBusy}
          >
            {t("settings.newSkill")}
          </Button>
        </div>
      </div>

      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35")}>
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("settings.noSkillsFound")}
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{item.name}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {skillLocationLabel(item)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t("settings.skillDisabled")}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p
                  className="truncate font-mono text-[0.65rem] text-muted-foreground/90"
                  title={item.shortLabel}
                >
                  {item.shortLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={skillsBusy}
                onClick={() => setDeleteTarget({ name: item.name, rootKind: item.rootKind })}
              >
                {t("common.delete")}
              </Button>
            </div>
          ))
        )}
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title={t("settings.deleteSkillConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("settings.deleteSkillConfirmDescription", {
          location: deleteTarget ? skillRootKindLabel(deleteTarget.rootKind) : "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={skillsBusy}
        onConfirm={async () => {
          const target = deleteTarget;
          if (!target) {
            return;
          }
          try {
            await onDeleteSkill(target);
            setDeleteTarget(null);
          } catch {
            /* runtimeError */
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
            <DialogTitle>{t("settings.newSkill")}</DialogTitle>
            <DialogDescription>{t("settings.newSkillDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t("settings.saveLocation")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.saveLocation")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedSkillCreateRootOptions.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    role="tab"
                    aria-selected={createRootKind === opt.kind}
                    className={cn(
                      DESKTOP_EDITOR_TAB_CLASS,
                      createRootKind === opt.kind
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-sidebar-foreground",
                    )}
                    disabled={skillsBusy}
                    title={opt.hint}
                    onClick={() => setCreateRootKind(opt.kind)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedSkillCreateRootOptions.find((o) => o.kind === createRootKind)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-name">{t("settings.name")}</Label>
              <DesktopFormInput
                id="new-skill-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("settings.skillNamePlaceholder")}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-summary">{t("settings.description")}</Label>
              <DesktopFormInput
                id="new-skill-summary"
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
                placeholder={t("settings.skillDescPlaceholder")}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-content">{t("settings.content")}</Label>
              <DesktopFormTextarea
                id="new-skill-content"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t("settings.skillContentPlaceholder")}
                autoComplete="off"
                className="min-h-24 resize-y"
                required
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
                disabled={skillsBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={skillsBusy || !newName.trim() || !newSummary.trim() || !newContent.trim()}
                onClick={() => {
                  void (async () => {
                    try {
                      const payload: CreateSkillRequest = {
                        name: newName,
                        rootKind: createRootKind,
                        summary: newSummary.trim(),
                        content: newContent.trim(),
                      };
                      await onCreateSkill(payload);
                      setAddDialogOpen(false);
                      resetForm();
                    } catch {
                      /* runtimeError */
                    }
                  })();
                }}
              >
                {skillsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t("common.create")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
