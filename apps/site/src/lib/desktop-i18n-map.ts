import type { AppLocale } from "@/i18n/config";
import { getDesktopPack } from "@/i18n/desktop-packs";
import type { Messages } from "@/i18n/messages";

type TranslationParams = Record<string, string | number | boolean | null | undefined> & {
  defaultValue?: string;
};

const MESSAGE_PATHS: Record<string, string> = {
  "titleBar.appMenu": "desktop.titleBar.appMenuAria",
  "titleBar.file": "desktop.titleBar.file",
  "titleBar.edit": "desktop.titleBar.edit",
  "titleBar.view": "desktop.titleBar.view",
  "titleBar.window": "desktop.titleBar.window",
  "titleBar.help": "desktop.titleBar.help",
  "titleBar.minimize": "desktop.titleBar.minimize",
  "titleBar.maximize": "desktop.titleBar.maximize",
  "titleBar.close": "desktop.titleBar.close",
  "titleBar.newSession": "desktop.window.newSession",
  "titleBar.quit": "desktop.titleBar.close",
  "titleBar.undo": "desktop.titleBar.edit",
  "titleBar.redo": "desktop.titleBar.edit",
  "titleBar.cut": "desktop.titleBar.edit",
  "titleBar.copy": "desktop.titleBar.edit",
  "titleBar.paste": "desktop.titleBar.edit",
  "titleBar.selectAll": "desktop.titleBar.edit",
  "titleBar.reload": "desktop.titleBar.view",
  "titleBar.forceReload": "desktop.titleBar.view",
  "titleBar.devTools": "desktop.titleBar.view",
  "titleBar.toggleFullscreen": "desktop.titleBar.view",
  "titleBar.about": "desktop.titleBar.help",
  "app.sidebarAndTools": "desktop.window.toolbarAria",
  "app.hideSidebar": "desktop.window.hideSidebar",
  "app.showSidebar": "desktop.window.showSidebar",
  "app.collapseTools": "desktop.window.collapseTools",
  "app.expandTools": "desktop.window.expandTools",
  "app.selectWorkspace": "desktop.conversation.workspaceSelectorAria",
  "app.searchWorkspace": "desktop.conversation.workspaceSearchPlaceholder",
  "app.addWorkspace": "desktop.conversation.addWorkspace",
  "app.noWorkspace": "desktop.files.noWorkspace",
  "app.noMatches": "desktop.conversation.noMatches",
  "app.selectModel": "desktop.conversation.selectModelAria",
  "app.filterModels": "desktop.conversation.modelFilterPlaceholder",
  "app.noModelsAvailable": "desktop.conversation.noModels",
  "app.send": "desktop.conversation.sendTitle",
  "app.abort": "desktop.conversation.sendTitle",
  "sidebar.newSession": "desktop.sessionSidebar.newSession",
  "sidebar.currentWorkspace": "desktop.sessionSidebar.currentWorkspace",
  "sidebar.extensions": "desktop.sessionSidebar.extensionsButton",
  "sidebar.settingsTabsAria": "desktop.sessionSidebar.settingsTabsAria",
  "sidebar.workspaceSessionsAria": "desktop.sessionSidebar.workspaceSessionsAria",
  "sidebar.settingsNavAria": "desktop.sessionSidebar.settingsNavSidebarAria",
  "sidebar.sessionNavAria": "desktop.sessionSidebar.sessionsSidebarAria",
  "sidebar.workspace": "desktop.sessionSidebar.workspaceHeading",
  "sidebar.resizeWidth": "desktop.tools.resizeAria",
  "composer.planChipLabel": "desktop.conversation.plan",
  "composer.askChipLabel": "desktop.conversation.agent",
  "composer.loopChipLabel": "desktop.conversation.agent",
  "composer.enqueueWhileBusy": "desktop.conversation.sendTitle",
  "git.commit": "desktop.window.commitButton",
  "settings.title": "desktop.sessionSidebar.settingsHeading",
  "settings.capabilityChatLabel": "desktop.models.heading",
  "settings.capabilityImageLabel": "desktop.models.heading",
  "settings.capabilityVideoLabel": "desktop.models.heading",
  "settings.capabilityImageGenerationLabel": "desktop.models.heading",
  "settings.capabilityVideoGenerationLabel": "desktop.models.heading",
  "app.modelPickerReasoningEffort": "desktop.models.heading",
  "composer.removeAttachment": "desktop.models.deleteAction",
  "composer.openInsertPanel": "desktop.models.connectProvider",
  "composer.insert": "desktop.models.connectProvider",
  "workspace.files": "desktop.tools.filesTab",
  "workspace.terminal": "desktop.tools.terminalTab",
  "workspace.gitTab": "desktop.tools.gitTab",
};

