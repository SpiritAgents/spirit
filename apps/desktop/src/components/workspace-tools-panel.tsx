import {
  memo,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";

import {
  FileText,
  GitBranch,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Globe,
  Maximize2,
  Minimize2,
  Plus,
  Terminal,
} from "lucide-react";
import {
  NewToolTabShortcutKbd,
  WorkspaceToolsMaximizeShortcutKbd,
} from "@/components/layout/desktop-shortcut-kbds";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GitHubConnectTooltipContent } from "@/components/github-sign-in-prompt";
import {
  WorkspaceBrowserTab,
  type WorkspaceBrowserTabProps,
} from "@/components/workspace-browser-tab";
import { WorkspaceFilesTab } from "@/components/workspace-files-tab";
import { WorkspaceGitTab } from "@/components/workspace-git-tab";
import { WorkspacePrTab } from "@/components/workspace-pr-tab";
import { WorkspaceTerminalTab } from "@/components/workspace-terminal-tab";
import { WorkspaceToolTabChip } from "@/components/workspace-tool-tab-chip";
import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_PANE_SPLIT_LINE_CLASS,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { desktopTranslucencyTintClass } from "@/lib/desktop-translucency-surface";
import {
  WORKSPACE_TOOLS_MIN_WIDTH_PX,
  computeWorkspaceToolsMaxWidthPx,
  workspaceToolsShellWidthExpression,
  workspaceToolsShellWidthWhenOpen,
  writeWorkspaceToolsWidthPx,
} from "@/lib/layout-prefs";
import type { PullRequestChipStatus } from "@/lib/pr-diff-attachment";
import { cn } from "@/lib/utils";
import {
  registerWorkspaceNewToolTabShortcut,
  unregisterWorkspaceNewToolTabShortcut,
} from "@/lib/workspace-new-tool-tab-shortcut-bridge";
import {
  consumeFocusWorkspaceToolsPanelOnOpen,
  useWorkspaceToolsChromeActions,
  useWorkspaceToolsChromeMaximized,
  useWorkspaceToolsChromeOpen,
  useWorkspaceToolsChromeWidthFlight,
} from "@/contexts/workspace-tools-chrome-context";
import { setWorkspacePanelRegionActive } from "@/lib/desktop-keyboard-shortcut-eligibility";
import { useGitHubAuthConnected } from "@/hooks/use-github-auth-connected";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { WORKSPACE_TOOL_TABS_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import type { EditorFileTarget, WorkspaceEditorViewMode } from "@/lib/workspace-editor-navigation";
import { resolveWorkspaceFilesTabIcon } from "@/lib/workspace-explorer-icon";
import {
  addWorkspaceToolTab,
  closeWorkspaceToolTab,
  workspaceTerminalChipDisplayName,
  workspaceToolTabLabel,
  type WorkspaceToolTab,
  type WorkspaceToolTabKind,
} from "@/lib/workspace-tool-tabs";
import type {
  DesktopGitSnapshot,
  WorkspaceContentInvalidation,
  GetGitHubPullRequestDetailRequest,
  GitHubAuthStatus,
  GitHubPullRequestDetail,
  GitHubPullRequestForBranchResult,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  SubmitGitChipRequest,
  PlanSnapshot,
  ReadGitHistoryRequest,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "@/types";

export type { WorkspaceToolTab, WorkspaceToolTabKind };

const TAB_KIND_META: Record<WorkspaceToolTabKind, { labelKey: string; icon: typeof FileText }> = {
  files: { labelKey: "workspace.files", icon: FileText },
  terminal: { labelKey: "workspace.terminal", icon: Terminal },
  git: { labelKey: "workspace.gitTab", icon: GitBranch },
  browser: { labelKey: "workspace.browser", icon: Globe },
  pr: { labelKey: "workspace.prTab", icon: GitPullRequest },
};

export type WorkspaceToolsDockProps = {
  /** Resolved workspace root path; empty string while not ready */
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readHostTextFile: (absolutePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeHostTextFile: (request: WriteHostTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  readLocalImagePreviewDataUrl?: (filePath: string) => Promise<string | null>;
  readLocalVideoPreviewUrl?: (filePath: string) => Promise<string | null>;
  plan: PlanSnapshot;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** Only this files tab responds to Plan auto-expansion */
  planRevealTabId?: string | null;
  autoRevealFileNonce?: number;
  fileRevealTabId?: string | null;
  fileRevealPath?: string;
  fileRevealAbsolutePath?: string;
  fileRevealScope?: EditorFileTarget["scope"];
  fileRevealViewMode?: WorkspaceEditorViewMode;
  fileRevealDirectoryOnly?: boolean;
  fileRevealLine?: number | null;
  fileRevealColumn?: number | null;
  searchWorkspaceContent?: (
    request: import("@/types").WorkspaceContentSearchRequest,
  ) => Promise<import("@/types").WorkspaceContentSearchResult>;
  prRevealNonce?: number;
  prRevealTabId?: string | null;
  prRevealRequest?: import("@/lib/workspace-pr-navigation").GitHubPullRequestRevealRequest | null;
  onOpenWorkspaceFile?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  onOpenWorkspaceFileInNewTab?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  onTabsChange: Dispatch<SetStateAction<WorkspaceToolTab[]>>;
  onActiveTabIdChange(id: string): void;
  onBrowserElementPicked?: WorkspaceBrowserTabProps["onElementPicked"];
  onPrDiffAddToSession?: (attachment: import("@/lib/pr-diff-attachment").PrDiffAttachment) => void;
  onTerminalAddToSession?: (
    attachment: import("@/lib/terminal-snippet-attachment").TerminalSnippetAttachment,
  ) => void;
  onFileSnippetAddToSession?: (
    attachment: import("@/lib/file-snippet-attachment").FileSnippetAttachment,
  ) => void;
  onWorkspaceFileAddToSession?: (relativePath: string, sourceTabId?: string) => void;
  onGitCommitAddToSession?: (
    attachment: import("@/lib/git-commit-attachment").GitCommitAttachment,
  ) => void;
  onBrowserOpenInNewTab?: WorkspaceBrowserTabProps["onOpenUrlInNewTab"];
  /** The Electron desktop build can create/use browser tabs; on the Web host the menu item is visible but disabled. */
  browserTabEnabled?: boolean;
  /** The Electron desktop build can create PR tabs; on the Web host the menu item is visible but disabled. */
  prTabEnabled?: boolean;
  onOpenIntegrationsSettings?: () => void;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  getGitHubPullRequestForCurrentBranch: () => Promise<GitHubPullRequestForBranchResult>;
  listGitHubPullRequests: (
    request: import("@/types").ListGitHubPullRequestsRequest,
  ) => Promise<import("@/types").GitHubPullRequestListSnapshot>;
  getGitHubPullRequestTabCounts: (
    request: import("@/types").GetGitHubPullRequestTabCountsRequest,
  ) => Promise<import("@/types").GitHubPullRequestTabCounts>;
  getGitHubPullRequestDetail: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  getGitHubPullRequestConversation: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestConversationSnapshot>;
  getGitHubPullRequestFiles: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestFilesSnapshot>;
  getGitHubPullRequestCommits: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestCommitsSnapshot>;
  getGitHubPullRequestChecks: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestChecksSnapshot>;
  mergeGitHubPullRequest: (
    request: import("@/types").MergeGitHubPullRequestRequest,
  ) => Promise<import("@/types").GitHubPullRequestMergeResult>;
  markGitHubPullRequestReady: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  /** Right panel width (pixels) */
  widthPx: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthPxChange(next: number): void;
  gitSnapshot?: DesktopGitSnapshot;
  workspaceContentInvalidation?: WorkspaceContentInvalidation;
  gitChipBusy?: boolean;
  readGitWorkingTree: () => Promise<GitWorkingTreeSnapshot>;
  readGitHistory: (request?: ReadGitHistoryRequest) => Promise<GitHistorySnapshot>;
  readGitCommitMessage: (
    request: import("@/types").ReadGitCommitMessageRequest,
  ) => Promise<import("@/types").GitCommitMessageSnapshot>;
  submitGitChip: (request: SubmitGitChipRequest) => Promise<boolean>;
  className?: string;
  /** Windows Mica / macOS Vibrancy: forwarded to nested surfaces; the panel shell uses the solid main-area background. */
  useTranslucency?: boolean;
  /** AI completion in the workspace Monaco editor; defaults to true. */
  codeCompletionEnabled?: boolean;
};

type WorkspaceToolsDockContentProps = Omit<
  WorkspaceToolsDockProps,
  "widthPx" | "minWidthPx" | "maxWidthPx" | "onWidthPxChange" | "className"
> & {
  isResizing: boolean;
};

type WorkspaceToolsDockShellProps = Pick<
  WorkspaceToolsDockProps,
  "widthPx" | "minWidthPx" | "maxWidthPx" | "onWidthPxChange" | "className" | "useTranslucency"
> & {
  contentProps: WorkspaceToolsDockContentProps;
};

function resolvePrTabStatusIcon(status: PullRequestChipStatus) {
  switch (status) {
    case "draft":
      return GitPullRequestDraft;
    case "closed":
      return GitPullRequestClosed;
    case "open":
    case "merged":
    default:
      return GitPullRequest;
  }
}

function WorkspaceToolsDockInner(props: WorkspaceToolsDockProps) {
  const {
    widthPx,
    minWidthPx,
    maxWidthPx,
    onWidthPxChange,
    className,
    useTranslucency,
    ...contentProps
  } = props;
  const [isResizing, setIsResizing] = useState(false);

  return (
    <WorkspaceToolsDockShell
      widthPx={widthPx}
      minWidthPx={minWidthPx}
      maxWidthPx={maxWidthPx}
      onWidthPxChange={onWidthPxChange}
      className={className}
      useTranslucency={useTranslucency}
      isResizing={isResizing}
      onResizingChange={setIsResizing}
      contentProps={{ ...contentProps, isResizing, useTranslucency }}
    />
  );
}

function WorkspaceToolsDockShell({
  widthPx,
  minWidthPx = WORKSPACE_TOOLS_MIN_WIDTH_PX,
  maxWidthPx: maxWidthPxProp,
  onWidthPxChange,
  className,
  useTranslucency = false,
  isResizing: _isResizing,
  onResizingChange,
  contentProps,
}: WorkspaceToolsDockShellProps & {
  isResizing: boolean;
  onResizingChange: (resizing: boolean) => void;
}) {
  const { t } = useTranslation();
  const open = useWorkspaceToolsChromeOpen();
  const maximized = useWorkspaceToolsChromeMaximized();
  const widthFlight = useWorkspaceToolsChromeWidthFlight();
  // Fill mode: split/aside track the shell's (possibly animating) width instead of fixed px, so
  // maximize flights and the settled 100% state never show a full shell with underfilled content.
  const fillMode = maximized || widthFlight !== null;
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const latestWidthPxRef = useRef(widthPx);
  latestWidthPxRef.current = widthPx;

  useEffect(() => {
    if (!open || !consumeFocusWorkspaceToolsPanelOnOpen()) {
      return;
    }
    asideRef.current?.focus({ preventScroll: true });
    setWorkspacePanelRegionActive(true);
  }, [open, maximized]);
  const [viewportMaxWidthPx, setViewportMaxWidthPx] = useState(computeWorkspaceToolsMaxWidthPx);
  const maxWidthPx = maxWidthPxProp ?? viewportMaxWidthPx;

  useEffect(() => {
    if (maxWidthPxProp !== undefined) {
      return;
    }
    const onWindowResize = () => {
      setViewportMaxWidthPx(computeWorkspaceToolsMaxWidthPx());
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [maxWidthPxProp]);

  useEffect(() => {
    if (!open) {
      onResizingChange(false);
    }
  }, [open, onResizingChange]);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  const applyDragWidthPx = useCallback((next: number) => {
    const splitWidth = workspaceToolsShellWidthExpression(next);
    if (shellRef.current) {
      shellRef.current.style.width = splitWidth;
    }
    if (splitRef.current) {
      splitRef.current.style.width = splitWidth;
    }
    if (asideRef.current) {
      asideRef.current.style.width = `${next}px`;
    }
  }, []);

  useEffect(() => {
    if (widthPx <= maxWidthPx) {
      return;
    }
    onWidthPxChange(clampWidth(widthPx));
  }, [clampWidth, maxWidthPx, onWidthPxChange, widthPx]);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // No docked-width dragging while maximized or mid-flight; the maximized width is never
      // written back to the docked ratio.
      if (fillMode) {
        return;
      }
      event.preventDefault();
      onResizingChange(true);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      latestWidthPxRef.current = widthPx;
      applyDragWidthPx(widthPx);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [applyDragWidthPx, fillMode, onResizingChange, widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || fillMode) {
        return;
      }
      const delta = drag.startX - event.clientX;
      const next = clampWidth(drag.startWidth + delta);
      latestWidthPxRef.current = next;
      applyDragWidthPx(next);
    },
    [applyDragWidthPx, clampWidth, fillMode],
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      onResizingChange(false);
      if (dragRef.current) {
        onWidthPxChange(latestWidthPxRef.current);
        writeWorkspaceToolsWidthPx(latestWidthPxRef.current);
      }
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released or no capture
      }
    },
    [onResizingChange, onWidthPxChange],
  );

  // Maximized: the enter flight transitions between definite px endpoints (a percentage would be
  // cyclic against the content-sized dock wrapper), then settles to 100% so window resizes follow.
  const enterFlightPx = widthFlight?.kind === "enter" ? widthFlight.targetPx : null;
  const shellWidth = maximized
    ? enterFlightPx !== null
      ? `${enterFlightPx}px`
      : "100%"
    : workspaceToolsShellWidthWhenOpen(open, widthPx);

  return (
    <div
      id="workspace-tools-panel-shell"
      ref={shellRef}
      className={cn(
        // Viewport zoom changes widthPx proportionally: do not attach a permanent width
        // transition to the shell, otherwise resizing the window lags behind.
        // Expand/collapse/maximize is handled by the chrome context, which temporarily
        // writes a transition before changing the width.
        "flex h-full min-h-0 shrink-0 flex-row self-stretch overflow-hidden",
        className,
      )}
      style={{ width: shellWidth }}
    >
      <div
        ref={splitRef}
        data-workspace-tools-split
        className={cn(
          "relative flex h-full min-h-0 flex-row self-stretch",
          fillMode ? "min-w-0 flex-1" : "shrink-0",
          !open && "pointer-events-none select-none",
        )}
        style={{ width: fillMode ? undefined : workspaceToolsShellWidthExpression(widthPx) }}
        aria-hidden={!open}
        inert={!open}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("workspace.resizeToolsWidth")}
          className={cn(
            "group relative z-10 w-px shrink-0 cursor-col-resize touch-none select-none",
            "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
            "transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            maximized && "opacity-0",
            fillMode && "pointer-events-none",
            desktopTranslucencyTintClass(useTranslucency),
          )}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 w-px",
              DESKTOP_PANE_SPLIT_LINE_CLASS,
            )}
            aria-hidden
          />
        </div>

        <aside
          id="workspace-tools-panel"
          ref={asideRef}
          tabIndex={-1}
          data-spirit-surface="workspace-panel"
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-foreground outline-none",
            fillMode ? "flex-1" : "shrink-0",
            desktopTranslucencyTintClass(useTranslucency),
          )}
          style={{ width: fillMode ? undefined : widthPx }}
          aria-label={t("workspace.workspaceTools")}
        >
          <WorkspaceToolsDockContent {...contentProps} />
        </aside>
      </div>
    </div>
  );
}

