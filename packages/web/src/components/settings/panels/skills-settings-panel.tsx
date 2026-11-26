import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";

import { InstructionLocationFields } from "@/components/settings/instruction-location-fields";
import { skillRootKindLabel } from "@/components/settings/skill-rule-labels";
import { SettingsListItemHeading } from "@/components/settings/settings-list-item-heading";
import type { SettingsViewProps } from "@/components/settings/types";
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
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { DESKTOP_SETTINGS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { workspaceFileDirname } from "@/lib/file-picker-path";
import { markdownToPlainText } from "@/lib/markdown-plain-text";
import { cn } from "@/lib/utils";
import type { CreateSkillRequest, DeleteSkillRequest, DesktopSkillRootKind } from "@/types";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";

function skillDirectoryLabel(shortLabel: string): string {
  return workspaceFileDirname(workspaceFileDirname(shortLabel));
}

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
  const items = snapshot?.skillsList ?? [];

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
              <Sparkles className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
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

      {items.length === 0 ? (
        <EmptyCard
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          icon={<Sparkles strokeWidth={1.75} />}
          title={t("settings.skillsEmpty")}
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
              <div className={cn("min-w-0 flex-1 space-y-1", !item.enabled && "opacity-50")}>
                <SettingsListItemHeading
                  title={formatTitleFromId(item.name, {
                    casingOverrides: WELL_KNOWN_CASING_OVERRIDES,
                  })}
                  path={item.shortLabel}
                  directoryLabel={skillDirectoryLabel(item.shortLabel)}
                />
                {markdownToPlainText(item.description) ? (
                  <p className="text-xs text-muted-foreground">
                    {markdownToPlainText(item.description)}
                  </p>
                ) : null}
              </div>
              <RovingFocusItem
                asChild
                tabStopId={`skill:${item.rootKind}:${item.name}`}
                focusable={!skillsBusy}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 self-start sm:self-center"
                  disabled={skillsBusy}
                  onClick={() => setDeleteTarget({ name: item.name, rootKind: item.rootKind })}
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
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <InstructionLocationFields
              idPrefix="new-skill-location"
              rootKind={createRootKind}
              onRootKindChange={setCreateRootKind}
              disabled={skillsBusy}
              workspaceDisabled={workspaceBindingDisabled}
            />
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
                {skillsBusy ? (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
                ) : null}
                {t("common.create")}
              </Button>
            </DialogFooterActions>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
