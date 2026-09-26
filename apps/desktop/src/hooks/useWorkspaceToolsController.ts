import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceToolsChromeActions } from "@/contexts/workspace-tools-chrome-context";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import { readWorkspaceToolsWidthRatio } from "@/lib/layout-prefs";
import {
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  normalizeWorkspaceToolTabsForHost,
  openBrowserUrlInWorkspaceTabs,
} from "@/lib/workspace-tool-tabs";
import {
  buildOpenEditorFileInNewTabNavigation,
  buildOpenEditorFileNavigation,
  findFilesTabWithWorkspacePath,
  resolveWorkspaceFilesTab,
  type EditorFileTarget,
  type WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import {
  buildOpenPullRequestNavigation,
  type GitHubPullRequestRevealRequest,
} from "@/lib/workspace-pr-navigation";
import { resolveWorkspaceGitTab } from "@/lib/workspace-git-navigation";
import type { DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type UseWorkspaceToolsControllerOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  activeFilePath: string | null;
};

export function useWorkspaceToolsController({
  runtime,
  snapshot,
  activeFilePath,
}: UseWorkspaceToolsControllerOptions) {
  const { setOpen: setWorkspaceToolsOpen } = useWorkspaceToolsChromeActions();
  const initialWorkspaceToolsRef = useRef<ReturnType<
    typeof createInitialWorkspaceToolsState
  > | null>(null);
  if (initialWorkspaceToolsRef.current === null) {
    initialWorkspaceToolsRef.current = createInitialWorkspaceToolsState(false);
  }
  const initialWorkspaceTools = initialWorkspaceToolsRef.current;
  const [workspaceToolTabs, setWorkspaceToolTabs] = useState(() => initialWorkspaceTools.tabs);
  const [activeWorkspaceToolTabId, setActiveWorkspaceToolTabId] = useState(
    () => initialWorkspaceTools.activeTabId,
  );
  const activeWorkspaceToolTabIdRef = useRef(activeWorkspaceToolTabId);
  activeWorkspaceToolTabIdRef.current = activeWorkspaceToolTabId;
  const workspaceToolTabsRef = useRef(workspaceToolTabs);
  workspaceToolTabsRef.current = workspaceToolTabs;
  const workspaceToolsHostSyncedRef = useRef<typeof runtime.hostKind | null>(null);
  const browserTabEnabled = runtime.hostKind === "electron";
  const prTabEnabled = runtime.hostKind === "electron";
  const [workspaceFilesPlanRevealNonce, setWorkspaceFilesPlanRevealNonce] = useState(0);
  const [workspaceFilesPlanRevealTargetId, setWorkspaceFilesPlanRevealTargetId] = useState<
    string | null
  >(null);
  const [workspaceFileRevealNonce, setWorkspaceFileRevealNonce] = useState(0);
  const [workspaceFileRevealTargetId, setWorkspaceFileRevealTargetId] = useState<string | null>(
    null,
  );
  const [workspaceFileRevealPath, setWorkspaceFileRevealPath] = useState("");
  const [workspaceFileRevealAbsolutePath, setWorkspaceFileRevealAbsolutePath] = useState("");
  const [workspaceFileRevealScope, setWorkspaceFileRevealScope] =
    useState<EditorFileTarget["scope"]>("workspace");
  const [workspaceFileRevealViewMode, setWorkspaceFileRevealViewMode] =
    useState<WorkspaceEditorViewMode>("edit");
  const [workspaceFileRevealDirectoryOnly, setWorkspaceFileRevealDirectoryOnly] = useState(false);
  const [workspaceFileRevealLine, setWorkspaceFileRevealLine] = useState<number | null>(null);
  const [workspaceFileRevealColumn, setWorkspaceFileRevealColumn] = useState<number | null>(null);
  const [workspaceToolsWidthRatio, setWorkspaceToolsWidthRatio] = useState(
    readWorkspaceToolsWidthRatio,
  );
  const [workspacePrRevealNonce, setWorkspacePrRevealNonce] = useState(0);
  const [workspacePrRevealTargetId, setWorkspacePrRevealTargetId] = useState<string | null>(null);
  const [workspacePrRevealRequest, setWorkspacePrRevealRequest] =
    useState<GitHubPullRequestRevealRequest | null>(null);

  const openBrowserUrlInNewTab = useCallback(
    (rawUrl: string) => {
      if (runtime.hostKind !== "electron") {
        return;
      }
      const url = normalizeBrowserUrl(rawUrl);
      if (!url) {
        return;
      }
      const navigation = openBrowserUrlInWorkspaceTabs(workspaceToolTabsRef.current, url);
      setWorkspaceToolsOpen(true);
      setWorkspaceToolTabs(navigation.tabs);
      setActiveWorkspaceToolTabId(navigation.activeId);
    },
    [runtime.hostKind],
  );

  const revealEditorFile = useCallback(
    (navigation: ReturnType<typeof buildOpenEditorFileNavigation>) => {
      const target = navigation.reveal;
      setWorkspaceToolsOpen(true);
      setWorkspaceToolTabs(navigation.tabs);
      setActiveWorkspaceToolTabId(navigation.activeTabId);
      setWorkspaceFileRevealTargetId(navigation.filesTabId);
      setWorkspaceFileRevealScope(target.scope);
      setWorkspaceFileRevealViewMode(target.viewMode);
      setWorkspaceFileRevealDirectoryOnly(false);
      setWorkspaceFileRevealLine(target.reveal?.line ?? null);
      setWorkspaceFileRevealColumn(target.reveal?.column ?? null);
      if (target.scope === "workspace") {
        setWorkspaceFileRevealPath(target.relativePath);
        setWorkspaceFileRevealAbsolutePath("");
      } else {
        setWorkspaceFileRevealPath("");
        setWorkspaceFileRevealAbsolutePath(target.absolutePath);
      }
      setWorkspaceFileRevealNonce((value) => value + 1);
    },
    [setWorkspaceToolsOpen],
  );

  const openEditorFile = useCallback(
    (target: EditorFileTarget) => {
      revealEditorFile(
        buildOpenEditorFileNavigation({
          tabs: workspaceToolTabsRef.current,
          activeTabId: activeWorkspaceToolTabIdRef.current,
          target,
        }),
      );
    },
    [revealEditorFile],
  );

  const openWorkspaceFile = useCallback(
    (
      relativePath: string,
      options?: {
        viewMode?: WorkspaceEditorViewMode;
        reveal?: import("@/lib/workspace-editor-navigation").EditorFileRevealLocation;
      },
    ) => {
      const target: EditorFileTarget = {
        scope: "workspace",
        relativePath,
        viewMode: options?.viewMode ?? "edit",
        reveal: options?.reveal,
      };
      const tabs = workspaceToolTabsRef.current;
      const existingTabId = findFilesTabWithWorkspacePath(tabs, relativePath);
      if (existingTabId) {
        revealEditorFile({
          tabs: [...tabs],
          activeTabId: existingTabId,
          filesTabId: existingTabId,
          reveal: target,
        });
        return;
      }
      openEditorFile(target);
    },
    [openEditorFile, revealEditorFile],
  );

  const openWorkspaceFileInNewTab = useCallback(
    (
      relativePath: string,
      options?: {
        viewMode?: WorkspaceEditorViewMode;
        reveal?: import("@/lib/workspace-editor-navigation").EditorFileRevealLocation;
      },
    ) => {
      revealEditorFile(
        buildOpenEditorFileInNewTabNavigation({
          tabs: workspaceToolTabsRef.current,
          activeTabId: activeWorkspaceToolTabIdRef.current,
          target: {
            scope: "workspace",
            relativePath,
            viewMode: options?.viewMode ?? "edit",
            reveal: options?.reveal,
          },
        }),
      );
    },
    [revealEditorFile],
  );

  const revealWorkspaceDirectory = useCallback((relativePath: string) => {
    const navigation = resolveWorkspaceFilesTab(
      workspaceToolTabsRef.current,
      activeWorkspaceToolTabIdRef.current,
    );
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspaceFileRevealTargetId(navigation.filesTabId);
    setWorkspaceFileRevealScope("workspace");
    setWorkspaceFileRevealDirectoryOnly(true);
    setWorkspaceFileRevealPath(relativePath.replace(/\/+$/u, ""));
    setWorkspaceFileRevealAbsolutePath("");
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, []);

  const openGitTab = useCallback((preferTabId?: string) => {
    if (preferTabId) {
      const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, preferTabId);
      if (tab?.kind === "git") {
        setWorkspaceToolsOpen(true);
        setActiveWorkspaceToolTabId(preferTabId);
        return;
      }
    }
    const navigation = resolveWorkspaceGitTab(
      workspaceToolTabsRef.current,
      activeWorkspaceToolTabIdRef.current,
    );
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
  }, []);

  const focusWorkspaceToolTab = useCallback((tabId: string) => {
    const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, tabId);
    if (!tab) {
      return false;
    }
    setWorkspaceToolsOpen(true);
    setActiveWorkspaceToolTabId(tabId);
    return true;
  }, []);

  const openWorkspaceFileOnTab = useCallback(
    (
      tabId: string,
      relativePath: string,
      options?: {
        viewMode?: WorkspaceEditorViewMode;
        reveal?: import("@/lib/workspace-editor-navigation").EditorFileRevealLocation;
      },
    ) => {
      const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, tabId);
      if (tab?.kind !== "files") {
        openWorkspaceFile(relativePath, options);
        return;
      }
      revealEditorFile({
        tabs: [...workspaceToolTabsRef.current],
        activeTabId: tabId,
        filesTabId: tabId,
        reveal: {
          scope: "workspace",
          relativePath,
          viewMode: options?.viewMode ?? "edit",
          reveal: options?.reveal,
        },
      });
    },
    [openWorkspaceFile, revealEditorFile],
  );

  const revealWorkspaceDirectoryOnTab = useCallback((tabId: string, relativePath: string) => {
    const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, tabId);
    if (tab?.kind !== "files") {
      revealWorkspaceDirectory(relativePath);
      return;
    }
    setWorkspaceToolsOpen(true);
    setActiveWorkspaceToolTabId(tabId);
    setWorkspaceFileRevealTargetId(tabId);
    setWorkspaceFileRevealScope("workspace");
    setWorkspaceFileRevealDirectoryOnly(true);
    setWorkspaceFileRevealPath(relativePath.replace(/\/+$/u, ""));
    setWorkspaceFileRevealAbsolutePath("");
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, []);

  const focusOrOpenBrowserUrl = useCallback(
    (rawUrl: string, preferTabId?: string) => {
      if (runtime.hostKind !== "electron") {
        return;
      }
      const url = normalizeBrowserUrl(rawUrl);
      if (!url) {
        return;
      }
      if (preferTabId) {
        const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, preferTabId);
        if (tab?.kind === "browser") {
          setWorkspaceToolsOpen(true);
          setWorkspaceToolTabs(
            workspaceToolTabsRef.current.map((item) =>
              item.id === preferTabId ? { ...item, browserUrl: url } : item,
            ),
          );
          setActiveWorkspaceToolTabId(preferTabId);
          return;
        }
      }
      const tabs = workspaceToolTabsRef.current;
      const vacant = tabs.find((tab) => tab.kind === "browser" && !tab.tabTitle?.trim());
      const existing = vacant ?? tabs.find((tab) => tab.kind === "browser");
      if (existing) {
        setWorkspaceToolsOpen(true);
        setWorkspaceToolTabs(
          tabs.map((tab) => (tab.id === existing.id ? { ...tab, browserUrl: url } : tab)),
        );
        setActiveWorkspaceToolTabId(existing.id);
        return;
      }
      openBrowserUrlInNewTab(url);
    },
    [openBrowserUrlInNewTab, runtime.hostKind],
  );

  const openPullRequestInPrTab = useCallback(
    (request: GitHubPullRequestRevealRequest, preferTabId?: string) => {
      if (runtime.hostKind !== "electron") {
        return;
      }
      if (preferTabId) {
        const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, preferTabId);
        if (tab?.kind === "pr") {
          setWorkspaceToolsOpen(true);
          setActiveWorkspaceToolTabId(preferTabId);
          setWorkspacePrRevealTargetId(preferTabId);
          setWorkspacePrRevealRequest(request);
          setWorkspacePrRevealNonce((value) => value + 1);
          return;
        }
      }
      const navigation = buildOpenPullRequestNavigation({
        tabs: workspaceToolTabsRef.current,
        activeTabId: activeWorkspaceToolTabIdRef.current,
        request,
      });
      setWorkspaceToolsOpen(true);
      setWorkspaceToolTabs(navigation.tabs);
      setActiveWorkspaceToolTabId(navigation.activeTabId);
      setWorkspacePrRevealTargetId(navigation.prTabId);
      setWorkspacePrRevealRequest(navigation.request);
      setWorkspacePrRevealNonce((value) => value + 1);
    },
    [runtime.hostKind],
  );

  const openWorkspacePlan = useCallback(() => {
    setWorkspaceToolsOpen(true);

    const tabs = workspaceToolTabsRef.current;
    const activeTabId = activeWorkspaceToolTabIdRef.current;
    const activeTab = findWorkspaceToolTab(tabs, activeTabId);
    let targetFilesTabId: string;
    if (activeTab?.kind === "files") {
      targetFilesTabId = activeTabId;
    } else {
      const firstFilesId = focusFirstTabOfKind(tabs, "files");
      if (firstFilesId) {
        targetFilesTabId = firstFilesId;
        setActiveWorkspaceToolTabId(firstFilesId);
      } else {
        const added = addWorkspaceToolTab(tabs, "files");
        setWorkspaceToolTabs(added.tabs);
        setActiveWorkspaceToolTabId(added.activeId);
        targetFilesTabId = added.activeId;
      }
    }

    setWorkspaceFilesPlanRevealTargetId(targetFilesTabId);
    setWorkspaceFilesPlanRevealNonce((value) => value + 1);
  }, [setWorkspaceToolsOpen]);

  useEffect(() => {
    if (!runtime.apiReady || runtime.hostKind == null) {
      return;
    }
    if (workspaceToolsHostSyncedRef.current === runtime.hostKind) {
      return;
    }
    workspaceToolsHostSyncedRef.current = runtime.hostKind;
    const includeBrowser = runtime.hostKind === "electron";
    setWorkspaceToolTabs((prev) => {
      const normalized = normalizeWorkspaceToolTabsForHost(
        prev,
        activeWorkspaceToolTabIdRef.current,
        includeBrowser,
      );
      if (normalized.activeId !== activeWorkspaceToolTabIdRef.current) {
        setActiveWorkspaceToolTabId(normalized.activeId);
      }
      return normalized.tabs;
    });
  }, [runtime.apiReady, runtime.hostKind]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeBrowserOpenUrl) {
      return;
    }
    return bridge.subscribeBrowserOpenUrl(openBrowserUrlInNewTab);
  }, [openBrowserUrlInNewTab]);

  const previousPlanModifiedAtRef = useRef<number | undefined>(undefined);
  const previousPlanExistsRef = useRef<boolean | undefined>(undefined);
  const previousActiveSessionPathRef = useRef<string | null>(null);

  useEffect(() => {
    const plan = snapshot?.plan;
    const sessionPath = snapshot?.activeSession?.filePath ?? null;
    if (!plan) {
      return;
    }

    const sessionChanged =
      previousActiveSessionPathRef.current !== null &&
      previousActiveSessionPathRef.current !== sessionPath;

    const previousExists = previousPlanExistsRef.current;
    const previousModifiedAt = previousPlanModifiedAtRef.current;

    previousActiveSessionPathRef.current = sessionPath;
    previousPlanExistsRef.current = plan.exists;
    previousPlanModifiedAtRef.current = plan.modifiedAtUnixMs;

    if (sessionChanged) {
      return;
    }

    const created = previousExists === false && plan.exists;
    const modified =
      plan.exists &&
      plan.modifiedAtUnixMs !== undefined &&
      previousModifiedAt !== undefined &&
      plan.modifiedAtUnixMs !== previousModifiedAt;

    if (!created && !modified) {
      return;
    }

    openWorkspacePlan();
  }, [
    activeFilePath,
    openWorkspacePlan,
    snapshot?.plan?.exists,
    snapshot?.plan?.modifiedAtUnixMs,
    snapshot?.plan,
  ]);

  return {
    setWorkspaceToolsOpen,
    workspaceToolTabs,
    setWorkspaceToolTabs,
    activeWorkspaceToolTabId,
    setActiveWorkspaceToolTabId,
    workspaceToolsWidthRatio,
    setWorkspaceToolsWidthRatio,
    browserTabEnabled,
    prTabEnabled,
    workspaceFilesPlanRevealNonce,
    workspaceFilesPlanRevealTargetId,
    workspaceFileRevealNonce,
    workspaceFileRevealTargetId,
    workspaceFileRevealPath,
    workspaceFileRevealAbsolutePath,
    workspaceFileRevealScope,
    workspaceFileRevealViewMode,
    workspaceFileRevealDirectoryOnly,
    workspaceFileRevealLine,
    workspaceFileRevealColumn,
    openBrowserUrlInNewTab,
    focusOrOpenBrowserUrl,
    openEditorFile,
    openWorkspaceFile,
    openWorkspaceFileInNewTab,
    openWorkspaceFileOnTab,
    revealWorkspaceDirectory,
    revealWorkspaceDirectoryOnTab,
    focusWorkspaceToolTab,
    openPullRequestInPrTab,
    openGitTab,
    openWorkspacePlan,
    workspacePrRevealNonce,
    workspacePrRevealTargetId,
    workspacePrRevealRequest,
  };
}
