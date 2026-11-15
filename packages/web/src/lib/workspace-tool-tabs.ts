import type {
  DesktopExtensionDesktopTabRuntimeIcon,
  DesktopExtensionDesktopTabScope,
} from "@spiritagent/api/types";
import type { PullRequestChipStatus } from "@spiritagent/ui/composer";

export type WorkspaceToolTabKind = "files" | "terminal" | "git" | "browser" | "pr" | "task";
export type WorkspaceBuiltInToolTabKind = WorkspaceToolTabKind;

export const BROWSER_NEW_TAB_SENTINEL = "__spirit_browser_new_tab__";

export type WorkspaceExtensionToolTabScope =
  | { kind: Extract<DesktopExtensionDesktopTabScope, "window-shared"> }
  | { kind: Extract<DesktopExtensionDesktopTabScope, "workspace">; workspaceRoot: string }
  | { kind: Extract<DesktopExtensionDesktopTabScope, "session">; sessionKey: string };

type WorkspaceToolTabBase = {
  id: string;
  /** Current title reported by each child Tab component; only the icon is shown when empty. */
  tabTitle?: string;
  /** Files and extension tabs use the unified unsaved-changes close confirmation. */
  tabDirty?: boolean;
};

export type WorkspaceBuiltInToolTab = WorkspaceToolTabBase & {
  kind: "built-in";
  builtInKind: WorkspaceBuiltInToolTabKind;
  /** Only used when builtInKind === "browser"; the sentinel represents the built-in new tab page. */
  browserUrl?: string;
  /** Only used when builtInKind === "files"; workspace-relative path of the current file. */
  filesWorkspacePath?: string;
  filesViewMode?: "edit" | "preview";
  /** Only used when builtInKind === "pr"; switches the tab icon to the current PR status. */
  prStatus?: PullRequestChipStatus;
  /** Only used when builtInKind === "task"; the resolved task key this tab belongs to. */
  taskKey?: string;
  /** Only used when builtInKind === "task"; task labels must not be replaced by process titles. */
  pinnedTitle?: boolean;
};

export type WorkspaceExtensionToolTab = WorkspaceToolTabBase & {
  kind: "extension";
  extensionId: string;
  contributionId: string;
  /** Stable per-contribution runtime identity; id mirrors this value for renderer compatibility. */
  instanceId: string;
  channelId: string;
  scope: WorkspaceExtensionToolTabScope;
  initialParams?: unknown;
  icon?: DesktopExtensionDesktopTabRuntimeIcon;
};

export type WorkspaceToolTab = WorkspaceBuiltInToolTab | WorkspaceExtensionToolTab;

const KIND_BASE_LABEL_KEY: Record<WorkspaceToolTabKind, string> = {
  files: "workspace.files",
  terminal: "workspace.terminal",
  git: "workspace.gitTab",
  browser: "workspace.browser",
  pr: "workspace.prTab",
  task: "workspace.taskTab",
};

function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isWorkspaceToolTabKind<K extends WorkspaceToolTabKind>(
  tab: WorkspaceToolTab | undefined,
  kind: K,
): tab is WorkspaceBuiltInToolTab & { builtInKind: K } {
  return tab?.kind === "built-in" && tab.builtInKind === kind;
}

export function isBrowserNewTabUrl(url: string | undefined): boolean {
  return url === BROWSER_NEW_TAB_SENTINEL || url === undefined || url === "";
}

export function createWorkspaceToolTab(kind: WorkspaceToolTabKind): WorkspaceBuiltInToolTab {
  const tab: WorkspaceBuiltInToolTab = { id: newTabId(), kind: "built-in", builtInKind: kind };
  if (kind === "browser") {
    tab.browserUrl = BROWSER_NEW_TAB_SENTINEL;
  }
  return tab;
}

