import type { AppLocale } from "@/i18n/config";
import { hydrateMessages } from "@/i18n/hydrate";
import de from "@/i18n/locales/de.json";
import enUS from "@/i18n/locales/en-US.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import ja from "@/i18n/locales/ja.json";
import ko from "@/i18n/locales/ko.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import ru from "@/i18n/locales/ru.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import zhTW from "@/i18n/locales/zh-TW.json";

type DesktopConversationCopy = {
  manualAssistantResponse: string;
  demoUserPrompt: string;
  demoThinkingText: string;
  demoAssistantResponse: string;
  agentDemo: DesktopAgentDemoCopy;
  designDemo: DesktopDesignDemoCopy;
  workspaceSelectorAria: string;
  workspaceSearchPlaceholder: string;
  noMatches: string;
  addWorkspace: string;
  runModeAria: string;
  agent: string;
  plan: string;
  selectModelAria: string;
  modelFilterPlaceholder: string;
  noModels: string;
  sendTitle: string;
  thinking: string;
  thought: string;
  compaction: string;
  runningToolHeadline: string;
  runningToolHeadlineSucceeded: string;
  runningToolHeadlineDetail: string;
  runningToolDetails: [string, string];
  runningToolOutput: string;
  emptyTitle: string;
  composerPlaceholder: string;
};

type DesktopAgentDemoCopy = {
  demoUserPrompt: string;
  demoThinkingText: string;
  imageGenRunningHeadline: string;
  imageGenSucceededHeadline: string;
  createPlanHeadlineRunning: string;
  createPlanHeadlineSucceeded: string;
  demoAssistantResponse: string;
  planMarkdown: string;
  planPath: string;
  generatingImage: string;
  previewUnavailable: string;
  viewLargeImage: string;
  closeImagePreview: string;
};

type DesktopDesignDemoCopy = {
  demoUserPrompt: string;
  demoThinkingText: string;
  editFileRunningHeadline: string;
  editFileSucceededHeadline: string;
  editFileRunningDetail: string;
  editFilePath: string;
  demoAssistantResponse: string;
  improvedHeadline: string;
  selectedElementHtml: string;
};

type DesktopModelsCopy = {
  customProvider: string;
  heading: string;
  connectProvider: string;
  current: string;
  savedKey: string;
  cannotDeleteCurrent: string;
  deleteAction: string;
  deleteDialogTitle: string;
  deleteDialogDescription(modelName: string): string;
  cancel: string;
  providerDialogTitle: string;
  providerDialogDescription: string;
  searchPlaceholder: string;
  noMatches: string;
  connectDialogDescriptionCustom: string;
  connectDialogDescriptionDefault: string;
  addModeLabel: string;
  addModeAria: string;
  addSingle: string;
  addAll: string;
  modelNameLabel: string;
  modelNamePlaceholder: string;
  endpointLabel: string;
  optionalPlaceholder: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  addThisModel: string;
  adding: string;
  addProvider: string;
  customConnectionTitle: string;
  connectProviderTitle: string;
};

type DesktopWindowCopy = {
  toolbarAria: string;
  hideSidebar: string;
  showSidebar: string;
  commitButton: string;
  collapseTools: string;
  expandTools: string;
  settingsPlaceholderTitle: string;
  marketplacePlaceholderTitle: string;
  previewEditorOnlyTextError: string;
  hostStatus: string;
  mcpReady: string;
  newSession: string;
};

type DesktopCommitCopy = {
  modeCommit: string;
  modeCommitHint: string;
  modeCommitAndPush: string;
  modeCommitAndPushHint: string;
  title: string;
  currentBranch(branch: string): string;
  messageLabel: string;
  messagePlaceholder: string;
  modeLabel: string;
  modeAria: string;
  cancel: string;
  submitCommit: string;
  submitCommitAndPush: string;
};

type DesktopTitleBarCopy = {
  appMenuAria: string;
  file: string;
  edit: string;
  view: string;
  window: string;
  help: string;
  minimize: string;
  maximize: string;
  close: string;
};

type DesktopSessionSidebarCopy = {
  currentWorkspace: string;
  basics: string;
  models: string;
  skills: string;
  dreams: string;
  extensions: string;
  mcps: string;
  appearance: string;
  settingsNavSidebarAria: string;
  sessionsSidebarAria: string;
  back: string;
  settingsHeading: string;
  pageNavigation: string;
  newSession: string;
  extensionsButton: string;
  workspaceHeading: string;
  settingsTabsAria: string;
  workspaceSessionsAria: string;
  settingsButton: string;
};

