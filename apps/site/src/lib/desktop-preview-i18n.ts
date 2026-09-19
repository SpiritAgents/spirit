import { useMemo } from "react";

import { DEFAULT_LOCALE } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import { createDesktopTranslator, resolveDesktopTranslation } from "@/lib/desktop-i18n-map";

type TranslationParams = Record<string, string | number | boolean | null | undefined> & {
  defaultValue?: string;
};

export function useTranslation() {
  const { locale, messages } = useI18n();
  return useMemo(() => createDesktopTranslator(locale, messages), [locale, messages]);
}

const defaultLocale = DEFAULT_LOCALE;
const defaultMessages = {
  desktop: {
    titleBar: {
      appMenuAria: "Application menu",
      file: "File",
      edit: "Edit",
      view: "View",
      window: "Window",
      help: "Help",
      minimize: "Minimize",
      maximize: "Maximize",
      close: "Close",
    },
    sessionSidebar: {
      currentWorkspace: "Current workspace",
      newSession: "New session",
      extensionsButton: "Extensions",
      settingsTabsAria: "Settings tabs",
      workspaceSessionsAria: "Workspace sessions",
      settingsNavSidebarAria: "Settings navigation sidebar",
      sessionsSidebarAria: "Sessions sidebar",
      workspacesHeading: "Workspaces",
      settingsHeading: "Settings",
    },
    conversation: {
      workspaceSelectorAria: "Choose workspace",
      workspaceSearchPlaceholder: "Search workspaces",
      addWorkspace: "Add workspace",
      noMatches: "No matches",
      selectModelAria: "Choose model",
      modelFilterPlaceholder: "Filter models",
      noModels: "No models available",
      sendTitle: "Send",
      plan: "Plan",
      agent: "Agent",
    },
    window: {
      toolbarAria: "Sidebar and tools",
      hideSidebar: "Hide sidebar",
      showSidebar: "Show sidebar",
      collapseTools: "Collapse tools",
      expandTools: "Expand tools",
      commitButton: "Commit",
      newSession: "New session",
    },
    files: { noWorkspace: "No workspace" },
    tools: {
      resizeAria: "Resize tools panel",
      filesTab: "Files",
      terminalTab: "Terminal",
      gitTab: "Git",
    },
    models: { heading: "Models", connectProvider: "Connect provider", deleteAction: "Delete" },
  },
} as never;

const i18n = {
  t: (key: string, params?: TranslationParams) =>
    resolveDesktopTranslation(key, defaultLocale, defaultMessages, params),
  language: defaultLocale,
};

export default i18n;