export function createExtensionWorkspaceToolTab(input: {
  extensionId: string;
  contributionId: string;
  scope: WorkspaceExtensionToolTabScope;
  initialParams?: unknown;
  icon?: DesktopExtensionDesktopTabRuntimeIcon;
  tabTitle?: string;
  instanceId?: string;
  channelId?: string;
}): WorkspaceExtensionToolTab {
  const instanceId = input.instanceId ?? newTabId();
  return {
    id: instanceId,
    kind: "extension",
    extensionId: input.extensionId,
    contributionId: input.contributionId,
    instanceId,
    channelId: input.channelId ?? newTabId(),
    scope: input.scope,
    ...(input.initialParams === undefined ? {} : { initialParams: input.initialParams }),
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.tabTitle ? { tabTitle: input.tabTitle } : {}),
  };
}

export type WorkspaceToolTabsDefaultsOptions = {
  /** The Electron desktop app includes a browser tab by default; the Web host only has Files / Terminal / Git. */
  includeBrowser?: boolean;
};

/** Default workspace tabs: Files, Terminal, Git; Electron may additionally include Browser. */
export function createDefaultWorkspaceToolTabs(
  options: WorkspaceToolTabsDefaultsOptions = {},
): WorkspaceToolTab[] {
  const kinds: WorkspaceToolTabKind[] = ["files", "terminal", "git"];
  if (options.includeBrowser) {
    kinds.push("browser");
  }
  return kinds.map((kind) => createWorkspaceToolTab(kind));
}

export function createInitialWorkspaceToolsState(includeBrowser = false): {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
} {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser });
  return { tabs, activeTabId: defaultActiveWorkspaceToolTabId(tabs) };
}

export function defaultActiveWorkspaceToolTabId(tabs: readonly WorkspaceToolTab[]): string {
  const files = tabs.find((tab) => isWorkspaceToolTabKind(tab, "files"));
  return files?.id ?? tabs[0]?.id ?? "";
}

export function workspaceToolTabLabel(
  kind: WorkspaceToolTabKind,
  tabs: readonly WorkspaceToolTab[],
  tabId: string,
  translate: (key: string) => string,
): string {
  const index = tabs
    .filter((tab) => isWorkspaceToolTabKind(tab, kind))
    .findIndex((t) => t.id === tabId);
  const base = translate(KIND_BASE_LABEL_KEY[kind]);
  if (index <= 0) {
    return base;
  }
  return `${base} ${index + 1}`;
}

/** Chip display name: prefers the OSC terminal title, otherwise the i18n default Terminal (numbered when multiple tabs). */
export function workspaceTerminalChipDisplayName(
  tab: WorkspaceToolTab,
  tabs: readonly WorkspaceToolTab[],
  translate: (key: string) => string,
): string {
  const titled = tab.tabTitle?.trim();
  if (titled) {
    return titled;
  }
  const index = tabs
    .filter((item) => isWorkspaceToolTabKind(item, "terminal"))
    .findIndex((item) => item.id === tab.id);
  const base = translate("workspace.terminalChipDefaultName");
  if (index <= 0) {
    return base;
  }
  return `${base} ${index + 1}`;
}

export function focusFirstTabOfKind(
  tabs: readonly WorkspaceToolTab[],
  kind: WorkspaceToolTabKind,
): string | null {
  return tabs.find((tab) => isWorkspaceToolTabKind(tab, kind))?.id ?? null;
}

export function isWorkspaceToolTabVisibleInContext(
  tab: WorkspaceToolTab,
  context: { workspaceRoot: string; sessionKey: string },
): boolean {
  if (tab.kind === "built-in" || tab.scope.kind === "window-shared") {
    return true;
  }
  if (tab.scope.kind === "workspace") {
    return tab.scope.workspaceRoot === context.workspaceRoot;
  }
  return tab.scope.sessionKey === context.sessionKey;
}

export function findWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  tabId: string,
): WorkspaceToolTab | undefined {
  return tabs.find((t) => t.id === tabId);
}

