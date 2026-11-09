import { CircleHelp, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Switch } from "@/components/ui/switch";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { formatRelativeTime } from "@/lib/format-relative-time";
import {
  DESKTOP_LIST_ITEM_PRIMARY_CLASS,
  DESKTOP_PAGE_TITLE_CLASS,
} from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import { inferRemoteControlClientKind } from "@spiritagent/remote-control/presentation";
import { formatRemoteControlDeviceName } from "@/lib/remote-control-device-presentation";

export function RemoteControlPanel({
  settings,
  snapshot,
  onSavePatch,
  onPairRemoteControl,
  onRevokeRemoteControlDevice,
}: Pick<
  SettingsViewProps,
  "settings" | "snapshot" | "onSavePatch" | "onPairRemoteControl" | "onRevokeRemoteControlDevice"
>) {
  const { t, i18n } = useTranslation();
  const remoteControl = snapshot?.remoteControl;
  const devices = remoteControl?.devices ?? [];
  const [hostDraft, setHostDraft] = useState(settings.webHostHost);
  const [portDraft, setPortDraft] = useState(String(settings.webHostPort));
  const [revokingId, setRevokingId] = useState<string>();

  useEffect(() => setHostDraft(settings.webHostHost), [settings.webHostHost]);
  useEffect(() => setPortDraft(String(settings.webHostPort)), [settings.webHostPort]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className={DESKTOP_PAGE_TITLE_CLASS}>{t("settings.remoteControl")}</h1>
        <Button
          type="button"
          size="sm"
          disabled={!onPairRemoteControl}
          onClick={() => onPairRemoteControl?.()}
        >
          {t("app.pair")}
        </Button>
      </div>

      <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
        <SettingsRow
          label={t("settings.remoteControl")}
          description={t("settings.remoteControlDescription")}
          htmlFor="settings-remote-control-enabled"
        >
          <Switch
            id="settings-remote-control-enabled"
            checked={settings.webHostEnabled}
            onCheckedChange={(value) => void onSavePatch({ webHostEnabled: value === true })}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.listenAddress")} htmlFor="settings-remote-control-host">
          <DesktopFormInput
            id="settings-remote-control-host"
            className="sm:text-right"
            value={hostDraft}
            onChange={(event) => setHostDraft(event.target.value)}
            onBlur={() => {
              const next = hostDraft.trim();
              if (next && next !== settings.webHostHost) {
                void onSavePatch({ webHostHost: next });
              }
            }}
            disabled={!settings.webHostEnabled}
            placeholder="127.0.0.1"
          />
        </SettingsRow>
        <SettingsRow label={t("settings.listenPort")} htmlFor="settings-remote-control-port">
          <DesktopFormInput
            id="settings-remote-control-port"
            className="sm:text-right"
            type="number"
            min={1}
            max={65535}
            value={portDraft}
            onChange={(event) => setPortDraft(event.target.value)}
            onBlur={() => {
              const port = Number.parseInt(portDraft, 10);
              if (
                Number.isInteger(port) &&
                port >= 1 &&
                port <= 65535 &&
                port !== settings.webHostPort
              ) {
                void onSavePatch({ webHostPort: port });
              }
            }}
            disabled={!settings.webHostEnabled}
            placeholder="7788"
          />
        </SettingsRow>
      </div>

      <section className="space-y-3" aria-labelledby="remote-control-devices-title">
        <p id="remote-control-devices-title" className="text-xs text-muted-foreground">
          {t("settings.devices")}
        </p>
        <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35")}>
          {devices.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("settings.noDevices")}
            </p>
          ) : (
            devices.map((device) => {
              const isBrowser = inferRemoteControlClientKind(device.lastUserAgent) === "browser";
              const Icon = isBrowser ? Globe : CircleHelp;
              const lastUsed = device.lastConnectedAt
                ? t("settings.deviceLastUsed", {
                    time: formatRelativeTime(device.lastConnectedAt, i18n.language),
                  })
                : t("settings.deviceNeverUsed");
              return (
                <div
                  key={device.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Icon
                      className="mt-0.5 size-4 shrink-0 text-foreground"
                      aria-hidden
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>
                        {formatRemoteControlDeviceName(device, i18n.language)}
                      </p>
                      <p className="text-xs text-muted-foreground">{lastUsed}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-muted-foreground"
                    disabled={revokingId === device.id || !onRevokeRemoteControlDevice}
                    onClick={() => {
                      if (!onRevokeRemoteControlDevice) return;
                      setRevokingId(device.id);
                      void onRevokeRemoteControlDevice(device.id).finally(() =>
                        setRevokingId(undefined),
                      );
                    }}
                  >
                    {t("settings.revokeAccess")}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
