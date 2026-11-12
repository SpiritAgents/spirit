import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import "../../src/lib/i18n";
import { RemoteControlPanel } from "../../src/components/settings/panels/remote-control-panel.tsx";

const settings = {
  activeModel: { providerId: "", name: "" },
  apiBase: "",
  uiLocale: "en",
  apiKey: "",
  translucency: "sidebar",
  systemNotifications: true,
  trayIcon: true,
  onboardingCompleted: true,
  agentMode: "agent",
  webHostEnabled: true,
  webHostHost: "127.0.0.1",
  webHostPort: 7788,
  dreamEnabled: false,
  dreamDebugMode: false,
  lspEnabled: true,
  codeCompletionEnabled: true,
  commitAttributionEnabled: true,
  prAttributionEnabled: true,
  providerToolsEnabled: true,
  webFetchEnabled: true,
};

test("renders simplified settings and the device list without legacy remote status", () => {
  const html = renderToStaticMarkup(
    React.createElement(RemoteControlPanel, {
      settings,
      snapshot: {
        remoteControl: {
          devices: [
            {
              id: "device-a",
              name: "Mac / Edge",
              createdAt: "2026-01-02T03:04:05.000Z",
              lastConnectedAt: "2026-01-02T03:04:05.000Z",
              lastUserAgent: "Example Browser",
              status: "offline",
            },
          ],
        },
      },
      onSavePatch: async () => {},
      onRevokeRemoteControlDevice: async () => {},
    }),
  );
  assert.match(html, /Remote Control/);
  assert.match(html, /Devices/);
  assert.match(html, /Mac \/ Edge/);
  assert.match(html, /Revoke Access/);
  assert.doesNotMatch(html, /Remote Status/);
  assert.doesNotMatch(html, /Web Remote Control/);
});