export function addWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  kind: WorkspaceToolTabKind,
  tabTitle?: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab(kind);
  if (tabTitle) {
    tab.tabTitle = tabTitle;
  }
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** Task tabs are created only by the task coordinator, never from the manual "+" menu. */
export function addWorkspaceTaskTab(
  tabs: readonly WorkspaceToolTab[],
  input: { taskKey: string; label: string; pinnedTitle?: boolean },
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab("task");
  tab.taskKey = input.taskKey;
  tab.tabTitle = input.label;
  if (input.pinnedTitle === true) {
    tab.pinnedTitle = true;
  }
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** Opens a URL: prefers reusing an untitled empty browser tab, otherwise creates a new one. */
export function openBrowserUrlInWorkspaceTabs(
  tabs: readonly WorkspaceToolTab[],
  url: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const vacant = tabs.find(
    (tab) => isWorkspaceToolTabKind(tab, "browser") && !tab.tabTitle?.trim(),
  );
  if (vacant) {
    return {
      tabs: tabs.map((tab) => (tab.id === vacant.id ? { ...tab, browserUrl: url } : tab)),
      activeId: vacant.id,
    };
  }
  return addWorkspaceBrowserTabWithUrl(tabs, url);
}

/** Creates a browser sub-tab with the target URL directly. */
export function addWorkspaceBrowserTabWithUrl(
  tabs: readonly WorkspaceToolTab[],
  url: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab("browser");
  tab.browserUrl = url;
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** Adds or removes the browser tab according to host capabilities, and fixes activeId. */
export function normalizeWorkspaceToolTabsForHost(
  tabs: readonly WorkspaceToolTab[],
  activeId: string,
  includeBrowser: boolean,
  includePr = false,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  let nextTabs = [...tabs];

  if (!includePr) {
    nextTabs = nextTabs.filter((tab) => !isWorkspaceToolTabKind(tab, "pr"));
  }

  if (includeBrowser) {
    if (!nextTabs.some((tab) => isWorkspaceToolTabKind(tab, "browser"))) {
      nextTabs = [...nextTabs, createWorkspaceToolTab("browser")];
    }
  } else {
    const withoutBrowser = nextTabs.filter((tab) => !isWorkspaceToolTabKind(tab, "browser"));
    nextTabs =
      withoutBrowser.length > 0
        ? withoutBrowser
        : createDefaultWorkspaceToolTabs({ includeBrowser: false });
  }

  const activeStillValid = nextTabs.some((tab) => tab.id === activeId);
  return {
    tabs: nextTabs,
    activeId: activeStillValid ? activeId : defaultActiveWorkspaceToolTabId(nextTabs),
  };
}

function shouldEnsureTabKindAfterClose(
  kind: WorkspaceToolTabKind,
  options: WorkspaceToolTabsDefaultsOptions,
): boolean {
  if (kind === "browser") {
    return options.includeBrowser === true;
  }
  if (kind === "pr") {
    return false;
  }
  return kind === "files" || kind === "terminal" || kind === "git";
}

export function closeWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  activeId: string,
  closeId: string,
  options: WorkspaceToolTabsDefaultsOptions = {},
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const closeIndex = tabs.findIndex((t) => t.id === closeId);
  if (closeIndex < 0) {
    return { tabs: [...tabs], activeId };
  }

  const closingTab = tabs[closeIndex]!;
  let nextTabs = tabs.filter((t) => t.id !== closeId);

  const kindExhausted =
    closingTab.kind === "built-in" &&
    !nextTabs.some((tab) => isWorkspaceToolTabKind(tab, closingTab.builtInKind));
  let recreatedTab: WorkspaceBuiltInToolTab | undefined;
  if (
    closingTab.kind === "built-in" &&
    kindExhausted &&
    shouldEnsureTabKindAfterClose(closingTab.builtInKind, options)
  ) {
    recreatedTab = createWorkspaceToolTab(closingTab.builtInKind);
    nextTabs = [...nextTabs, recreatedTab];
  }

  if (nextTabs.length === 0) {
    return { tabs: nextTabs, activeId: "" };
  }

  if (activeId !== closeId) {
    return { tabs: nextTabs, activeId };
  }

  if (recreatedTab) {
    return { tabs: nextTabs, activeId: recreatedTab.id };
  }

  const nextActiveId = closeIndex > 0 ? nextTabs[closeIndex - 1]!.id : nextTabs[0]!.id;
  return { tabs: nextTabs, activeId: nextActiveId };
}