const WorkspaceToolsDockContent = memo(function WorkspaceToolsDockContent({
  workspaceRoot,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readHostTextFile,
  writeHostTextFile,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  plan,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealTabId = null,
  autoRevealFileNonce = 0,
  fileRevealTabId = null,
  fileRevealPath = "",
  fileRevealAbsolutePath = "",
  fileRevealScope = "workspace",
  fileRevealViewMode = "edit",
  fileRevealDirectoryOnly = false,
  fileRevealLine = null,
  fileRevealColumn = null,
  searchWorkspaceContent,
  prRevealNonce = 0,
  prRevealTabId = null,
  prRevealRequest = null,
  onOpenWorkspaceFile,
  onOpenWorkspaceFileInNewTab,
  tabs,
  activeTabId,
  onTabsChange,
  onActiveTabIdChange,
  onBrowserElementPicked,
  onPrDiffAddToSession,
  onTerminalAddToSession,
  onFileSnippetAddToSession,
  onWorkspaceFileAddToSession,
  onGitCommitAddToSession,
  onBrowserOpenInNewTab,
  browserTabEnabled = false,
  prTabEnabled = false,
  onOpenIntegrationsSettings,
  getGitHubAuthStatus,
  getGitHubPullRequestForCurrentBranch,
  listGitHubPullRequests,
  getGitHubPullRequestTabCounts,
  getGitHubPullRequestDetail,
  getGitHubPullRequestConversation,
  getGitHubPullRequestFiles,
  getGitHubPullRequestCommits,
  getGitHubPullRequestChecks,
  mergeGitHubPullRequest,
  markGitHubPullRequestReady,
  gitSnapshot,
  workspaceContentInvalidation,
  gitChipBusy = false,
  readGitWorkingTree,
  readGitHistory,
  readGitCommitMessage,
  submitGitChip,
  useTranslucency = false,
  codeCompletionEnabled = true,
  isResizing,
}: WorkspaceToolsDockContentProps) {
  const { t } = useTranslation();
  const { openTools, toggleMaximized } = useWorkspaceToolsChromeActions();
  const workspaceToolsOpen = useWorkspaceToolsChromeOpen();
  const workspaceToolsMaximized = useWorkspaceToolsChromeMaximized();
  const workspaceToolsOpenRef = useRef(workspaceToolsOpen);
  workspaceToolsOpenRef.current = workspaceToolsOpen;
  const gitHubAuthConnected = useGitHubAuthConnected(getGitHubAuthStatus, prTabEnabled);
  const prMenuBlocked =
    prTabEnabled && (gitHubAuthConnected === null || gitHubAuthConnected === false);
  /** Mount the terminal only after the user first switches to the Terminal tab (so the default tab does not trigger node-pty); keep it mounted after switching away. */
  const [mountedTerminalTabIds, setMountedTerminalTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [addToolTabMenuOpen, setAddToolTabMenuOpen] = useState(false);
  const toolTabsBarRef = useRef<HTMLDivElement>(null);

  useWorkspaceToolsShellHorizontalDivider(
    toolTabsBarRef,
    {
      enabled: true,
      edge: "bottom",
      dividerAttr: WORKSPACE_TOOL_TABS_SHELL_DIVIDER_ATTR,
    },
    [tabs.length, activeTabId],
  );

  useEffect(() => {
    registerWorkspaceNewToolTabShortcut({
      open() {
        if (!workspaceToolsOpenRef.current) {
          openTools();
        }
        setAddToolTabMenuOpen(true);
      },
    });
    return () => {
      unregisterWorkspaceNewToolTabShortcut();
    };
  }, [openTools]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs]);

  useEffect(() => {
    if (activeTab?.kind !== "terminal") {
      return;
    }
    setMountedTerminalTabIds((prev) => {
      if (prev.has(activeTabId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeTabId);
      return next;
    });
  }, [activeTab?.kind, activeTabId]);

  const handleAddTab = useCallback(
    (kind: WorkspaceToolTabKind) => {
      if (kind === "browser" && !browserTabEnabled) {
        return;
      }
      if (kind === "pr" && (!prTabEnabled || gitHubAuthConnected !== true)) {
        return;
      }
      const vacant = tabs.find((tab) => tab.kind === kind && !tab.tabTitle);
      if (vacant) {
        onActiveTabIdChange(vacant.id);
        return;
      }
      const meta = TAB_KIND_META[kind];
      const defaultTitle = t(meta.labelKey);
      const next = addWorkspaceToolTab(tabs, kind, defaultTitle);
      onTabsChange(next.tabs);
      onActiveTabIdChange(next.activeId);
    },
    [
      browserTabEnabled,
      gitHubAuthConnected,
      prTabEnabled,
      onActiveTabIdChange,
      onTabsChange,
      tabs,
      t,
    ],
  );

  const performCloseTab = useCallback(
    (closeId: string) => {
      const next = closeWorkspaceToolTab(tabs, activeTabId, closeId, {
        includeBrowser: browserTabEnabled,
      });
      onTabsChange(next.tabs);
      onActiveTabIdChange(next.activeId);
      setMountedTerminalTabIds((prev) => {
        if (!prev.has(closeId)) {
          return prev;
        }
        const updated = new Set(prev);
        updated.delete(closeId);
        return updated;
      });
    },
    [activeTabId, browserTabEnabled, onActiveTabIdChange, onTabsChange, tabs],
  );

  const handleCloseTab = useCallback(
    (closeId: string) => {
      const tab = tabs.find((item) => item.id === closeId);
      if (tab?.kind === "files" && tab.tabDirty) {
        setPendingCloseTabId(closeId);
        return;
      }
      performCloseTab(closeId);
    },
    [performCloseTab, tabs],
  );

  const handleConfirmCloseTab = useCallback(() => {
    if (!pendingCloseTabId) {
      return;
    }
    performCloseTab(pendingCloseTabId);
    setPendingCloseTabId(null);
  }, [pendingCloseTabId, performCloseTab]);

  const handleBrowserUrlChange = useCallback(
    (tabId: string, url: string) => {
      onTabsChange((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, browserUrl: url } : item)),
      );
    },
    [onTabsChange],
  );

  const handleTabTitleChange = useCallback(
    (tabId: string, title: string | undefined) => {
      onTabsChange((prev) =>
        prev.map((item) =>
          item.id === tabId
            ? {
                ...item,
                tabTitle: title || undefined,
                tabDirty: title ? item.tabDirty : undefined,
                filesWorkspacePath: title ? item.filesWorkspacePath : undefined,
              }
            : item,
        ),
      );
    },
    [onTabsChange],
  );

  const handleTabDirtyChange = useCallback(
    (tabId: string, dirty: boolean) => {
      onTabsChange((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, tabDirty: dirty || undefined } : item)),
      );
    },
    [onTabsChange],
  );

  const handleTabFilesWorkspacePathChange = useCallback(
    (tabId: string, relativePath: string | undefined) => {
      onTabsChange((prev) =>
        prev.map((item) =>
          item.id === tabId ? { ...item, filesWorkspacePath: relativePath || undefined } : item,
        ),
      );
    },
    [onTabsChange],
  );

  const handleTabPrStatusChange = useCallback(
    (tabId: string, status: PullRequestChipStatus | undefined) => {
      onTabsChange((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, prStatus: status } : item)),
      );
    },
    [onTabsChange],
  );

  return (
    <>
      <div
        ref={toolTabsBarRef}
        data-spirit-surface="workspace-tool-tabs"
        className="flex h-8 shrink-0 items-center gap-1 px-1"
      >
        <ScrollArea
          scrollbars="horizontal"
          type="hover"
          scrollHideDelay={450}
          className="min-h-0 min-w-0 flex-1 self-stretch"
        >
          <div
            role="tablist"
            aria-label={t("workspace.toolTabs")}
            className="flex items-center gap-1"
          >
            {tabs.map((item) => {
              const meta = TAB_KIND_META[item.kind];
              const displayTitle = item.tabTitle;
              const filesTabIcon =
                item.kind === "files" ? resolveWorkspaceFilesTabIcon(displayTitle) : undefined;
              const Icon =
                item.kind === "pr" && item.prStatus
                  ? resolvePrTabStatusIcon(item.prStatus)
                  : (filesTabIcon ?? meta.icon);
              return (
                <WorkspaceToolTabChip
                  key={item.id}
                  tab={item}
                  icon={Icon}
                  label={workspaceToolTabLabel(item.kind, tabs, item.id, t)}
                  selected={item.id === activeTabId}
                  onSelect={onActiveTabIdChange}
                  onClose={handleCloseTab}
                />
              );
            })}
          </div>
        </ScrollArea>
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-workspace-tools-maximize-toggle=""
              aria-label={
                workspaceToolsMaximized ? t("workspace.restoreTools") : t("workspace.maximizeTools")
              }
              aria-pressed={workspaceToolsMaximized}
              onClick={toggleMaximized}
              className={cn(
                "size-7 shrink-0 p-0 text-muted-foreground shadow-none hover:bg-canvas-hover hover:text-sidebar-foreground",
                instantHoverMotionClass,
              )}
            >
              {workspaceToolsMaximized ? (
                <Minimize2 className="size-3.5" aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {workspaceToolsMaximized ? t("workspace.restoreTools") : t("workspace.maximizeTools")}{" "}
            <WorkspaceToolsMaximizeShortcutKbd />
          </TooltipContent>
        </Tooltip>
        <DropdownMenu modal open={addToolTabMenuOpen} onOpenChange={setAddToolTabMenuOpen}>
          <Tooltip delayDuration={300} disableHoverableContent>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-workspace-new-tool-tab=""
                  aria-label={t("workspace.newToolTab")}
                  className={cn(
                    "size-7 shrink-0 p-0 text-muted-foreground shadow-none hover:bg-canvas-hover hover:text-sidebar-foreground",
                    "aria-expanded:bg-canvas-hover aria-expanded:text-sidebar-foreground aria-expanded:hover:bg-canvas-hover",
                    instantHoverMotionClass,
                  )}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {t("common.new")} <NewToolTabShortcutKbd />
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={10}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
            className={cn(
              "flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col",
              DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
              DESKTOP_OVERLAY_LIST_LIST_PADDING,
              DESKTOP_OVERLAY_LIST_LIST_GAP,
            )}
          >
            {(["files", "terminal", "git", "browser", "pr"] as const).map((kind) => {
              const meta = TAB_KIND_META[kind];
              const Icon = meta.icon;
              const browserDisabled = kind === "browser" && !browserTabEnabled;
              const prHostDisabled = kind === "pr" && !prTabEnabled;
              const prAuthBlocked = kind === "pr" && prMenuBlocked;
              const disabled = browserDisabled || prHostDisabled || prAuthBlocked;
              const menuItem = (
                <DropdownMenuItem
                  disabled={disabled}
                  title={
                    browserDisabled
                      ? t("workspace.browserElectronOnly")
                      : prHostDisabled
                        ? t("workspace.prElectronOnly")
                        : undefined
                  }
                  className={cn(
                    "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
                    DESKTOP_OVERLAY_LIST_ITEM,
                    "text-popover-foreground",
                  )}
                  onSelect={() => {
                    handleAddTab(kind);
                  }}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t(meta.labelKey)}</span>
                </DropdownMenuItem>
              );

              if (kind !== "pr" || !prAuthBlocked || prHostDisabled) {
                return (
                  <span key={kind} className="flex w-full min-w-0">
                    {menuItem}
                  </span>
                );
              }

              return (
                <Tooltip key={kind} delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span className="flex w-full min-w-0">{menuItem}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {gitHubAuthConnected === null ? (
                      t("workspace.prGitHubAuthChecking")
                    ) : (
                      <GitHubConnectTooltipContent
                        onSignIn={() => {
                          onOpenIntegrationsSettings?.();
                        }}
                      />
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-xs"
        aria-live="polite"
      >
        {tabs.map((item) => {
          const selected = item.id === activeTabId;
          const panelPadding = item.kind === "files" || item.kind === "terminal" ? "p-0" : "p-0";
          const planRevealEnabled =
            item.kind === "files" && planRevealTabId != null && item.id === planRevealTabId;
          const fileRevealEnabled =
            item.kind === "files" && fileRevealTabId != null && item.id === fileRevealTabId;
          const prRevealEnabled =
            item.kind === "pr" && prRevealTabId != null && item.id === prRevealTabId;

          return (
            <div
              key={item.id}
              id={`workspace-tool-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`workspace-tool-tab-${item.id}`}
              hidden={!selected}
              inert={!selected}
              aria-hidden={!selected}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                panelPadding,
                !selected && "invisible",
              )}
            >
              {item.kind === "files" ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-2 pb-2 pt-0">
                  <WorkspaceFilesTab
                    workspaceRoot={workspaceRoot}
                    plan={plan}
                    listExplorerChildren={listExplorerChildren}
                    gitRevision={gitSnapshot?.revision}
                    workspaceContentInvalidation={workspaceContentInvalidation}
                    readWorkspaceTextFile={readWorkspaceTextFile}
                    writeWorkspaceTextFile={writeWorkspaceTextFile}
                    readHostTextFile={readHostTextFile}
                    writeHostTextFile={writeHostTextFile}
                    readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                    readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
                    readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
                    onStartImplementing={onStartImplementing}
                    startImplementingDisabled={startImplementingDisabled}
                    autoRevealPlanNonce={planRevealEnabled ? autoRevealPlanNonce : 0}
                    planRevealEnabled={planRevealEnabled}
                    autoRevealFileNonce={fileRevealEnabled ? autoRevealFileNonce : 0}
                    fileRevealEnabled={fileRevealEnabled}
                    fileRevealPath={fileRevealPath}
                    fileRevealAbsolutePath={fileRevealAbsolutePath}
                    fileRevealScope={fileRevealScope}
                    fileRevealViewMode={fileRevealViewMode}
                    fileRevealDirectoryOnly={fileRevealDirectoryOnly}
                    fileRevealLine={fileRevealEnabled ? fileRevealLine : null}
                    fileRevealColumn={fileRevealEnabled ? fileRevealColumn : null}
                    searchWorkspaceContent={searchWorkspaceContent}
                    onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                    onDirtyChange={(dirty) => handleTabDirtyChange(item.id, dirty)}
                    onOpenWorkspaceFile={onOpenWorkspaceFile}
                    onOpenWorkspaceFileInNewTab={onOpenWorkspaceFileInNewTab}
                    onFilesWorkspacePathChange={(path) =>
                      handleTabFilesWorkspacePathChange(item.id, path)
                    }
                    onFileSnippetAddToSession={
                      onFileSnippetAddToSession
                        ? (attachment) =>
                            onFileSnippetAddToSession({ ...attachment, sourceTabId: item.id })
                        : undefined
                    }
                    onWorkspaceFileAddToSession={
                      onWorkspaceFileAddToSession
                        ? (relativePath) => onWorkspaceFileAddToSession(relativePath, item.id)
                        : undefined
                    }
                    useTranslucency={useTranslucency}
                    codeCompletionEnabled={codeCompletionEnabled}
                  />
                </div>
              ) : item.kind === "terminal" ? (
                mountedTerminalTabIds.has(item.id) ? (
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <WorkspaceTerminalTab
                      workspaceRoot={workspaceRoot}
                      useTranslucency={useTranslucency}
                      onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                      terminalDisplayName={workspaceTerminalChipDisplayName(item, tabs, t)}
                      onTerminalAddToSession={
                        onTerminalAddToSession
                          ? (attachment) =>
                              onTerminalAddToSession({ ...attachment, sourceTabId: item.id })
                          : undefined
                      }
                      suspendTerminalResize={isResizing}
                    />
                  </div>
                ) : null
              ) : item.kind === "browser" ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <WorkspaceBrowserTab
                    browserTabId={item.id}
                    browserUrl={item.browserUrl}
                    browserTabEnabled={browserTabEnabled}
                    isActive={selected}
                    useTranslucency={useTranslucency}
                    onBrowserUrlChange={(url) => handleBrowserUrlChange(item.id, url)}
                    onOpenUrlInNewTab={onBrowserOpenInNewTab}
                    onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                    onElementPicked={
                      onBrowserElementPicked
                        ? (attachment) =>
                            onBrowserElementPicked({ ...attachment, sourceTabId: item.id })
                        : undefined
                    }
                  />
                </div>
              ) : item.kind === "pr" ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <WorkspacePrTab
                    gitSnapshot={gitSnapshot}
                    isActive={selected}
                    prTabEnabled={prTabEnabled}
                    onOpenIntegrationsSettings={onOpenIntegrationsSettings}
                    getGitHubAuthStatus={getGitHubAuthStatus}
                    getGitHubPullRequestForCurrentBranch={getGitHubPullRequestForCurrentBranch}
                    listGitHubPullRequests={listGitHubPullRequests}
                    getGitHubPullRequestTabCounts={getGitHubPullRequestTabCounts}
                    getGitHubPullRequestDetail={getGitHubPullRequestDetail}
                    getGitHubPullRequestConversation={getGitHubPullRequestConversation}
                    getGitHubPullRequestFiles={getGitHubPullRequestFiles}
                    getGitHubPullRequestCommits={getGitHubPullRequestCommits}
                    getGitHubPullRequestChecks={getGitHubPullRequestChecks}
                    mergeGitHubPullRequest={mergeGitHubPullRequest}
                    markGitHubPullRequestReady={markGitHubPullRequestReady}
                    prRevealEnabled={prRevealEnabled}
                    prRevealNonce={prRevealEnabled ? prRevealNonce : 0}
                    prRevealRequest={prRevealEnabled ? prRevealRequest : null}
                    onPrDiffAddToSession={
                      onPrDiffAddToSession
                        ? (attachment) =>
                            onPrDiffAddToSession({ ...attachment, sourceTabId: item.id })
                        : undefined
                    }
                    useTranslucency={useTranslucency}
                    onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                    onPrStatusChange={(status) => handleTabPrStatusChange(item.id, status)}
                  />
                </div>
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                  <WorkspaceGitTab
                    gitSnapshot={gitSnapshot}
                    isActive={selected}
                    gitChipBusy={gitChipBusy}
                    readGitWorkingTree={readGitWorkingTree}
                    readGitHistory={readGitHistory}
                    readGitCommitMessage={readGitCommitMessage}
                    submitGitChip={submitGitChip}
                    onGitCommitAddToSession={
                      onGitCommitAddToSession
                        ? (attachment) =>
                            onGitCommitAddToSession({ ...attachment, sourceTabId: item.id })
                        : undefined
                    }
                    onOpenChangedFile={onOpenWorkspaceFile}
                  />
                </div>
              )}
            </div>
          );
        })}
        {tabs.length === 0 ? (
          <p className="p-3 text-muted-foreground">{t("workspace.noOpenTabs")}</p>
        ) : null}
      </div>

      <AlertDialog
        open={pendingCloseTabId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCloseTabId(null);
          }
        }}
        title={t("workspace.unsavedChangesCloseConfirmTitle")}
        description={t("workspace.unsavedChangesCloseConfirmDescription")}
        confirmLabel={t("common.close")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          handleConfirmCloseTab();
        }}
      />
    </>
  );
});

export const WorkspaceToolsDock = memo(WorkspaceToolsDockInner);
