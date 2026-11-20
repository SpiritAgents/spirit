import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DesktopExtensionListItem, UpdateExtensionSettingsRequest } from "@/types";
import { DESKTOP_SETTINGS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export function ExtensionConfigurationPanel({
  item,
  extensionsBusy,
  onUpdateExtensionSettings,
}: {
  item: DesktopExtensionListItem;
  extensionsBusy: boolean;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});

  const settingDraftKey = (extensionId: string, key: string) => `${extensionId}::setting::${key}`;

  const updateSettingDraft = (extensionId: string, key: string, value: string) => {
    setSettingDrafts((current) => ({
      ...current,
      [settingDraftKey(extensionId, key)]: value,
    }));
  };

  const currentSettingText = (
    item: DesktopExtensionListItem,
    key: string,
    fallback?: string | boolean | number,
  ): string => {
    const draft = settingDrafts[settingDraftKey(item.id, key)];
    if (draft !== undefined) {
      return draft;
    }

    const value = item.settingsValues?.[key] ?? fallback;
    return value === undefined || value === null ? "" : String(value);
  };

  const hasSettings = Boolean(item.settingsSchema?.length);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={DESKTOP_PAGE_TITLE_CLASS}>
          {item.desktopSettingsPage?.title ?? item.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {item.description ?? t("settings.extensionSettingsDescription", { id: item.id })}
        </p>
      </div>

      {!hasSettings ? (
        <div
          className={cn(
            DESKTOP_SETTINGS_CARD_SURFACE,
            "px-4 py-10 text-center text-sm text-muted-foreground",
          )}
        >
          {t("settings.noExtensionSettings")}
        </div>
      ) : (
        <div
          className={cn(
            DESKTOP_SETTINGS_CARD_SURFACE,
            "divide-y divide-settings-card-divider px-4 sm:px-5",
          )}
        >
          {item.settingsSchema?.map((setting) => {
            const fieldKey = settingDraftKey(item.id, setting.key);
            const currentText = currentSettingText(item, setting.key, setting.defaultValue);

            if (setting.type === "boolean") {
              const checked = Boolean(
                item.settingsValues?.[setting.key] ?? setting.defaultValue ?? false,
              );
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <div className="flex justify-end">
                    <Switch
                      id={fieldKey}
                      checked={checked}
                      disabled={extensionsBusy}
                      onCheckedChange={(value) => {
                        void onUpdateExtensionSettings({
                          id: item.id,
                          values: { [setting.key]: value === true },
                        });
                      }}
                    />
                  </div>
                </SettingsRow>
              );
            }

            if (setting.type === "select") {
              const selected = currentText || String(setting.defaultValue ?? "");
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <Select
                    value={selected}
                    onValueChange={(value) => {
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value || null },
                      });
                    }}
                    disabled={extensionsBusy}
                  >
                    <SelectTrigger id={fieldKey} className="w-full sm:min-w-[14rem]">
                      <SelectValue placeholder={setting.placeholder ?? setting.title} />
                    </SelectTrigger>
                    <SelectContent>
                      {setting.options?.map((option) => (
                        <SelectItem key={`${fieldKey}:${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              );
            }

            return (
              <SettingsRow
                key={fieldKey}
                label={setting.title}
                description={setting.description}
                htmlFor={fieldKey}
              >
                <div className="flex w-full gap-2 sm:max-w-md">
                  <DesktopFormInput
                    id={fieldKey}
                    shellClassName="min-w-0 flex-1"
                    value={currentText}
                    disabled={extensionsBusy}
                    type={setting.type === "number" ? "number" : "text"}
                    placeholder={setting.placeholder ?? setting.title}
                    onChange={(event) =>
                      updateSettingDraft(item.id, setting.key, event.target.value)
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionsBusy}
                    onClick={() => {
                      const raw = settingDrafts[fieldKey] ?? currentText;
                      const value =
                        setting.type === "number"
                          ? raw.trim().length === 0
                            ? null
                            : Number(raw)
                          : raw.trim().length === 0
                            ? null
                            : raw;
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value },
                      });
                    }}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
