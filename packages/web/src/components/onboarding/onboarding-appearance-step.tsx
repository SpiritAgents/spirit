import { useTranslation } from "react-i18next";

import type { SettingsFormState } from "@/components/settings/types";
import { ThemePreviewPicker } from "@/components/theme-preview-picker";
import { TranslucencyPreferenceToggles } from "@/components/settings/translucency-preference-toggles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isNativeTranslucencySupported } from "@/lib/desktop-shell";
import { DESKTOP_SETTINGS_LABEL_CLASS } from "@/lib/desktop-typography";
import {
  changeLanguage,
  isLanguagePreference,
  LANGUAGE_PREFERENCE_OPTIONS,
  LOCALE_LABEL_KEYS,
  SYSTEM_LANGUAGE,
} from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";

type OnboardingAppearanceControlsProps = {
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  settings: SettingsFormState;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
};

/**
 * OOBE appearance step content: three-way theme preview cards + translucency preference + language
 * selection. All selections take effect immediately, sharing the same save pipeline as the
 * settings page.
 */
export function OnboardingAppearanceControls({
  theme,
  onThemeChange,
  settings,
  onSavePatch,
}: OnboardingAppearanceControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full max-w-md flex-col gap-7">
      <ThemePreviewPicker
        value={theme}
        onValueChange={onThemeChange}
        ariaLabel={t("settings.theme")}
        className="justify-center"
      />

      {isNativeTranslucencySupported() ? (
        <div className="flex items-center justify-between gap-4">
          <p className={DESKTOP_SETTINGS_LABEL_CLASS}>{t("settings.translucency")}</p>
          <TranslucencyPreferenceToggles
            value={settings.translucency}
            onChange={(value) => void onSavePatch({ translucency: value })}
            ariaLabel={t("settings.translucency")}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <label htmlFor="onboarding-locale" className={DESKTOP_SETTINGS_LABEL_CLASS}>
          {t("settings.uiLocale")}
        </label>
        <Select
          value={isLanguagePreference(settings.uiLocale) ? settings.uiLocale : SYSTEM_LANGUAGE}
          onValueChange={(value) => {
            void changeLanguage(value);
            void onSavePatch({ uiLocale: value });
          }}
        >
          <SelectTrigger id="onboarding-locale" className="w-44">
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
      </div>
    </div>
  );
}
