import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentsSettingsRow } from "../../src/components/settings/panels/agents-settings-panel.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, "../../src/components/settings");

const PANEL_FILES = [
  ["AgentsSettingsPanel", "panels/agents-settings-panel.tsx"],
  ["AppearanceSettingsPanel", "panels/appearance-settings-panel.tsx"],
  ["DeveloperSettingsPanel", "panels/developer-settings-panel.tsx"],
  ["DreamSettingsPanel", "panels/dream-settings-panel.tsx"],
  ["ExtensionConfigurationPanel", "panels/extension-configuration-panel.tsx"],
  ["HooksSettingsPanel", "panels/hooks-settings-panel.tsx"],
  ["IntegrationsSettingsPanel", "panels/integrations-settings-panel.tsx"],
  ["McpsSettingsPanel", "panels/mcps-settings-panel.tsx"],
  ["NetworksSettingsPanel", "panels/networks-settings-panel.tsx"],
  ["RulesSettingsPanel", "panels/rules-settings-panel.tsx"],
  ["SkillsSettingsPanel", "panels/skills-settings-panel.tsx"],
  ["ModelsSettingsPanel", "models/models-settings-panel.tsx"],
  ["SettingsView", "settings-view.tsx"],
];

for (const [exportName, relativePath] of PANEL_FILES) {
  test(`settings module file exports ${exportName}`, async () => {
    const source = await readFile(join(srcRoot, relativePath), "utf8");
    assert.match(
      source,
      new RegExp(`export function ${exportName}\\b`),
      `${exportName} in ${relativePath}`,
    );
  });
}

test("settings barrel re-exports SettingsView and settings types", async () => {
  const barrel = await readFile(join(__dirname, "../../src/components/settings-view.tsx"), "utf8");
  assert.match(barrel, /export \{ SettingsView \} from "@\/components\/settings\/settings-view"/);
  assert.match(
    barrel,
    /export type \{ SettingsFormState, SettingsViewProps \} from "@\/components\/settings\/types"/,
  );
});

test("AgentsSettingsRow uses grid layout without shared SettingsRow border", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AgentsSettingsRow,
      {
        label: "LSP",
        description: "Enable language servers",
        htmlFor: "settings-lsp-enabled",
      },
      React.createElement("span", null, "control"),
    ),
  );

  assert.match(html, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(html, /border-b/);
  // Label + description text stack matches the shared SettingsRow used by other panels.
  assert.match(html, /data-slot="label"/);
  assert.match(html, /mt-1 text-xs leading-relaxed text-muted-foreground/);
  assert.match(html, /for="settings-lsp-enabled"/);
});

test("AgentsSettingsPanel includes LSP section label and Attribution rows", async () => {
  const source = await readFile(join(srcRoot, "panels/agents-settings-panel.tsx"), "utf8");
  assert.match(source, /settings\.lspSection/);
  assert.match(source, /settings\.attributionSection/);
  assert.match(source, /settings\.commitAttribution/);
  assert.match(source, /settings\.prAttribution/);
  assert.match(source, /commitAttributionEnabled/);
  assert.match(source, /prAttributionEnabled/);
  assert.match(source, /settings-commit-attribution/);
  assert.match(source, /settings-pr-attribution/);
});

test("AgentsSettingsPanel places the Context group with web tool toggles above LSP", async () => {
  const source = await readFile(join(srcRoot, "panels/agents-settings-panel.tsx"), "utf8");
  assert.match(source, /settings\.contextSection/);
  assert.match(source, /settings\.providerToolsDescription/);
  assert.match(source, /settings\.providerToolsLearnMoreAria/);
  assert.match(source, /settings\.webFetchDescription/);
  // The separator helper lives in @spiritagent/ui/cjk; the panel only consumes it.
  assert.match(source, /needsSpaceBeforeInlineContent/);
  assert.doesNotMatch(source, /export function needsSpaceBeforeInlineContent/);
  assert.match(source, /providerToolsEnabled/);
  assert.match(source, /webFetchEnabled/);
  assert.match(source, /settings-provider-tools/);
  assert.match(source, /settings-web-fetch/);
  assert.ok(
    source.indexOf("settings.contextSection") < source.indexOf("settings.lspSection"),
    "Context group must render above the LSP group",
  );
});

test("AppearanceSettingsPanel groups Theme, Motion, and Typography without UI locale", async () => {
  const source = await readFile(join(srcRoot, "panels/appearance-settings-panel.tsx"), "utf8");
  assert.doesNotMatch(source, /settings\.themeSection/);
  assert.match(source, /settings\.motionSection/);
  assert.match(source, /settings\.reduceMotion/);
  assert.match(source, /settings\.typographySection/);
  assert.match(source, /settings\.clickablePointerCursor/);
  assert.match(source, /settings\.fontSmoothing/);
  assert.match(source, /isMacDesktopPlatform/);
  assert.doesNotMatch(source, /settings\.uiLocale/);
});

test("GeneralSettingsPanel places UI locale above notifications and tray", async () => {
  const source = await readFile(join(srcRoot, "panels/general-settings-panel.tsx"), "utf8");
  const localeIndex = source.indexOf("settings.uiLocale");
  const notificationsIndex = source.indexOf("settings.systemNotifications");
  const trayIndex = source.indexOf("settings.trayIcon");
  assert.notEqual(localeIndex, -1);
  assert.ok(notificationsIndex > localeIndex);
  assert.ok(trayIndex > notificationsIndex);
});
