import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { useTranslation } from "react-i18next";
import type * as Monaco from "monaco-editor";

import { Eye, ListTree, Play, Search, SquarePen } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  WorkspaceMarkdownLinkProvider,
  useWorkspaceMarkdownLinkClick,
  type WorkspaceMarkdownLinkClickHandler,
} from "@/components/workspace-markdown-link-context";

import {
  WorkspaceImagePreviewPane,
  type WorkspaceImagePreviewState,
} from "@/components/workspace-image-preview-pane";
import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import { WorkspaceFilesSearchPanel } from "@/components/workspace-files-search-panel";
import {
  FileDomSelectionMenu,
  FileMonacoSelectionMenu,
} from "@/components/workspace-file-selection-menu";
import {
  WorkspaceMonacoEditor,
  type WorkspaceMonacoEditorHandle,
  type WorkspaceMonacoSearchMatchRange,
} from "@/components/workspace-monaco-editor";
import { dirnameLocalPath } from "@/lib/markdown-local-image-src";
import { cn } from "@/lib/utils";
import {
  DESKTOP_FILES_EXPLORER_TOOLBAR_ICON_BTN,
  DESKTOP_SHELL_LAYOUT_TRANSITION,
} from "@/lib/desktop-chrome";
import { desktopTranslucencyFileDetailSurfaceClass } from "@/lib/desktop-translucency-surface";
import {
  WORKSPACE_FILES_TREE_MIN_WIDTH_PX,
  computeWorkspaceFilesTreeMaxWidthPx,
  readWorkspaceFilesTreeWidthPx,
  writeWorkspaceFilesTreeWidthPx,
} from "@/lib/layout-prefs";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { useHostApi } from "@/hooks/useHostApi";
import { FILES_EXPLORER_TOOLBAR_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
} from "@/components/tool-call/tool-call-types";
import {
  isUnderWorkspaceEntryPath,
  joinWorkspaceAbsolutePath,
  remapWorkspaceEntryPath,
  normalizeWorkspaceEntryRel,
} from "@/lib/workspace-entry-path-sync";
import { ripgrepSubmatchToCodeUnitRange } from "@/lib/workspace-files-search";
import { tryHandleMarkdownWorkspaceLink } from "@/lib/markdown-workspace-link";
import type {
  EditorFileTarget,
  EditorFileRevealLocation,
  WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import { installContainedSelectAll } from "@/lib/contained-text-selection";
import { workspaceContentInvalidationTouchesPath } from "@/lib/workspace-content-invalidation";
import type {
  PlanSnapshot,
  WorkspaceContentInvalidation,
  WorkspaceContentSearchMatch,
  WorkspaceContentSearchRequest,
  WorkspaceContentSearchResult,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "@/types";

type SelectedWorkspaceEntry = { kind: "workspace"; relativePath: string };
type SelectedExternalEntry = { kind: "external"; absolutePath: string };
type SelectedPlanEntry = { kind: "plan" };
type SelectedEntry = SelectedWorkspaceEntry | SelectedExternalEntry | SelectedPlanEntry | null;
type MarkdownViewMode = "preview" | "edit";

type LoadedDoc =
  | { status: "loading"; readOnly: boolean; title: string; subtitle: string }
  | { status: "ready"; text: string; readOnly: boolean; title: string; subtitle: string }
  | { status: "binary"; readOnly: boolean; title: string; subtitle: string }
  | {
      status: "image";
      readOnly: boolean;
      title: string;
      subtitle: string;
      absolutePath: string;
      mimeType: string;
    }
  | { status: "error"; message: string; readOnly: boolean; title: string; subtitle: string }
  | { status: "empty"; message: string; readOnly: boolean; title: string; subtitle: string };

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pathBasename(rel: string): string {
  const n = rel.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) || rel : rel;
}

function isMarkdownPath(rel: string): boolean {
  return /\.(md|mdx|markdown|mdown|mkd|mkdn|mdwn)$/i.test(rel);
}

/** Directory of the open Markdown file; used as relative image base (not LoadedDoc.absolutePath). */
function resolveMarkdownPreviewImageBaseDir(
  selectedEntry: SelectedEntry,
  workspaceRoot: string,
  planPath: string,
): string {
  if (!selectedEntry) {
    return workspaceRoot;
  }
  if (selectedEntry.kind === "external") {
    return dirnameLocalPath(selectedEntry.absolutePath);
  }
  if (selectedEntry.kind === "workspace") {
    return dirnameLocalPath(joinWorkspaceAbsolutePath(workspaceRoot, selectedEntry.relativePath));
  }
  const rel = planPath.trim();
  if (!rel) {
    return workspaceRoot;
  }
  return dirnameLocalPath(joinWorkspaceAbsolutePath(workspaceRoot, rel));
}

/** Containment root for Markdown local images: workspace for in-repo files, file dir for external. */
function resolveMarkdownPreviewImageAllowedRootDir(
  selectedEntry: SelectedEntry,
  workspaceRoot: string,
  imageBaseDir: string,
): string {
  if (selectedEntry?.kind === "external") {
    return imageBaseDir;
  }
  return workspaceRoot;
}

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

type WorkspaceFilesExplorerToolbarProps = {
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
  fileSearchOpen: boolean;
  onToggleFileSearch: () => void;
  fileOpen: boolean;
  headerTitle: string;
  headerSubtitle: string;
  isMarkdownDocument: boolean;
  markdownViewMode: MarkdownViewMode;
  onToggleMarkdownViewMode: (value: string) => void;
  docReady: boolean;
  docReadOnly: boolean;
  showStartImplementing: boolean;
  startImplementingDisabled: boolean;
  onStartImplementing?: () => void;
};

function WorkspaceFilesExplorerToolbar({
  fileTreeOpen,
  onToggleFileTree,
  fileSearchOpen,
  onToggleFileSearch,
  fileOpen,
  headerTitle,
  headerSubtitle,
  isMarkdownDocument,
  markdownViewMode,
  onToggleMarkdownViewMode,
  docReady,
  docReadOnly,
  showStartImplementing,
  startImplementingDisabled,
  onStartImplementing,
}: WorkspaceFilesExplorerToolbarProps) {
  const { t } = useTranslation();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileTreeTooltip = fileSearchOpen
    ? t("workspace.showFileTree")
    : fileTreeOpen
      ? t("workspace.hideFileTree")
      : t("workspace.showFileTree");
  const fileSearchTooltip = fileSearchOpen
    ? fileTreeOpen
      ? t("workspace.hideContentSearch")
      : t("workspace.showContentSearch")
    : t("workspace.fileSearch");

  useWorkspaceToolsShellHorizontalDivider(
    toolbarRef,
    {
      enabled: true,
      edge: "bottom",
      dividerAttr: FILES_EXPLORER_TOOLBAR_SHELL_DIVIDER_ATTR,
    },
    [fileTreeOpen, fileSearchOpen, fileOpen, headerTitle, isMarkdownDocument, markdownViewMode],
  );

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "flex shrink-0 items-center gap-1 py-1.5 pl-1 pr-2",
        fileOpen && "justify-between",
      )}
      role="toolbar"
      aria-label={t("workspace.fileExplorerToolbar")}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={DESKTOP_FILES_EXPLORER_TOOLBAR_ICON_BTN}
              onClick={onToggleFileTree}
              aria-label={fileTreeTooltip}
              aria-expanded={fileTreeOpen}
              aria-pressed={fileTreeOpen && !fileSearchOpen}
            >
              <ListTree className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {fileTreeTooltip}
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={DESKTOP_FILES_EXPLORER_TOOLBAR_ICON_BTN}
              onClick={onToggleFileSearch}
              aria-label={fileSearchTooltip}
              aria-pressed={fileSearchOpen && fileTreeOpen}
            >
              <Search className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {fileSearchTooltip}
          </TooltipContent>
        </Tooltip>
        {fileOpen ? (
          <span
            className="min-w-0 truncate text-xs font-normal text-foreground/95"
            title={headerSubtitle || undefined}
          >
            {headerTitle}
          </span>
        ) : null}
      </div>
      {fileOpen ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {isMarkdownDocument ? (
            <div className="flex items-center gap-1" role="radiogroup">
              <Toggle
                variant="default"
                size="sm"
                pressed={markdownViewMode === "preview"}
                onPressedChange={(pressed) => {
                  if (pressed) {
                    onToggleMarkdownViewMode("preview");
                  }
                }}
                aria-label={t("workspace.markdownPreview")}
                title={t("workspace.markdownPreview")}
                disabled={!docReady}
              >
                <Eye aria-hidden />
                {t("workspace.preview")}
              </Toggle>
              <Toggle
                variant="default"
                size="sm"
                pressed={markdownViewMode === "edit"}
                onPressedChange={(pressed) => {
                  if (pressed) {
                    onToggleMarkdownViewMode("edit");
                  }
                }}
                aria-label={t("workspace.markdownEdit")}
                title={
                  docReadOnly ? t("workspace.currentDocReadOnly") : t("workspace.markdownEdit")
                }
                disabled={!docReady || docReadOnly}
              >
                <SquarePen aria-hidden />
                {t("workspace.edit")}
              </Toggle>
            </div>
          ) : null}
          {showStartImplementing ? (
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-canvas-hover enabled:hover:text-sidebar-foreground disabled:opacity-50"
              disabled={startImplementingDisabled}
              aria-label={t("workspace.startImplementing")}
              title={t("workspace.startImplementing")}
              onClick={onStartImplementing}
            >
              <Play className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type WorkspaceFilesTabProps = {
  workspaceRoot: string;
  plan: PlanSnapshot;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readHostTextFile: (absolutePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeHostTextFile: (request: WriteHostTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  readLocalImagePreviewDataUrl?: ReadLocalImagePreview;
  readLocalVideoPreviewUrl?: ReadLocalVideoPreview;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** When false, does not respond to Plan auto-expansion (only the target tab is true when multiple files tabs exist) */
  planRevealEnabled?: boolean;
  autoRevealFileNonce?: number;
  /** When false, does not respond to external open-file requests (only the target tab is true when multiple files tabs exist) */
  fileRevealEnabled?: boolean;
  fileRevealPath?: string;
  fileRevealAbsolutePath?: string;
  fileRevealScope?: EditorFileTarget["scope"];
  fileRevealViewMode?: WorkspaceEditorViewMode;
  fileRevealDirectoryOnly?: boolean;
  fileRevealLine?: number | null;
  fileRevealColumn?: number | null;
  searchWorkspaceContent?: (
    request: WorkspaceContentSearchRequest,
  ) => Promise<WorkspaceContentSearchResult>;
  /** Notifies the parent when the currently open file name changes, for the tab title display; undefined when nothing is selected */
  onTitleChange?: (title: string | undefined) => void;
  /** Notifies the parent when the currently open file's dirty state changes, for the tab's unsaved indicator */
  onDirtyChange?: (dirty: boolean) => void;
  /** Opens a file from a workspace path such as the file tree (an existing files tab may be reused in the normal state) */
  onOpenWorkspaceFile?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode; reveal?: EditorFileRevealLocation },
  ) => void;
  /** When the current tab already has an unsaved open file, opening another file from the file tree should create a new files tab */
  onOpenWorkspaceFileInNewTab?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode; reveal?: EditorFileRevealLocation },
  ) => void;
  /** Currently open workspace-relative path; undefined when no workspace file is selected */
  onFilesWorkspacePathChange?: (relativePath: string | undefined) => void;
  onFileSnippetAddToSession?: (attachment: FileSnippetAttachment) => void;
  onWorkspaceFileAddToSession?: (relativePath: string) => void;
  gitRevision?: number;
  workspaceContentInvalidation?: WorkspaceContentInvalidation;
  useTranslucency?: boolean;
  codeCompletionEnabled?: boolean;
};

export function WorkspaceFilesTab({
  workspaceRoot,
  plan,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readHostTextFile,
  writeHostTextFile,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealEnabled = true,
  autoRevealFileNonce = 0,
  fileRevealEnabled = false,
  fileRevealPath = "",
  fileRevealAbsolutePath = "",
  fileRevealScope = "workspace",
  fileRevealViewMode = "edit",
  fileRevealDirectoryOnly = false,
  fileRevealLine = null,
  fileRevealColumn = null,
  searchWorkspaceContent,
  onTitleChange,
  onDirtyChange,
  onOpenWorkspaceFile,
  onOpenWorkspaceFileInNewTab,
  onFilesWorkspacePathChange,
  onFileSnippetAddToSession,
  onWorkspaceFileAddToSession,
  gitRevision,
  workspaceContentInvalidation,
  useTranslucency = false,
  codeCompletionEnabled = true,
}: WorkspaceFilesTabProps) {
  const { t } = useTranslation();
  const { api } = useHostApi();
  const parentMarkdownLinkClick = useWorkspaceMarkdownLinkClick();
  type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [imagePreviewDataUrl, setImagePreviewDataUrl] = useState<string | null>(null);
  const [imagePreviewState, setImagePreviewState] = useState<WorkspaceImagePreviewState>("loading");
  const [saveError, setSaveError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>("edit");
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [directoryRevealPath, setDirectoryRevealPath] = useState("");
  const [directoryRevealNonce, setDirectoryRevealNonce] = useState(0);
  const directoryRevealNonceRef = useRef(0);
  const [editorRevealLocation, setEditorRevealLocation] = useState<EditorFileRevealLocation | null>(
    null,
  );
  const [searchHighlightSession, setSearchHighlightSession] = useState<{
    query: string;
    matchesByPath: Map<string, WorkspaceContentSearchMatch[]>;
  } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const fileTreeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestFileTreeWidthPxRef = useRef(readWorkspaceFilesTreeWidthPx());
  const [fileTreeWidthPx, setFileTreeWidthPx] = useState(() => readWorkspaceFilesTreeWidthPx());
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [splitContainerWidthPx, setSplitContainerWidthPx] = useState(0);
  const [monacoEditor, setMonacoEditor] = useState<MonacoEditor | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const editorRef = useRef<WorkspaceMonacoEditorHandle>(null);
  const previewScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const previewRootRef = useRef<HTMLElement | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onFilesWorkspacePathChangeRef = useRef(onFilesWorkspacePathChange);
  useLayoutEffect(() => {
    onTitleChangeRef.current = onTitleChange;
    onDirtyChangeRef.current = onDirtyChange;
    onFilesWorkspacePathChangeRef.current = onFilesWorkspacePathChange;
  });
  const prevSelectedEntryRef = useRef(selectedEntry);
  const journalFlushRef = useRef<{ path: string; baseline: string; current: string } | null>(null);
  const selectedEntryRef = useRef(selectedEntry);
  const draftSavedRef = useRef({ draftText, savedText });
  const workspaceContentInvalidationRef = useRef(workspaceContentInvalidation);
  selectedEntryRef.current = selectedEntry;
  draftSavedRef.current = { draftText, savedText };
  workspaceContentInvalidationRef.current = workspaceContentInvalidation;

  latestFileTreeWidthPxRef.current = fileTreeWidthPx;

  const maxFileTreeWidthPx = useMemo(
    () =>
      splitContainerWidthPx > 0
        ? computeWorkspaceFilesTreeMaxWidthPx(splitContainerWidthPx)
        : computeWorkspaceFilesTreeMaxWidthPx(1200),
    [splitContainerWidthPx],
  );

  const clampFileTreeWidth = useCallback(
    (value: number) =>
      Math.min(maxFileTreeWidthPx, Math.max(WORKSPACE_FILES_TREE_MIN_WIDTH_PX, value)),
    [maxFileTreeWidthPx],
  );

  useEffect(() => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }
    const syncContainerWidth = () => {
      setSplitContainerWidthPx(container.clientWidth);
    };
    syncContainerWidth();
    const observer = new ResizeObserver(syncContainerWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fileTreeOpen, selectedEntry]);

  useEffect(() => {
    if (fileTreeWidthPx <= maxFileTreeWidthPx) {
      return;
    }
    setFileTreeWidthPx(clampFileTreeWidth(fileTreeWidthPx));
  }, [clampFileTreeWidth, fileTreeWidthPx, maxFileTreeWidthPx]);

  const onFileTreeResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingFileTree(true);
      fileTreeDragRef.current = { startX: event.clientX, startWidth: fileTreeWidthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [fileTreeWidthPx],
  );

  const onFileTreeResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = fileTreeDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampFileTreeWidth(drag.startWidth + delta);
      latestFileTreeWidthPxRef.current = next;
      setFileTreeWidthPx(next);
    },
    [clampFileTreeWidth],
  );

  const endFileTreeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingFileTree(false);
    if (fileTreeDragRef.current) {
      const containerWidth = splitContainerRef.current?.clientWidth ?? 0;
      writeWorkspaceFilesTreeWidthPx(
        latestFileTreeWidthPxRef.current,
        containerWidth > 0 ? containerWidth : undefined,
      );
    }
    fileTreeDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  useEffect(() => {
    const prev = prevSelectedEntryRef.current;
    prevSelectedEntryRef.current = selectedEntry;
    if (prev !== selectedEntry) {
      onDirtyChangeRef.current?.(false);
      setEditorDirty(false);
    }
    if (!selectedEntry) {
      if (prev !== null) {
        onTitleChangeRef.current?.(undefined);
        onFilesWorkspacePathChangeRef.current?.(undefined);
      }
    } else if (selectedEntry.kind === "plan") {
      onTitleChangeRef.current?.("Plan");
      onFilesWorkspacePathChangeRef.current?.(undefined);
    } else if (selectedEntry.kind === "external") {
      onTitleChangeRef.current?.(pathBasename(selectedEntry.absolutePath));
      onFilesWorkspacePathChangeRef.current?.(undefined);
    } else {
      onTitleChangeRef.current?.(pathBasename(selectedEntry.relativePath));
      onFilesWorkspacePathChangeRef.current?.(
        normalizeWorkspaceEntryRel(selectedEntry.relativePath),
      );
    }
  }, [selectedEntry]);

  const selectedPath =
    selectedEntry?.kind === "plan"
      ? plan.path
      : selectedEntry?.kind === "workspace"
        ? selectedEntry.relativePath
        : selectedEntry?.kind === "external"
          ? selectedEntry.absolutePath
          : "";
  const headerTitle =
    doc?.title ??
    (selectedEntry?.kind === "plan"
      ? "Plan"
      : selectedEntry?.kind === "workspace"
        ? pathBasename(selectedEntry.relativePath)
        : selectedEntry?.kind === "external"
          ? pathBasename(selectedEntry.absolutePath)
          : "");
  const headerSubtitle = doc?.subtitle ?? selectedPath;
  const isMarkdownDocument = Boolean(selectedPath && isMarkdownPath(selectedPath));
  const markdownPreviewImageBaseDir = useMemo(
    () => resolveMarkdownPreviewImageBaseDir(selectedEntry, workspaceRoot, plan.path),
    [plan.path, selectedEntry, workspaceRoot],
  );
  const markdownPreviewImageAllowedRootDir = useMemo(
    () =>
      resolveMarkdownPreviewImageAllowedRootDir(
        selectedEntry,
        workspaceRoot,
        markdownPreviewImageBaseDir,
      ),
    [markdownPreviewImageBaseDir, selectedEntry, workspaceRoot],
  );

  const revealDirectoryInThisTab = useCallback((relativePath: string) => {
    setFileTreeOpen(true);
    setFileSearchOpen(false);
    directoryRevealNonceRef.current += 1;
    setDirectoryRevealPath(relativePath);
    setDirectoryRevealNonce(directoryRevealNonceRef.current);
  }, []);

  const onMarkdownPreviewLinkClick: WorkspaceMarkdownLinkClickHandler = useCallback(
    (href, event) => {
      if (
        tryHandleMarkdownWorkspaceLink(
          href,
          {
            openWorkspaceFileInNewTab: (relativePath, options) => {
              if (onOpenWorkspaceFileInNewTab) {
                onOpenWorkspaceFileInNewTab(relativePath, options);
                return;
              }
              onOpenWorkspaceFile?.(relativePath, options);
            },
            revealWorkspaceDirectory: revealDirectoryInThisTab,
            statHostTextFile: api
              ? (absolutePath) => api.statHostTextFile(absolutePath)
              : undefined,
          },
          {
            baseDir: markdownPreviewImageBaseDir,
            workspaceRoot: markdownPreviewImageAllowedRootDir,
          },
        )
      ) {
        return true;
      }
      return parentMarkdownLinkClick?.(href, event) ?? false;
    },
    [
      api,
      markdownPreviewImageAllowedRootDir,
      markdownPreviewImageBaseDir,
      onOpenWorkspaceFile,
      onOpenWorkspaceFileInNewTab,
      parentMarkdownLinkClick,
      revealDirectoryInThisTab,
    ],
  );

  useEffect(() => {
    if (!api || !selectedPath) {
      return;
    }
    const prev = journalFlushRef.current;
    if (prev && prev.path !== selectedPath) {
      void api.recordCodeCompletionFileState({
        relativePath: prev.path,
        baselineText: prev.baseline,
        currentText: prev.current,
      });
    }
    journalFlushRef.current = {
      path: selectedPath,
      baseline: savedText,
      current: draftText,
    };
  }, [api, selectedPath, savedText, draftText]);

  useEffect(() => {
    if (!planRevealEnabled) {
      return;
    }
    if (autoRevealPlanNonce > 0) {
      setMarkdownViewMode("preview");
      setSelectedEntry({ kind: "plan" });
    }
  }, [autoRevealPlanNonce, planRevealEnabled]);

  useEffect(() => {
    if (!fileRevealEnabled || autoRevealFileNonce <= 0) {
      return;
    }
    if (fileRevealDirectoryOnly) {
      setFileTreeOpen(true);
      setFileSearchOpen(false);
      directoryRevealNonceRef.current += 1;
      setDirectoryRevealPath(fileRevealPath);
      setDirectoryRevealNonce(directoryRevealNonceRef.current);
      return;
    }
    setMarkdownViewMode(fileRevealViewMode);
    if (fileRevealScope === "external") {
      if (!fileRevealAbsolutePath) {
        return;
      }
      setSelectedEntry({ kind: "external", absolutePath: fileRevealAbsolutePath });
      return;
    }
    if (!fileRevealPath) {
      return;
    }
    setSelectedEntry({ kind: "workspace", relativePath: fileRevealPath });
    if (fileRevealLine != null && fileRevealLine > 0) {
      setEditorRevealLocation({
        line: fileRevealLine,
        column: fileRevealColumn ?? undefined,
      });
    } else {
      setEditorRevealLocation(null);
    }
  }, [
    autoRevealFileNonce,
    fileRevealAbsolutePath,
    fileRevealColumn,
    fileRevealDirectoryOnly,
    fileRevealEnabled,
    fileRevealLine,
    fileRevealPath,
    fileRevealScope,
    fileRevealViewMode,
  ]);

  useEffect(() => {
    if (!selectedEntry) {
      setDoc(null);
      setSaveError("");
      setDraftText("");
      setSavedText("");
      setEditorRevealLocation(null);
      return;
    }

    if (selectedEntry.kind === "plan") {
      setSaveError("");
      if (!plan.exists) {
        setDraftText("");
        setSavedText("");
        setDoc({
          status: "empty",
          message: t("workspace.planNotCreated"),
          readOnly: true,
          title: "Plan",
          subtitle: plan.path,
        });
        return;
      }

      setDraftText(plan.content ?? "");
      setSavedText(plan.content ?? "");
      setDoc({
        status: "ready",
        text: plan.content ?? "",
        readOnly: true,
        title: "Plan",
        subtitle: plan.path,
      });
      return;
    }

    const filePath =
      selectedEntry.kind === "external" ? selectedEntry.absolutePath : selectedEntry.relativePath;
    const readFile = selectedEntry.kind === "external" ? readHostTextFile : readWorkspaceTextFile;
    let cancelled = false;
    setDoc({
      status: "loading",
      readOnly: false,
      title: pathBasename(filePath),
      subtitle: filePath,
    });
    setSaveError("");
    setDraftText("");
    setSavedText("");
    void readFile(filePath)
      .then((r) => {
        if (!cancelled) {
          if (r.image) {
            const absolutePath =
              selectedEntry.kind === "external"
                ? selectedEntry.absolutePath
                : joinWorkspaceAbsolutePath(workspaceRoot, selectedEntry.relativePath);
            setDraftText("");
            setSavedText("");
            setDoc({
              status: "image",
              readOnly: true,
              title: pathBasename(filePath),
              subtitle: filePath,
              absolutePath,
              mimeType: r.image.mimeType,
            });
            return;
          }
          if (r.binary) {
            setDraftText("");
            setSavedText("");
            setDoc({
              status: "binary",
              readOnly: true,
              title: pathBasename(filePath),
              subtitle: filePath,
            });
            return;
          }
          setDraftText(r.text);
          setSavedText(r.text);
          setDoc({
            status: "ready",
            text: r.text,
            readOnly: false,
            title: pathBasename(filePath),
            subtitle: filePath,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDraftText("");
          setSavedText("");
          setDoc({
            status: "error",
            message: describeError(e),
            readOnly: false,
            title: pathBasename(filePath),
            subtitle: filePath,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    plan.content,
    plan.exists,
    plan.path,
    readHostTextFile,
    readWorkspaceTextFile,
    selectedEntry,
    selectedPath,
    workspaceRoot,
  ]);

  useEffect(() => {
    const invalidation = workspaceContentInvalidationRef.current;
    if (!invalidation || invalidation.revision <= 0) {
      return;
    }
    const entry = selectedEntryRef.current;
    if (!entry || entry.kind !== "workspace") {
      return;
    }
    const { draftText: currentDraft, savedText: currentSaved } = draftSavedRef.current;
    if (currentDraft !== currentSaved) {
      return;
    }
    if (!workspaceContentInvalidationTouchesPath(invalidation, entry.relativePath)) {
      return;
    }

    let cancelled = false;
    void readWorkspaceTextFile(entry.relativePath)
      .then((r) => {
        if (cancelled || r.binary || r.image) {
          return;
        }
        if (r.text === currentDraft) {
          return;
        }
        setDraftText(r.text);
        setSavedText(r.text);
        setDoc((prev) =>
          prev?.status === "ready"
            ? { ...prev, text: r.text }
            : {
                status: "ready",
                text: r.text,
                readOnly: false,
                title: pathBasename(entry.relativePath),
                subtitle: entry.relativePath,
              },
        );
      })
      .catch(() => {
        // Keep the current buffer when a background reload fails; the next invalidation retries.
      });
    return () => {
      cancelled = true;
    };
  }, [readWorkspaceTextFile, workspaceContentInvalidation?.revision]);

  useEffect(() => {
    if (doc?.status !== "image") {
      setImagePreviewDataUrl(null);
      setImagePreviewState("loading");
      return;
    }
    if (!readLocalImagePreviewDataUrl) {
      setImagePreviewDataUrl(null);
      setImagePreviewState("unavailable");
      return;
    }

    let cancelled = false;
    setImagePreviewDataUrl(null);
    setImagePreviewState("loading");
    void readLocalImagePreviewDataUrl(doc.absolutePath)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }
        setImagePreviewDataUrl(dataUrl);
        setImagePreviewState(dataUrl ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setImagePreviewDataUrl(null);
          setImagePreviewState("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc, readLocalImagePreviewDataUrl]);

  const persistEditorText = useCallback(
    async (text: string) => {
      if (
        !selectedEntry ||
        (selectedEntry.kind !== "workspace" && selectedEntry.kind !== "external")
      ) {
        return;
      }
      setSaveError("");
      try {
        if (selectedEntry.kind === "external") {
          await writeHostTextFile({ absolutePath: selectedEntry.absolutePath, text });
        } else {
          await writeWorkspaceTextFile({ relativePath: selectedEntry.relativePath, text });
        }
        setDoc((current) =>
          current?.status === "ready"
            ? {
                ...current,
                text,
              }
            : current,
        );
        setDraftText(text);
        setSavedText(text);
      } catch (e) {
        setSaveError(describeError(e));
        throw e;
      }
    },
    [selectedEntry, writeHostTextFile, writeWorkspaceTextFile],
  );

  const onEditorSave = useCallback(
    async (text: string) => {
      await persistEditorText(text);
    },
    [persistEditorText],
  );

  const onMonacoDirtyChange = useCallback((dirty: boolean) => {
    setEditorDirty(dirty);
    onDirtyChangeRef.current?.(dirty);
  }, []);

  const isPreviewVisible =
    doc?.status === "ready" && isMarkdownDocument && markdownViewMode === "preview";

  useLayoutEffect(() => {
    if (!isPreviewVisible) {
      previewRootRef.current = null;
      return;
    }
    const viewport = scrollAreaViewport(previewScrollRef.current);
    previewRootRef.current = viewport;
    if (!viewport) {
      return;
    }
    return installContainedSelectAll(viewport);
  }, [isPreviewVisible, draftText, selectedPath]);

  useEffect(() => {
    if (isPreviewVisible) {
      setMonacoEditor(null);
    }
  }, [isPreviewVisible]);

  useEffect(() => {
    if (!isPreviewVisible || doc?.readOnly) {
      return;
    }
    const dirty = draftText !== savedText;
    setEditorDirty(dirty);
    onDirtyChangeRef.current?.(dirty);
  }, [draftText, doc?.readOnly, isPreviewVisible, savedText]);

  const selectionEnabled =
    doc?.status === "ready" && Boolean(onFileSnippetAddToSession && selectedPath);

  const onToggleMarkdownViewMode = useCallback((value: string) => {
    if (value === "preview" || value === "edit") {
      setMarkdownViewMode(value);
    }
  }, []);

  const onToggleFileTree = useCallback(() => {
    if (fileSearchOpen) {
      setFileSearchOpen(false);
      setEditorRevealLocation(null);
      if (!fileTreeOpen) {
        setFileTreeOpen(true);
      }
      return;
    }
    setFileTreeOpen((open) => {
      if (!open) {
        setFileSearchOpen(false);
      }
      return !open;
    });
  }, [fileSearchOpen, fileTreeOpen]);

  const onToggleFileSearch = useCallback(() => {
    if (fileSearchOpen) {
      setFileTreeOpen((open) => !open);
      return;
    }
    setFileSearchOpen(true);
    setFileTreeOpen(true);
  }, [fileSearchOpen]);

  const onEditorRevealConsumed = useCallback(() => {
    setEditorRevealLocation(null);
  }, []);

  const onSearchSessionChange = useCallback(
    (
      session: { query: string; matchesByPath: Map<string, WorkspaceContentSearchMatch[]> } | null,
    ) => {
      setSearchHighlightSession(session);
    },
    [],
  );

  const openSearchMatch = useCallback(
    (relativePath: string, reveal: EditorFileRevealLocation) => {
      setMarkdownViewMode("edit");
      setEditorRevealLocation(reveal);
      if (selectedEntry?.kind === "workspace" && selectedEntry.relativePath === relativePath) {
        return;
      }
      if (selectedEntry !== null && editorDirty && onOpenWorkspaceFileInNewTab) {
        onOpenWorkspaceFileInNewTab(relativePath, { viewMode: "edit", reveal });
        return;
      }
      if (onOpenWorkspaceFile) {
        onOpenWorkspaceFile(relativePath, { viewMode: "edit", reveal });
        return;
      }
      setSelectedEntry({ kind: "workspace", relativePath });
    },
    [editorDirty, onOpenWorkspaceFile, onOpenWorkspaceFileInNewTab, selectedEntry],
  );

  const monacoSearchMatchRanges = useMemo((): WorkspaceMonacoSearchMatchRange[] => {
    if (!fileSearchOpen || !searchHighlightSession || selectedEntry?.kind !== "workspace") {
      return [];
    }
    const path = normalizeWorkspaceEntryRel(selectedEntry.relativePath);
    const fileMatches = searchHighlightSession.matchesByPath.get(path);
    if (!fileMatches) {
      return [];
    }
    const ranges: WorkspaceMonacoSearchMatchRange[] = [];
    for (const match of fileMatches) {
      for (const submatch of match.submatches) {
        const codeUnitRange = ripgrepSubmatchToCodeUnitRange(match.lineText, submatch);
        ranges.push({
          line: match.lineNumber,
          startColumn: codeUnitRange.start + 1,
          endColumn: codeUnitRange.end + 1,
        });
      }
    }
    return ranges;
  }, [fileSearchOpen, searchHighlightSession, selectedEntry]);

  const selectedEntryKey = selectedEntry
    ? selectedEntry.kind === "plan"
      ? "plan"
      : selectedEntry.kind === "workspace"
        ? `workspace:${selectedEntry.relativePath}`
        : null
    : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspaceFilesExplorerToolbar
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={onToggleFileTree}
        fileSearchOpen={fileSearchOpen}
        onToggleFileSearch={onToggleFileSearch}
        fileOpen={Boolean(selectedEntry)}
        headerTitle={headerTitle}
        headerSubtitle={headerSubtitle}
        isMarkdownDocument={isMarkdownDocument}
        markdownViewMode={markdownViewMode}
        onToggleMarkdownViewMode={onToggleMarkdownViewMode}
        docReady={doc?.status === "ready"}
        docReadOnly={doc?.readOnly ?? false}
        showStartImplementing={selectedEntry?.kind === "plan"}
        startImplementingDisabled={startImplementingDisabled}
        onStartImplementing={onStartImplementing}
      />
      {saveError ? (
        <p className="shrink-0 px-2 pt-1 text-xs text-destructive/90">{saveError}</p>
      ) : null}
      <div
        ref={splitContainerRef}
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
          isResizingFileTree && "select-none",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden",
            !isResizingFileTree && DESKTOP_SHELL_LAYOUT_TRANSITION,
            fileTreeOpen ? (selectedEntry ? "border-r border-border/40" : "min-w-0 flex-1") : "w-0",
          )}
          style={fileTreeOpen && selectedEntry ? { width: fileTreeWidthPx } : undefined}
        >
          <div
            className={cn(
              "relative flex h-full min-h-0 w-full flex-col overflow-hidden pr-2",
              !fileTreeOpen && "pointer-events-none select-none",
            )}
            aria-hidden={!fileTreeOpen}
            inert={!fileTreeOpen ? true : undefined}
          >
            <div
              hidden={fileSearchOpen}
              inert={fileSearchOpen ? true : undefined}
              aria-hidden={fileSearchOpen}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                fileSearchOpen && "invisible",
              )}
            >
              <WorkspaceFilesPanel
                workspaceRoot={workspaceRoot}
                plan={plan}
                listExplorerChildren={listExplorerChildren}
                gitRevision={gitRevision}
                selectedEntryKey={selectedEntryKey}
                expandDirectoryPath={directoryRevealPath}
                expandDirectoryNonce={directoryRevealNonce}
                onOpenFile={(relativePath) => {
                  setEditorRevealLocation(null);
                  const viewMode = isMarkdownPath(relativePath) ? "preview" : "edit";
                  if (
                    selectedEntry?.kind === "workspace" &&
                    selectedEntry.relativePath === relativePath
                  ) {
                    setMarkdownViewMode(viewMode);
                    return;
                  }
                  if (selectedEntry !== null && editorDirty && onOpenWorkspaceFileInNewTab) {
                    onOpenWorkspaceFileInNewTab(relativePath, { viewMode });
                    return;
                  }
                  if (onOpenWorkspaceFile) {
                    onOpenWorkspaceFile(relativePath, { viewMode });
                    return;
                  }
                  setMarkdownViewMode(viewMode);
                  setSelectedEntry({ kind: "workspace", relativePath });
                }}
                onOpenPlan={() => {
                  setEditorRevealLocation(null);
                  setMarkdownViewMode("preview");
                  setSelectedEntry({ kind: "plan" });
                }}
                onWorkspaceEntryRenamed={(oldRelativePath, newRelativePath) => {
                  setSelectedEntry((current) => {
                    if (current?.kind !== "workspace") {
                      return current;
                    }
                    const nextPath = remapWorkspaceEntryPath(
                      oldRelativePath,
                      newRelativePath,
                      current.relativePath,
                    );
                    return nextPath ? { kind: "workspace", relativePath: nextPath } : current;
                  });
                }}
                onWorkspaceEntryMoved={(oldRelativePath, newRelativePath) => {
                  setSelectedEntry((current) => {
                    if (current?.kind !== "workspace") {
                      return current;
                    }
                    const nextPath = remapWorkspaceEntryPath(
                      oldRelativePath,
                      newRelativePath,
                      current.relativePath,
                    );
                    return nextPath ? { kind: "workspace", relativePath: nextPath } : current;
                  });
                }}
                onWorkspaceEntryDeleted={(relativePath) => {
                  setSelectedEntry((current) =>
                    current?.kind === "workspace" &&
                    isUnderWorkspaceEntryPath(relativePath, current.relativePath)
                      ? null
                      : current,
                  );
                }}
                onWorkspaceFileAddToSession={onWorkspaceFileAddToSession}
              />
            </div>
            {searchWorkspaceContent ? (
              <div
                hidden={!fileSearchOpen}
                inert={!fileSearchOpen ? true : undefined}
                aria-hidden={!fileSearchOpen}
                className={cn(
                  "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                  !fileSearchOpen && "invisible",
                )}
              >
                <WorkspaceFilesSearchPanel
                  searchWorkspaceContent={searchWorkspaceContent}
                  onOpenSearchMatch={openSearchMatch}
                  onSearchSessionChange={onSearchSessionChange}
                />
              </div>
            ) : null}
          </div>
        </div>
        {fileTreeOpen && selectedEntry ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("workspace.resizeFileTreeWidth")}
            className={cn(
              "group relative z-10 -ml-px w-1 shrink-0 cursor-col-resize touch-none select-none self-stretch",
              "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
            )}
            onPointerDown={onFileTreeResizePointerDown}
            onPointerMove={onFileTreeResizePointerMove}
            onPointerUp={endFileTreeResize}
            onPointerCancel={endFileTreeResize}
          >
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-border/55"
              aria-hidden
            />
          </div>
        ) : null}
        {selectedEntry ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {doc?.status === "loading" ? (
                <div className="h-full min-h-0 w-full" />
              ) : doc?.status === "error" ? (
                <p className="p-2 text-xs text-destructive/90">{doc.message}</p>
              ) : doc?.status === "empty" ? (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
                  {doc.message}
                </div>
              ) : doc?.status === "binary" ? (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
                  {t("workspace.binaryFileNotSupported")}
                </div>
              ) : doc?.status === "image" ? (
                <WorkspaceImagePreviewPane
                  className={desktopTranslucencyFileDetailSurfaceClass(useTranslucency)}
                  previewState={imagePreviewState}
                  previewDataUrl={imagePreviewDataUrl}
                  fileLabel={doc.title}
                />
              ) : doc?.status === "ready" ? (
                isPreviewVisible ? (
                  <>
                    <ScrollArea
                      ref={previewScrollRef}
                      className={cn(
                        "h-full min-h-0 w-full",
                        desktopTranslucencyFileDetailSurfaceClass(useTranslucency),
                      )}
                    >
                      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
                        {draftText.trim() ? (
                          <WorkspaceMarkdownLinkProvider onLinkClick={onMarkdownPreviewLinkClick}>
                            <MarkdownMessage
                              content={draftText}
                              className="text-sm"
                              allowHtml
                              singleLineBreaks={false}
                              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                              readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
                              readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
                              localImageBaseDir={markdownPreviewImageBaseDir}
                              localImageAllowedRootDir={markdownPreviewImageAllowedRootDir}
                            />
                          </WorkspaceMarkdownLinkProvider>
                        ) : (
                          <div
                            className={cn(
                              "flex min-h-[8rem] items-center justify-center rounded-md border border-dashed border-border/50 px-4 text-center text-xs text-muted-foreground",
                              desktopTranslucencyFileDetailSurfaceClass(useTranslucency),
                            )}
                          >
                            {t("workspace.emptyMarkdownDoc")}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                    {selectionEnabled ? (
                      <FileDomSelectionMenu
                        rootRef={previewRootRef}
                        filePath={selectedPath}
                        onFileSnippetAddToSession={onFileSnippetAddToSession}
                      />
                    ) : null}
                  </>
                ) : (
                  <div ref={monacoContainerRef} className="relative h-full min-h-0 w-full">
                    <WorkspaceMonacoEditor
                      key={selectedEntryKey}
                      ref={editorRef}
                      relativePath={
                        doc.readOnly ? (plan.path.split(/[/\\]/).pop() ?? "plan") : doc.subtitle
                      }
                      initialText={draftText}
                      baselineText={savedText}
                      onSave={onEditorSave}
                      onTextChange={isMarkdownDocument ? setDraftText : undefined}
                      onDirtyChange={doc.readOnly ? undefined : onMonacoDirtyChange}
                      readOnly={doc.readOnly}
                      codeCompletionEnabled={codeCompletionEnabled}
                      onEditorReady={setMonacoEditor}
                      revealLocation={editorRevealLocation}
                      onRevealConsumed={onEditorRevealConsumed}
                      searchMatchRanges={monacoSearchMatchRanges}
                    />
                    {selectionEnabled ? (
                      <FileMonacoSelectionMenu
                        containerRef={monacoContainerRef}
                        editor={monacoEditor}
                        filePath={selectedPath}
                        onFileSnippetAddToSession={onFileSnippetAddToSession}
                      />
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