const DESKTOP_FALLBACK_KEYS: Record<string, string> = {
  "sidebar.loadMoreSessions": "sidebar.loadMoreSessions",
  "sidebar.sessionBlocked": "sidebar.sessionBlocked",
  "sidebar.sessionCompleted": "sidebar.sessionCompleted",
  "sidebar.sessionActions": "sidebar.sessionActions",
  "sidebar.workspaceActions": "sidebar.workspaceActions",
  "sidebar.deleteSession": "sidebar.deleteSession",
  "sidebar.deleteWorkspace": "sidebar.deleteWorkspace",
  "sidebar.cannotDeleteBusySession": "sidebar.cannotDeleteBusySession",
  "sidebar.deleteSessionConfirmTitle": "sidebar.deleteSessionConfirmTitle",
  "sidebar.deleteSessionConfirmDescription": "sidebar.deleteSessionConfirmDescription",
  "sidebar.deleteWorkspaceConfirmTitle": "sidebar.deleteWorkspaceConfirmTitle",
  "sidebar.deleteWorkspaceConfirmDescription": "sidebar.deleteWorkspaceConfirmDescription",
  "sidebar.noWorkspaceSessions": "sidebar.noWorkspaceSessions",
  "sidebar.automations": "sidebar.automations",
  "sidebar.extensionSettings": "sidebar.extensionSettings",
  "common.back": "common.back",
  "common.running": "common.running",
  "common.cancel": "common.cancel",
  "common.delete": "common.delete",
  "titleBar.quit": "titleBar.quit",
  "titleBar.undo": "titleBar.undo",
  "titleBar.redo": "titleBar.redo",
  "titleBar.cut": "titleBar.cut",
  "titleBar.copy": "titleBar.copy",
  "titleBar.paste": "titleBar.paste",
  "titleBar.selectAll": "titleBar.selectAll",
  "titleBar.reload": "titleBar.reload",
  "titleBar.forceReload": "titleBar.forceReload",
  "titleBar.devTools": "titleBar.devTools",
  "titleBar.toggleFullscreen": "titleBar.toggleFullscreen",
  "titleBar.about": "titleBar.about",
};

function getByPath(object: unknown, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, object);
  return typeof value === "string" ? value : undefined;
}

function formatTranslation(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }
  if (params.defaultValue && template === params.defaultValue) {
    return params.defaultValue;
  }
  return Object.entries(params).reduce((result, [name, value]) => {
    if (name === "defaultValue") {
      return result;
    }
    const text = value == null ? "" : String(value);
    return result.replaceAll(`{{${name}}}`, text).replaceAll(`{${name}}`, text);
  }, template);
}

function resolvePluralSuffix(
  count: number | undefined,
  locale: AppLocale,
  desktopPath: string,
  desktopPack: Record<string, unknown>,
): string {
  if (count == null) {
    return "";
  }
  if (count === 0 && getByPath(desktopPack, `${desktopPath}_zero`)) {
    return "_zero";
  }
  return `_${new Intl.PluralRules(locale).select(count)}`;
}

export function resolveDesktopTranslation(
  key: string,
  locale: AppLocale,
  messages: Messages,
  params?: TranslationParams,
): string {
  if (params?.defaultValue) {
    return formatTranslation(params.defaultValue, params);
  }

  const messagePath = MESSAGE_PATHS[key];
  const fromMessages = messagePath ? getByPath(messages, messagePath) : undefined;
  const desktopPath = DESKTOP_FALLBACK_KEYS[key] ?? key;
  const count = typeof params?.count === "number" ? params.count : undefined;
  const desktopPack = getDesktopPack(locale);
  const desktopEn = getDesktopPack("en-US");
  const pluralSuffix = resolvePluralSuffix(count, locale, desktopPath, desktopPack);
  const fromDesktop =
    (pluralSuffix ? getByPath(desktopPack, `${desktopPath}${pluralSuffix}`) : undefined) ??
    getByPath(desktopPack, desktopPath) ??
    (pluralSuffix ? getByPath(desktopEn, `${desktopPath}${pluralSuffix}`) : undefined) ??
    getByPath(desktopEn, desktopPath);
  const template = fromMessages ?? fromDesktop ?? key.split(".").pop() ?? key;
  return formatTranslation(template, params);
}

export function createDesktopTranslator(locale: AppLocale, messages: Messages) {
  const t = (key: string, params?: TranslationParams) =>
    resolveDesktopTranslation(key, locale, messages, params);
  return { t, i18n: { t, language: locale } };
}
