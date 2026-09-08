import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DreamGraphCard } from "@/components/dream-graph-card";
import { formatSettingsTime } from "@/components/settings/formatters";
import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Switch } from "@/components/ui/switch";
import i18n from "@/lib/i18n";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { DesktopDreamOverviewItem, DesktopSnapshot } from "@/types";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS, FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";

function dreamCollectorStateLabel(state: DesktopSnapshot["dreams"]["collector"]["state"]): string {
  switch (state) {
    case "disabled":
      return i18n.t("settings.dreamDisabled");
    case "missing-model":
      return i18n.t("settings.dreamMissingModel");
    case "running":
      return i18n.t("settings.dreamCollecting");
    case "backoff":
      return i18n.t("settings.dreamBackoff");
    case "error":
      return i18n.t("settings.dreamError");
    default:
      return i18n.t("settings.dreamIdle");
  }
}

export function DreamSettingsPanel({
  theme,
  settings,
  snapshot,
  onSavePatch,
  onListDreamsOverview,
}: Pick<SettingsViewProps, "settings" | "snapshot" | "onSavePatch" | "onListDreamsOverview"> & {
  theme: ThemePreference;
}) {
  const { t } = useTranslation();
  const collector = snapshot?.dreams.collector;
  const disabled = !settings.dreamEnabled;
  const [dreamItems, setDreamItems] = useState<DesktopDreamOverviewItem[]>([]);
  const [dreamsLoading, setDreamsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDreams = async () => {
      setDreamsLoading(true);
      try {
        const items = await onListDreamsOverview();
        if (!cancelled) {
          setDreamItems(items);
        }
      } catch {
        if (!cancelled) {
          setDreamItems([]);
        }
      } finally {
        if (!cancelled) {
          setDreamsLoading(false);
        }
      }
    };

    void loadDreams();
    return () => {
      cancelled = true;
    };
  }, [
    onListDreamsOverview,
    snapshot?.workspaceRoot,
    snapshot?.git.branch,
    snapshot?.dreams.collector.processedCount,
    snapshot?.dreams.collector.lastSuccessAtUnixMs,
  ]);

  return (
    <div className="space-y-6">
      <DreamGraphCard
        items={dreamItems}
        loading={dreamsLoading}
        theme={theme}
        workspaceRoot={snapshot?.workspaceRoot}
        gitBranch={snapshot?.git.branch}
        collectorState={collector?.state ?? "disabled"}
        dreamEnabled={settings.dreamEnabled}
        debugMode={settings.dreamDebugMode}
      />

      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
        <SettingsRow
          label={t("settings.dreams")}
          description={t("settings.dreamDescription")}
          htmlFor="settings-dream-enabled"
        >
          <div className="flex justify-end">
            <Switch
              id="settings-dream-enabled"
              checked={settings.dreamEnabled}
              onCheckedChange={(value) => void onSavePatch({ dreamEnabled: value === true })}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label={t("settings.debugMode")}
          description={t("settings.debugModeDescription")}
          htmlFor="settings-dream-debug"
        >
          <div className="flex justify-end">
            <Switch
              id="settings-dream-debug"
              checked={settings.dreamDebugMode}
              disabled={disabled}
              onCheckedChange={(value) => void onSavePatch({ dreamDebugMode: value === true })}
            />
          </div>
        </SettingsRow>

        <div className="py-4">
          <p className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{t("settings.collectorStatus")}</p>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
            <p>
              {t("settings.status")}
              <span className={cn(FONT_WEIGHT_NORMAL, "text-foreground")}>
                {dreamCollectorStateLabel(collector?.state ?? "disabled")}
              </span>
            </p>
            <p>
              {t("settings.pendingProcessed", {
                pending: collector?.pendingCount ?? 0,
                processed: collector?.processedCount ?? 0,
              })}
            </p>
            <p>
              {t("settings.lastRun")}
              {formatSettingsTime(collector?.lastRunAtUnixMs)}
            </p>
            <p>
              {t("settings.lastSuccess")}
              {formatSettingsTime(collector?.lastSuccessAtUnixMs)}
            </p>
            {collector?.backoffUntilUnixMs ? (
              <p>
                {t("settings.backoffUntil")}
                {formatSettingsTime(collector.backoffUntilUnixMs)}
              </p>
            ) : null}
            {collector?.lastError ? (
              <p className="break-words text-destructive">{collector.lastError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
