import { useTranslation } from "react-i18next";

import { AgentsSettingsRow } from "@/components/settings/panels/agents-settings-panel";
import type { SettingsViewProps } from "@/components/settings/types";
import { Switch } from "@/components/ui/switch";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export function TabSettingsPanel({
  settings,
  onSavePatch,
}: Pick<SettingsViewProps, "settings" | "onSavePatch">) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.tab")}</h1>

      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
        <AgentsSettingsRow
          label={t("settings.editorTabCompletion")}
          description={t("settings.editorTabCompletionDescription")}
          htmlFor="settings-editor-tab-completion"
        >
          <div className="flex justify-end">
            <Switch
              id="settings-editor-tab-completion"
              checked={settings.codeCompletionEnabled}
              onCheckedChange={(value) =>
                void onSavePatch({ codeCompletionEnabled: value === true })
              }
            />
          </div>
        </AgentsSettingsRow>
      </div>
    </div>
  );
}
