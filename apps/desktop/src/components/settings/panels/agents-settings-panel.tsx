import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import type { SettingsFormState } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import {
  DESKTOP_LIST_ITEM_PRIMARY_CLASS,
  DESKTOP_SETTINGS_LABEL_CLASS,
  DESKTOP_PAGE_TITLE_CLASS,
} from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import type { DesktopLspProviderSnapshot, DesktopSnapshot } from "@/types";

/** Row layout dedicated to the Agents panel (grid); unlike the flex SettingsRow of the appearance and other panels. */
export function AgentsSettingsRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0 space-y-1">
        <label htmlFor={htmlFor} className={DESKTOP_SETTINGS_LABEL_CLASS}>
          {label}
        </label>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function providerStatusBadge(provider: DesktopLspProviderSnapshot, t: (key: string) => string) {
  if (provider.status === "ready") {
    return <Badge variant="outline">{t("settings.lspStatusReady")}</Badge>;
  }
  if (provider.status === "disabled") {
    return <Badge variant="secondary">{t("settings.lspStatusDisabled")}</Badge>;
  }
  return <Badge variant="secondary">{t("settings.lspStatusNotInstalled")}</Badge>;
}

export function AgentsSettingsPanel({
  settings,
  snapshot,
  onSavePatch,
}: {
  settings: SettingsFormState;
  snapshot: DesktopSnapshot | null;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const lsp = snapshot?.lsp;
  const listDisabled = !settings.lspEnabled;

  return (
    <div className="space-y-6">
      <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.agents")}</h1>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.lspSection")}</p>
        <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
          <AgentsSettingsRow
            label={t("settings.lspEnabled")}
            description={t("settings.lspEnabledDescription")}
            htmlFor="settings-lsp-enabled"
          >
            <div className="flex justify-end">
              <Switch
                id="settings-lsp-enabled"
                checked={settings.lspEnabled}
                onCheckedChange={(value) => void onSavePatch({ lspEnabled: value === true })}
              />
            </div>
          </AgentsSettingsRow>

          {(lsp?.providers ?? []).map((provider) => (
            <div
              key={provider.id}
              className={cn(
                "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between",
                listDisabled && "pointer-events-none opacity-50",
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{provider.displayName}</p>
                  {providerStatusBadge(provider, t)}
                </div>
                <p className="text-xs text-muted-foreground">{provider.languages.join(" · ")}</p>
                {provider.command ? (
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground/80"
                    title={provider.command}
                  >
                    {provider.command}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.attributionSection")}</p>
        <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
          <AgentsSettingsRow
            label={t("settings.commitAttribution")}
            description={t("settings.commitAttributionDescription")}
            htmlFor="settings-commit-attribution"
          >
            <div className="flex justify-end">
              <Switch
                id="settings-commit-attribution"
                checked={settings.commitAttributionEnabled}
                onCheckedChange={(value) =>
                  void onSavePatch({ commitAttributionEnabled: value === true })
                }
              />
            </div>
          </AgentsSettingsRow>
          <AgentsSettingsRow
            label={t("settings.prAttribution")}
            description={t("settings.prAttributionDescription")}
            htmlFor="settings-pr-attribution"
          >
            <div className="flex justify-end">
              <Switch
                id="settings-pr-attribution"
                checked={settings.prAttributionEnabled}
                onCheckedChange={(value) =>
                  void onSavePatch({ prAttributionEnabled: value === true })
                }
              />
            </div>
          </AgentsSettingsRow>
        </div>
      </div>
    </div>
  );
}
