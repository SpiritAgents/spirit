import { toast } from "sonner";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useWorkspaceToolsChromeActions } from "@/contexts/workspace-tools-chrome-context";
import { useRecentFilePool } from "@/hooks/useRecentFilePool";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import { readWorkspaceToolsWidthRatio } from "@/lib/layout-prefs";
import {
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
  defaultActiveWorkspaceToolTabId,
  findWorkspaceToolTab,
  isWorkspaceToolTabKind,
  isWorkspaceToolTabVisibleInContext,
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
}: UseWorkspaceToolsControllerOptions) {
  const { setOpen: setWorkspaceToolsOpen } = useWorkspaceToolsChromeActions();
  const [initialWorkspaceTools] = useState(() => createInitialWorkspaceToolsState(false));
  const [workspaceToolTabs, setWorkspaceToolTabs] = useState(() => initialWorkspaceTools.tabs);
  const [activeWorkspaceToolTabId, setActiveWorkspaceToolTabId] = useState(
    () => initialWorkspaceTools.activeTabId,
  );
  const activeWorkspaceToolTabIdRef = useRef(activeWorkspaceToolTabId);
  const workspaceToolTabsRef = useRef(workspaceToolTabs);
  useLayoutEffect(() => {
    activeWorkspaceToolTabIdRef.current = activeWorkspaceToolTabId;
    workspaceToolTabsRef.current = workspaceToolTabs;
  }, [activeWorkspaceToolTabId, workspaceToolTabs]);
  const getWorkspaceToolTabs = useCallback(() => workspaceToolTabsRef.current, []);
  const getActiveWorkspaceToolTabId = useCallback(() => activeWorkspaceToolTabIdRef.current, []);
  const workspaceToolsHostSyncedRef = useRef<typeof runtime.hostKind | null>(null);
  const workspaceToolsHostReadyRef = useRef(false);
  const workspaceToolsHostSignatureRef = useRef("");
  const workspaceToolsHostRevisionRef = useRef(-1);
  const browserTabEnabled = runtime.hostKind === "electron";
  const runtimeApiReady = runtime.apiReady;
  const runtimeHostKind = runtime.hostKind;
  const fetchWorkspaceToolTabs = runtime.getWorkspaceToolTabs;
  const subscribeWorkspaceToolTabsUpdates = runtime.subscribeWorkspaceToolTabsUpdates;
  const persistWorkspaceToolTabs = runtime.syncWorkspaceToolTabs;

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
    [runtime.hostKind, setWorkspaceToolsOpen],
  );

  const recentFilePool = useRecentFilePool({
    workspaceRoot: snapshot?.workspaceRoot ?? "",
    statHostTextFile: runtime.statHostTextFile,
  });
  const recordOpenedFile = recentFilePool.recordOpenedFile;

  const revealEditorFile = useCallback(
    (navigation: ReturnType<typeof buildOpenEditorFileNavigation>) => {
      const target = navigation.reveal;
      recordOpenedFile(target);
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
    [recordOpenedFile, setWorkspaceToolsOpen],
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

  const revealWorkspaceDirectory = useCallback(
    (relativePath: string) => {
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
    },
    [setWorkspaceToolsOpen],
  );

  const openGitTab = useCallback(
    (preferTabId?: string) => {
      if (preferTabId) {
        const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, preferTabId);
        if (isWorkspaceToolTabKind(tab, "git")) {
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
    },
    [setWorkspaceToolsOpen],
  );

  const focusWorkspaceToolTab = useCallback(
    (tabId: string) => {
      const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, tabId);
      if (!tab) {
        return false;
      }
      setWorkspaceToolsOpen(true);
      setActiveWorkspaceToolTabId(tabId);
      return true;
    },
    [setWorkspaceToolsOpen],
  );

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
      if (!isWorkspaceToolTabKind(tab, "files")) {
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

  const revealWorkspaceDirectoryOnTab = useCallback(
    (tabId: string, relativePath: string) => {
      const tab = findWorkspaceToolTab(workspaceToolTabsRef.current, tabId);
      if (!isWorkspaceToolTabKind(tab, "files")) {
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
    },
    [revealWorkspaceDirectory, setWorkspaceToolsOpen],
  );

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
        if (isWorkspaceToolTabKind(tab, "browser")) {
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
      const vacant = tabs.find(
        (tab) => isWorkspaceToolTabKind(tab, "browser") && !tab.tabTitle?.trim(),
      );
      const existing = vacant ?? tabs.find((tab) => isWorkspaceToolTabKind(tab, "browser"));
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
    [openBrowserUrlInNewTab, runtime.hostKind, setWorkspaceToolsOpen],
  );

  const openExtensionLink = runtime.openExtensionLink;
  const openWorkspaceUrl = useCallback(
    (url: string, sourceTabId?: string) => {
      void openExtensionLink({ url, sourceTabId })
        .then((handled) => {
          if (handled) setWorkspaceToolsOpen(true);
          else focusOrOpenBrowserUrl(url);
        })
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
    },
    [openExtensionLink, focusOrOpenBrowserUrl, setWorkspaceToolsOpen],
  );

  const openWorkspacePlan = useCallback(() => {
    setWorkspaceToolsOpen(true);

    const tabs = workspaceToolTabsRef.current;
    const activeTabId = activeWorkspaceToolTabIdRef.current;
    const activeTab = findWorkspaceToolTab(tabs, activeTabId);
    let targetFilesTabId: string;
    if (isWorkspaceToolTabKind(activeTab, "files")) {
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
    workspaceToolsHostReadyRef.current = false;
    workspaceToolsHostRevisionRef.current = -1;
    if (!runtimeApiReady || runtimeHostKind !== "electron") {
      return;
    }
    let disposed = false;
    const applySnapshot = (snapshot: import("@/types").DesktopWorkspaceToolsSnapshot) => {
      if (disposed || snapshot.revision < workspaceToolsHostRevisionRef.current) {
        return;
      }
      workspaceToolsHostRevisionRef.current = snapshot.revision;
      workspaceToolsHostSignatureRef.current = JSON.stringify({
        tabs: snapshot.tabs,
        activeTabId: snapshot.activeTabId,
      });
      setWorkspaceToolTabs(snapshot.tabs);
      setActiveWorkspaceToolTabId(snapshot.activeTabId);
      workspaceToolsHostReadyRef.current = true;
    };
    const unsubscribe = subscribeWorkspaceToolTabsUpdates(applySnapshot);
    void fetchWorkspaceToolTabs()
      .then(applySnapshot)
      .catch((error: unknown) => {
        console.error("[workspace-tabs] failed to restore Desktop tabs", error);
      });
    return () => {
      disposed = true;
      workspaceToolsHostReadyRef.current = false;
      unsubscribe();
    };
  }, [runtimeApiReady, runtimeHostKind, fetchWorkspaceToolTabs, subscribeWorkspaceToolTabsUpdates]);

  useEffect(() => {
    if (runtimeHostKind !== "electron" || !workspaceToolsHostReadyRef.current) {
      return;
    }
    const signature = JSON.stringify({
      tabs: workspaceToolTabs,
      activeTabId: activeWorkspaceToolTabId,
    });
    if (signature === workspaceToolsHostSignatureRef.current) {
      return;
    }
    workspaceToolsHostSignatureRef.current = signature;
    void persistWorkspaceToolTabs({
      expectedRevision: workspaceToolsHostRevisionRef.current,
      tabs: workspaceToolTabs,
      activeTabId: activeWorkspaceToolTabId,
    }).catch((error: unknown) => {
      workspaceToolsHostSignatureRef.current = "";
      console.error("[workspace-tabs] failed to persist Desktop tabs", error);
    });
  }, [activeWorkspaceToolTabId, runtimeHostKind, persistWorkspaceToolTabs, workspaceToolTabs]);

  const activeTab = findWorkspaceToolTab(workspaceToolTabs, activeWorkspaceToolTabId);
  const tabVisibilityContext = {
    workspaceRoot: snapshot?.workspaceRoot ?? "",
    sessionKey: snapshot?.composerSessionKey ?? "",
  };
  if (
    activeTab?.kind === "extension" &&
    !isWorkspaceToolTabVisibleInContext(activeTab, tabVisibilityContext)
  ) {
    const visibleTabs = workspaceToolTabs.filter((tab) =>
      isWorkspaceToolTabVisibleInContext(tab, tabVisibilityContext),
    );
    setActiveWorkspaceToolTabId(defaultActiveWorkspaceToolTabId(visibleTabs));
  }

  useEffect(() => {
    if (!runtimeApiReady || runtimeHostKind == null) {
      return;
    }
    if (workspaceToolsHostSyncedRef.current === runtimeHostKind) {
      return;
    }
    workspaceToolsHostSyncedRef.current = runtimeHostKind;
    const includeBrowser = runtimeHostKind === "electron";
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
  }, [runtimeApiReady, runtimeHostKind]);

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
  const plan = snapshot?.plan;
  const planSessionPath = snapshot?.activeSession?.filePath ?? null;

  useEffect(() => {
    if (!plan) {
      return;
    }

    const sessionChanged =
      previousActiveSessionPathRef.current !== null &&
      previousActiveSessionPathRef.current !== planSessionPath;

    const previousExists = previousPlanExistsRef.current;
    const previousModifiedAt = previousPlanModifiedAtRef.current;

    previousActiveSessionPathRef.current = planSessionPath;
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
  }, [openWorkspacePlan, plan, planSessionPath]);

  const visibleWorkspaceToolTabs = useMemo(
    () =>
      workspaceToolTabs.filter((tab) =>
        isWorkspaceToolTabVisibleInContext(tab, {
          workspaceRoot: snapshot?.workspaceRoot ?? "",
          sessionKey: snapshot?.composerSessionKey ?? "",
        }),
      ),
    [snapshot?.composerSessionKey, snapshot?.workspaceRoot, workspaceToolTabs],
  );

  return {
    setWorkspaceToolsOpen,
    visibleWorkspaceToolTabs,
    workspaceToolTabs,
    setWorkspaceToolTabs,
    activeWorkspaceToolTabId,
    setActiveWorkspaceToolTabId,
    getWorkspaceToolTabs,
    getActiveWorkspaceToolTabId,
    workspaceToolsWidthRatio,
    setWorkspaceToolsWidthRatio,
    browserTabEnabled,

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

    openGitTab,
    openWorkspacePlan,
    openWorkspaceUrl,
  };
}
