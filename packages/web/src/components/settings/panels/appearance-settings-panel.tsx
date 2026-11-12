import { useTranslation } from "react-i18next";

import { FontSelect } from "@/components/font-select";
import { SettingsRow } from "@/components/settings/settings-row";
import { TranslucencyPreferenceToggles } from "@/components/settings/translucency-preference-toggles";
import type { SettingsViewProps } from "@/components/settings/types";
import { ThemePreviewPicker } from "@/components/theme-preview-picker";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { isMacDesktopPlatform, isNativeTranslucencySupported } from "@/lib/desktop-shell";
import type { ReduceMotionPreference } from "@/lib/reduce-motion";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const appearanceSelectTriggerClassName = "w-full sm:w-fit sm:max-w-full";

const REDUCE_MOTION_OPTIONS = [
  ["system", "settings.reduceMotionSystem"],
  ["on", "settings.reduceMotionOn"],
  ["off", "settings.reduceMotionOff"],
] as const satisfies ReadonlyArray<readonly [ReduceMotionPreference, string]>;

export function AppearanceSettingsPanel({
  theme,
  onThemeChange,
  font,
  onFontChange,
  clickablePointerCursor,
  onClickablePointerCursorChange,
  fontSmoothing,
  onFontSmoothingChange,
  settings,
  onSavePatch,
}: Pick<
  SettingsViewProps,
  | "font"
  | "onFontChange"
  | "clickablePointerCursor"
  | "onClickablePointerCursorChange"
  | "fontSmoothing"
  | "onFontSmoothingChange"
  | "settings"
  | "onSavePatch"
> & {
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const { reduceMotion, setReduceMotion } = useReduceMotion();
  return (
    <div className="space-y-6">
      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
        <SettingsRow label={t("settings.theme")} description={t("settings.themeDescription")}>
          <ThemePreviewPicker
            value={theme}
            onValueChange={onThemeChange}
            size="compact"
            ariaLabel={t("settings.theme")}
            className="shrink-0 justify-end"
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.translucency")}
          description={
            isNativeTranslucencySupported()
              ? t("settings.translucencyDescription")
              : t("settings.translucencyUnsupported")
          }
        >
          {isNativeTranslucencySupported() ? (
            <TranslucencyPreferenceToggles
              value={settings.translucency}
              onChange={(value) => void onSavePatch({ translucency: value })}
              ariaLabel={t("settings.translucency")}
            />
          ) : (
            <p className="text-sm text-muted-foreground sm:text-right">—</p>
          )}
        </SettingsRow>

        <SettingsRow
          label={t("settings.clickablePointerCursor")}
          description={t("settings.clickablePointerCursorDescription")}
          htmlFor="settings-clickable-pointer-cursor"
        >
          <div className="flex justify-end">
            <Switch
              id="settings-clickable-pointer-cursor"
              checked={clickablePointerCursor}
              onCheckedChange={(value) => onClickablePointerCursorChange(value === true)}
            />
          </div>
        </SettingsRow>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.motionSection")}</p>
        <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
          <SettingsRow
            label={t("settings.reduceMotion")}
            description={t("settings.reduceMotionDescription")}
          >
            <div
              className="flex justify-end gap-1"
              role="radiogroup"
              aria-label={t("settings.reduceMotion")}
            >
              {REDUCE_MOTION_OPTIONS.map(([value, labelKey]) => {
                const label = t(labelKey);
                return (
                  <Toggle
                    key={value}
                    variant="default"
                    pressed={reduceMotion === value}
                    onPressedChange={(pressed) => {
                      if (pressed) {
                        setReduceMotion(value);
                      }
                    }}
                    aria-label={label}
                  >
                    {label}
                  </Toggle>
                );
              })}
            </div>
          </SettingsRow>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.typographySection")}</p>
        <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
          <SettingsRow
            label={t("settings.font")}
            description={t("settings.fontDescription")}
            htmlFor="settings-font-select"
          >
            <FontSelect
              id="settings-font-select"
              value={font}
              onValueChange={onFontChange}
              triggerClassName={appearanceSelectTriggerClassName}
            />
          </SettingsRow>
          {/* macOS desktop only: iOS / iPadOS already use grayscale AA, so this CSS toggle is a no-op. */}
          {isMacDesktopPlatform() ? (
            <SettingsRow
              label={t("settings.fontSmoothing")}
              description={t("settings.fontSmoothingDescription")}
              htmlFor="settings-font-smoothing"
            >
              <div className="flex justify-end">
                <Switch
                  id="settings-font-smoothing"
                  checked={fontSmoothing}
                  onCheckedChange={(value) => onFontSmoothingChange(value === true)}
                />
              </div>
            </SettingsRow>
          ) : null}
        </div>
      </div>
    </div>
  );
}
