import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { desktopShellPlatform } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";
import {
  changeLanguage,
  isLanguagePreference,
  LANGUAGE_PREFERENCE_OPTIONS,
  LOCALE_LABEL_KEYS,
  SYSTEM_LANGUAGE,
} from "@/lib/i18n";

const generalSelectTriggerClassName = "w-full sm:w-fit sm:max-w-full";

function platformKey(base: string): string {
  const platform = desktopShellPlatform();
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return `${base}.${platform}`;
  }
  return `${base}.linux`;
}

export function GeneralSettingsPanel({
  settings,
  onSavePatch,
}: Pick<SettingsViewProps, "settings" | "onSavePatch">) {
  const { t } = useTranslation();
  return (
    <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
      <SettingsRow
        label={t("settings.uiLocale")}
        description={t("settings.uiLocaleDescription")}
        htmlFor="settings-locale"
      >
        <Select
          value={isLanguagePreference(settings.uiLocale) ? settings.uiLocale : SYSTEM_LANGUAGE}
          onValueChange={(value) => {
            void changeLanguage(value);
            void onSavePatch({ uiLocale: value });
          }}
        >
          <SelectTrigger id="settings-locale" className={generalSelectTriggerClassName}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_PREFERENCE_OPTIONS.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {t(LOCALE_LABEL_KEYS[lang])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label={t("settings.systemNotifications")}
        description={t("settings.systemNotificationsDescription")}
        htmlFor="settings-system-notifications"
      >
        <div className="flex justify-end">
          <Switch
            id="settings-system-notifications"
            checked={settings.systemNotifications}
            onCheckedChange={(value) => void onSavePatch({ systemNotifications: value === true })}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label={t(platformKey("settings.trayIcon"))}
        description={t(platformKey("settings.trayIconDescription"))}
        htmlFor="settings-tray-icon"
      >
        <div className="flex justify-end">
          <Switch
            id="settings-tray-icon"
            checked={settings.trayIcon}
            onCheckedChange={(value) => void onSavePatch({ trayIcon: value === true })}
          />
        </div>
      </SettingsRow>
    </div>
  );
}
