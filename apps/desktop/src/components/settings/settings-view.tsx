import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { isViteDev } from "@/lib/vite-dev";
import { AgentsSettingsPanel } from "@/components/settings/panels/agents-settings-panel";
import { TabSettingsPanel } from "@/components/settings/panels/tab-settings-panel";
import { GeneralSettingsPanel } from "@/components/settings/panels/general-settings-panel";
import { AppearanceSettingsPanel } from "@/components/settings/panels/appearance-settings-panel";
import { DeveloperSettingsPanel } from "@/components/settings/panels/developer-settings-panel";
import { DreamSettingsPanel } from "@/components/settings/panels/dream-settings-panel";
import { ExtensionConfigurationPanel } from "@/components/settings/panels/extension-configuration-panel";
import { HooksSettingsPanel } from "@/components/settings/panels/hooks-settings-panel";
import { IntegrationsSettingsPanel } from "@/components/settings/panels/integrations-settings-panel";
import { McpsSettingsPanel } from "@/components/settings/panels/mcps-settings-panel";
import { NetworksSettingsPanel } from "@/components/settings/panels/networks-settings-panel";
import { RulesSettingsPanel } from "@/components/settings/panels/rules-settings-panel";
import { SkillsSettingsPanel } from "@/components/settings/panels/skills-settings-panel";
import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { settingsPageTitleKey } from "@/components/settings/constants";
import type { SettingsViewProps } from "@/components/settings/types";
import { useTheme } from "@/hooks/useTheme";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";