type DesktopFilesCopy = {
  noWorkspace: string;
  fileListAria: string;
  planNotCreated: string;
  unsavedCloseConfirm: string;
  saveAria: string;
  saveShortcutTitle: string;
  closeAria: string;
};

type DesktopToolsCopy = {
  filesTab: string;
  terminalTab: string;
  gitTab: string;
  browserTab: string;
  browserBack: string;
  browserForward: string;
  browserReload: string;
  browserAddressBar: string;
  browserPickerToggle: string;
  resizeAria: string;
  panelAria: string;
  tabListAria: string;
  gitChangesHeading: string;
  gitHistoryHeading: string;
  gitRefresh: string;
  gitStageAll: string;
};

type DesktopShellCopy = {
  helpTitle: string;
  helpDir: string;
  helpTree: string;
  helpGitStatus: string;
  helpBuild: string;
  helpClear: string;
  currentWorkspace(workspaceRoot: string): string;
  unsupportedCommand(command: string): string;
  typeHelp: string;
  noWorkspace: string;
  retry: string;
  openSystemTerminal: string;
  exited(exitCode: number): string;
};

type DesktopPreviewCopy = {
  siteReadmeDescription: string;
  desktopReadmeDescription: string;
  generatedWorkspaceDescription(label: string): string;
  generatedWorkspaceOverview(root: string): string;
  heroSession: string;
  landingSession: string;
  agentSession: string;
  designSession: string;
  desktopSession: string;
};

export type Messages = {
  meta: {
    title: string;
    description: string;
  };
  common: {
    brand: string;
    download: string;
    downloadForPlatform(platform: string): string;
  };
  hero: {
    sectionAria: string;
    homeAria: string;
    primaryNavAria: string;
    nav: {
      features: string;
      byok: string;
      agent: string;
      resources: string;
      docs: string;
      changelog: string;
      github: string;
      explore: string;
      exploreFeatures: string;
      exploreResources: string;
      back: string;
      openMenu: string;
      closeMenu: string;
    };
    tagline: string;
    headline: string;
  };
  landing: {
    sectionAria: string;
    featureHeading: [string, string, string];
    featureBody: string;
    agent: {
      sectionAria: string;
      featureHeading: [string, string, string];
      featureBody: string;
    };
    ctaSectionAria: string;
    ctaTitle: string;
    trio: {
      sectionAria: string;
      completion: {
        title: string;
        body: string;
      };
      toolCards: {
        title: string;
        body: string;
        userMessage: string;
        searchRunning: string;
        searchSucceeded: string;
        searchQuery: string;
        readRunning: string;
        readSucceeded: string;
        editRunning: string;
        editSucceeded: string;
        fileName: string;
        assistantMessage: string;
      };
      placeholder: {
        title: string;
        body: string;
      };
    };
  };
  download: {
    metaTitle: string;
    metaDescription: string;
    title: string;
    sectionAria: string;
    desktop: string;
    cli: string;
    acp: string;
    copyInstall: string;
    copied: string;
    comingSoonJoke: string;
    listingInProgress: string;
    cliLogoTitle: string;
    cliUserMessage: string;
    cliAssistantMessage: string;
    cliUserFollowUp: string;
    cliAssistantFollowUp: string;
    cliFooter: string;
  };
  footer: {
    navAria: string;
    externalAria: string;
    columns: {
      features: string;
      resources: string;
    };
    agent: string;
    linkHome: string;
    changelog: string;
    openSourceLicenses: string;
    copyrightLine(year: number): string;
  };
  desktop: {
    titleBar: DesktopTitleBarCopy;
    sessionSidebar: DesktopSessionSidebarCopy;
    conversation: DesktopConversationCopy;
    models: DesktopModelsCopy;
    window: DesktopWindowCopy;
    commit: DesktopCommitCopy;
    files: DesktopFilesCopy;
    tools: DesktopToolsCopy;
    shell: DesktopShellCopy;
    previews: DesktopPreviewCopy;
  };
  docs: {
    title: string;
    metaTitle: string;
    metaDescription: string;
    comingSoon: string;
    sectionAria: string;
    search: string;
    searchPlaceholder: string;
    searchNoResults: string;
    onThisPage: string;
    openMenu: string;
    closeMenu: string;
  };
};

export const messagesByLocale: Record<AppLocale, Messages> = {
  "en-US": hydrateMessages(enUS),
  "zh-CN": hydrateMessages(zhCN),
  "zh-TW": hydrateMessages(zhTW),
  ja: hydrateMessages(ja),
  ko: hydrateMessages(ko),
  de: hydrateMessages(de),
  fr: hydrateMessages(fr),
  es: hydrateMessages(es),
  "pt-BR": hydrateMessages(ptBR),
  ru: hydrateMessages(ru),
};