export function SettingsView({
  tab,
  extensionSettingsId = null,
  font,
  onFontChange,
  clickablePointerCursor,
  onClickablePointerCursorChange,
  fontSmoothing,
  onFontSmoothingChange,
  settings,
  snapshot,
  apiReady,
  modelsBusy,
  modelsPreviewBusy,
  mcpsBusy,
  hooksBusy,
  skillsBusy,
  rulesBusy,
  extensionsBusy,
  isElectronShell,
  onSavePatch,
  onResetWebHostPairing,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
  onAddMcpServer,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
  onDeleteMcpServer,
  onSaveHookEntry,
  onDeleteHookEntry,
  onInspectMcpServer,
  onCreateSkill,
  onDeleteSkill,
  onCreateRule,
  onDeleteRule,
  onListDreamsOverview,
  onInstallLspProvider,
  lspInstallBusy,
  onGenerateSkillNavigate,
  onGenerateRuleNavigate,
  onGenerateHookNavigate,
  onStartCompactionUiDemo,
  onStartLongConversationListDemo,
  useTranslucency: _useTranslucency = false,
  getGitHubAuthStatus,
  beginGitHubDeviceLogin,
  completeGitHubDeviceLogin,
  cancelGitHubDeviceLogin,
  disconnectGitHub,
}: SettingsViewProps) {
  const integrationsRuntime = useMemo(
    () => ({
      getGitHubAuthStatus,
      beginGitHubDeviceLogin,
      completeGitHubDeviceLogin,
      cancelGitHubDeviceLogin,
      disconnectGitHub,
    }),
    [
      getGitHubAuthStatus,
      beginGitHubDeviceLogin,
      completeGitHubDeviceLogin,
      cancelGitHubDeviceLogin,
      disconnectGitHub,
    ],
  );

  const { t } = useTranslation();
  // The theme is subscribed in place: switching themes only re-renders the settings panel subtree,
  // and App does not need to pass it down (avoiding a full-tree re-render)
  const { theme, setTheme: onThemeChange } = useTheme();
  const extensionSettingsItem = extensionSettingsId
    ? snapshot?.extensionsList.find((item) => item.id === extensionSettingsId)
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
        <div className="flex min-h-full flex-col justify-center">
          {/* Shares the conversation message list's max width and gutter: full width up to
              the cap, then proportional side margins on narrower windows. */}
          <div
            className={cn(
              "mx-auto w-full py-8",
              CONVERSATION_GUTTER_X,
              CONVERSATION_MESSAGE_LIST_MAX_W,
            )}
          >
            {!extensionSettingsItem &&
            tab !== "models" &&
            tab !== "skills" &&
            tab !== "rules" &&
            tab !== "mcps" &&
            tab !== "hooks" &&
            tab !== "agents" &&
            tab !== "tab" &&
            tab !== "integrations" ? (
              <h1 className={cn("mb-6 flex items-center gap-2", DESKTOP_PAGE_TITLE_CLASS)}>
                {t(settingsPageTitleKey[tab])}
                {tab === "dreams" ? <Badge variant="outline">Beta</Badge> : null}
              </h1>
            ) : null}

            {extensionSettingsItem ? (
              <ExtensionConfigurationPanel
                item={extensionSettingsItem}
                extensionsBusy={extensionsBusy}
                onUpdateExtensionSettings={onUpdateExtensionSettings}
                onUpdateExtensionSecret={onUpdateExtensionSecret}
              />
            ) : tab === "developer" && isViteDev ? (
              <DeveloperSettingsPanel
                onStartCompactionUiDemo={onStartCompactionUiDemo}
                onStartLongConversationListDemo={onStartLongConversationListDemo}
              />
            ) : tab === "dreams" ? (
              <DreamSettingsPanel
                theme={theme}
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onListDreamsOverview={onListDreamsOverview}
              />
            ) : tab === "agents" ? (
              <AgentsSettingsPanel
                settings={settings}
                snapshot={snapshot}
                lspInstallBusy={lspInstallBusy}
                onSavePatch={onSavePatch}
                onInstallLspProvider={onInstallLspProvider}
              />
            ) : tab === "tab" ? (
              <TabSettingsPanel settings={settings} onSavePatch={onSavePatch} />
            ) : tab === "models" ? (
              <ModelsSettingsPanel
                settings={settings}
                snapshot={snapshot}
                modelsBusy={modelsBusy}
                modelsPreviewBusy={modelsPreviewBusy}
                onSavePatch={onSavePatch}
                onAddModel={onAddModel}
                onAddProviderModels={onAddProviderModels}
                onPreviewModels={onPreviewModels}
                onRemoveModel={onRemoveModel}
                onRemoveProviderModels={onRemoveProviderModels}
              />
            ) : tab === "skills" ? (
              <SkillsSettingsPanel
                snapshot={snapshot}
                skillsBusy={skillsBusy}
                apiReady={apiReady}
                onCreateSkill={onCreateSkill}
                onDeleteSkill={onDeleteSkill}
                onGenerateSkillNavigate={onGenerateSkillNavigate}
              />
            ) : tab === "rules" ? (
              <RulesSettingsPanel
                snapshot={snapshot}
                rulesBusy={rulesBusy}
                apiReady={apiReady}
                onCreateRule={onCreateRule}
                onDeleteRule={onDeleteRule}
                onGenerateRuleNavigate={onGenerateRuleNavigate}
              />
            ) : tab === "mcps" ? (
              <McpsSettingsPanel
                snapshot={snapshot}
                mcpsBusy={mcpsBusy}
                onAddMcpServer={onAddMcpServer}
                onDeleteMcpServer={onDeleteMcpServer}
                onInspectMcpServer={onInspectMcpServer}
              />
            ) : tab === "hooks" ? (
              <HooksSettingsPanel
                snapshot={snapshot}
                hooksBusy={hooksBusy}
                apiReady={apiReady}
                workspaceBinding={snapshot?.workspaceBinding ?? "none"}
                onSaveHookEntry={onSaveHookEntry}
                onDeleteHookEntry={onDeleteHookEntry}
                onGenerateHookNavigate={onGenerateHookNavigate}
              />
            ) : tab === "general" ? (
              <GeneralSettingsPanel settings={settings} onSavePatch={onSavePatch} />
            ) : tab === "appearance" ? (
              <AppearanceSettingsPanel
                theme={theme}
                onThemeChange={onThemeChange}
                font={font}
                onFontChange={onFontChange}
                clickablePointerCursor={clickablePointerCursor}
                onClickablePointerCursorChange={onClickablePointerCursorChange}
                fontSmoothing={fontSmoothing}
                onFontSmoothingChange={onFontSmoothingChange}
                settings={settings}
                onSavePatch={onSavePatch}
              />
            ) : tab === "networks" ? (
              <NetworksSettingsPanel
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onResetWebHostPairing={onResetWebHostPairing}
              />
            ) : tab === "integrations" ? (
              <IntegrationsSettingsPanel
                isElectronShell={isElectronShell}
                runtime={integrationsRuntime}
              />
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
