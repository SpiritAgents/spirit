import { useGitHubLayoutPreferences } from "../lib/layout-prefs.js";
import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { resizeCursor, useDragResizeCursor } from "@spiritagent/ui/resize-cursor";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ReviewCommentHunkView } from "@spiritagent/ui/rendering/review-comment-hunk-view";
import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
} from "@spiritagent/ui/rendering/text-selection-action-menu";
import { EditFileLineDeltaBadge } from "@spiritagent/ui/rendering/edit-file-line-delta-badge";
import { WorkspacePrChangesFileTree } from "./workspace-pr-changes-file-tree.js";
import { AnimatedCollapse, AnimatedCollapseContent } from "@spiritagent/ui/animated-collapse";
import { COLLAPSIBLE_OPEN_ANIMATION_MS } from "@spiritagent/ui/collapsible-animation";
import { TEXT_LINK_CLASS } from "@spiritagent/ui/link";
import { ScrollArea } from "@spiritagent/ui/scroll-area";
import { useCollapsibleChildMount } from "@spiritagent/ui/hooks/use-collapsible-child-mount";
import { scrollAreaViewport } from "@spiritagent/ui/rendering/use-sticky-header-pinned";
import { useTextSelectionActionMenu } from "@spiritagent/ui/rendering/use-text-selection-action-menu";
import { buildPrChangedFilesTree } from "../lib/pr-changed-files-tree.js";
import { installContainedSelectAll } from "@spiritagent/ui/rendering/contained-text-selection";
import type { PrDiffAttachment, PullRequestChipStatus } from "@spiritagent/ui/composer";
import { buildPrDiffSnippetFromPatch, buildPrDiffSnippetText } from "../lib/pr-diff-text.js";
import { inferLineRangeFromPatch } from "../lib/pr-diff-patch-slice.js";
import {
  isNodeInUnifiedDiffCode,
  readDiffSelectionText,
  resolveChangedFileFromSelection,
  resolveDiffSelectionLineRange,
} from "@spiritagent/ui/rendering/pr-diff-selection";
import {
  PR_CHANGES_TREE_MIN_WIDTH_PX,
  computePrChangesTreeMaxWidthPx,
} from "../lib/layout-prefs.js";
import { cn } from "@spiritagent/ui/cn";
import type { GitHubPullRequestChangedFile } from "../types.js";

export function prChangedFileAnchorId(filename: string): string {
  return `pr-change-file-${encodeURIComponent(filename)}`;
}

function findDiffRootFromSelection(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.classList.contains("tool-call-diff")) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function isDiffCodeSelection(selection: Selection, root: HTMLElement): boolean {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) {
    return false;
  }
  const diffRoot =
    findDiffRootFromSelection(anchor, root) ?? findDiffRootFromSelection(focus, root);
  if (!diffRoot) {
    return false;
  }
  const isInDiffCode = (node: Node | null): boolean => isNodeInUnifiedDiffCode(node, diffRoot);
  return (
    isInDiffCode(anchor) &&
    isInDiffCode(focus) &&
    resolveChangedFileFromSelection(selection, root) != null
  );
}

function isDiffBlockSelection(selection: Selection, root: HTMLElement): boolean {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) {
    return false;
  }
  const anchorDiff =
    findDiffRootFromSelection(anchor, root) ?? findDiffRootFromSelection(focus, root);
  const focusDiff = findDiffRootFromSelection(focus, root);
  if (!anchorDiff || anchorDiff !== focusDiff) {
    return false;
  }
  return resolveChangedFileFromSelection(selection, root) != null;
}

function isPrDiffSelectionAllowed(selection: Selection, root: HTMLElement): boolean {
  return isDiffCodeSelection(selection, root) || isDiffBlockSelection(selection, root);
}

function PrChangesSelectionMenu({
  rootRef,
  files,
  prUrl,
  prStatus,
  onPrDiffAddToThread,
}: {
  rootRef: RefObject<HTMLElement | null>;
  files: GitHubPullRequestChangedFile[];
  prUrl: string;
  prStatus: PullRequestChipStatus;
  onPrDiffAddToThread?: (attachment: PrDiffAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onPrDiffAddToThread && prUrl);
  const { open, setOpen, anchor, dismiss } = useTextSelectionActionMenu({
    enabled,
    rootRef,
    isSelectionAllowed: isPrDiffSelectionAllowed,
    readSelectionText: readDiffSelectionText,
  });

  const handleAddToThread = useCallback(() => {
    const root = rootRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !selection || !onPrDiffAddToThread) {
      dismiss();
      return;
    }

    const filename = resolveChangedFileFromSelection(selection, root);
    if (!filename) {
      dismiss();
      return;
    }

    const diffRoot = findDiffRootFromSelection(selection.anchorNode, root);
    const selectedText = readDiffSelectionText(selection);
    if (!selectedText) {
      dismiss();
      return;
    }

    const filePatch = files.find((file) => file.filename === filename)?.patch;
    const lineRange =
      (diffRoot ? resolveDiffSelectionLineRange(diffRoot, selection) : null) ??
      (filePatch ? inferLineRangeFromPatch(filename, filePatch, selectedText) : null);
    const diffText =
      filePatch && lineRange
        ? buildPrDiffSnippetFromPatch(filename, filePatch, lineRange.lineStart, lineRange.lineEnd)
        : buildPrDiffSnippetText(filename, selectedText);
    if (!diffText) {
      dismiss();
      return;
    }

    const attachment: PrDiffAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      prUrl,
      filename,
      lineStart: lineRange?.lineStart ?? 0,
      lineEnd: lineRange?.lineEnd ?? 0,
      diffText,
      status: prStatus,
    };
    onPrDiffAddToThread(attachment);
    dismiss();
    selection.removeAllRanges();
  }, [dismiss, files, onPrDiffAddToThread, prStatus, prUrl, rootRef]);

  if (!enabled) {
    return null;
  }

  return (
    <TextSelectionActionMenu open={open} anchor={anchor} onOpenChange={setOpen}>
      <TextSelectionActionMenuItem
        label={t("workspace.addSelectionToThread")}
        onSelect={handleAddToThread}
      />
    </TextSelectionActionMenu>
  );
}

/**
 * Height of a file header row: the button's `py-3` plus one `text-xs leading-relaxed` line.
 * Declared from those tokens rather than measured, so the dock clip beneath an expanded
 * file's sticky header can dock at exactly this line.
 */
const PR_CHANGED_FILE_HEADER_HEIGHT =
  "calc(var(--spacing) * 6 + var(--text-xs) * var(--leading-relaxed))";

function PrChangedFileHeaderButton({
  displayPath,
  open,
  additions,
  deletions,
  onToggle,
}: {
  displayPath: string;
  open: boolean;
  additions: number;
  deletions: number;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 px-3 py-3 text-left outline-none cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
      )}
      style={{ height: PR_CHANGED_FILE_HEADER_HEIGHT }}
      aria-expanded={open}
      aria-label={open ? t("workspace.prChangesFileCollapse") : t("workspace.prChangesFileExpand")}
      onClick={onToggle}
    >
      <ChevronRight
        className={cn(
          "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
          open && "rotate-90",
        )}
        aria-hidden
        strokeWidth={1.75}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="min-w-0 truncate text-xs leading-relaxed text-foreground">
          {displayPath}
        </span>
        <EditFileLineDeltaBadge
          delta={{ added: additions, removed: deletions }}
          className="font-normal"
        />
      </div>
    </button>
  );
}

/**
 * One changed file. Expanded, its header is ordinary in-flow sticky content: it travels with
 * the list, docks at the top edge, leaves with its own section and rubber-bands natively. It
 * paints no background on any surface; the diff sliding beneath it is clipped by the
 * compositor-driven dock clip instead, which needs no pin state.
 */
function PrChangedFileCard({
  file,
  open,
  onOpenChange,
  onOpenExternal,
}: {
  file: GitHubPullRequestChangedFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenExternal?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const mounted = useCollapsibleChildMount(open);
  const diffHostRef = useRef<HTMLDivElement>(null);
  const showExpandedChrome = open || mounted;
  const displayPath =
    file.status === "renamed" && file.previousFilename
      ? `${file.previousFilename} → ${file.filename}`
      : file.filename;

  useEffect(() => {
    if (!mounted || !file.patch) {
      return;
    }
    const host = diffHostRef.current;
    if (!host) {
      return;
    }
    const diffRoot = host.querySelector(".tool-call-diff");
    if (!(diffRoot instanceof HTMLElement)) {
      return;
    }
    return installContainedSelectAll(diffRoot);
  }, [file.patch, mounted]);

  return (
    <section
      id={prChangedFileAnchorId(file.filename)}
      className="min-w-0 scroll-mt-0"
      data-pr-changed-file={file.filename}
    >
      <AnimatedCollapse open={open} onOpenChange={onOpenChange} className="min-w-0">
        <div
          className={cn("relative", showExpandedChrome && "spirit-dock-header spirit-rule-b z-10")}
        >
          <PrChangedFileHeaderButton
            displayPath={displayPath}
            open={open}
            additions={file.additions}
            deletions={file.deletions}
            onToggle={() => onOpenChange(!open)}
          />
        </div>
        {/* The clip only exists while there is a diff to clip: a long list of collapsed files
            must not carry two scroll-linked animations per row. */}
        <div
          className={showExpandedChrome ? "spirit-dock-clip" : undefined}
          style={{ "--spirit-dock-clip-inset": PR_CHANGED_FILE_HEADER_HEIGHT } as CSSProperties}
        >
          <div>
            <AnimatedCollapseContent>
              {mounted ? (
                file.patch ? (
                  <div ref={diffHostRef} className="min-w-0">
                    <ReviewCommentHunkView
                      path={file.filename}
                      diffHunk={file.patch}
                      layout="embedded"
                    />
                  </div>
                ) : (
                  <div className="space-y-2 px-3 pb-3 text-xs text-muted-foreground">
                    <p>{t("workspace.prChangesNoPatch")}</p>
                    {file.blobUrl && onOpenExternal ? (
                      <button
                        type="button"
                        className={TEXT_LINK_CLASS}
                        onClick={() => onOpenExternal(file.blobUrl!)}
                      >
                        {t("workspace.prChangesViewOnGitHub")}
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
            </AnimatedCollapseContent>
          </div>
        </div>
      </AnimatedCollapse>
    </section>
  );
}

export type WorkspacePrChangesViewProps = {
  files: GitHubPullRequestChangedFile[];
  loading?: boolean;
  hasMore?: boolean;
  prUrl?: string;
  prStatus?: PullRequestChipStatus;
  onPrDiffAddToThread?: (attachment: PrDiffAttachment) => void;
  onOpenExternal?: (url: string) => void;
  className?: string;
};

export function WorkspacePrChangesView({
  files,
  loading = false,
  hasMore = false,
  prUrl = "",
  prStatus = "open",
  onPrDiffAddToThread,
  onOpenExternal,
  className,
}: WorkspacePrChangesViewProps) {
  const { readPrChangesTreeWidthPx, writePrChangesTreeWidthPx } = useGitHubLayoutPreferences();
  const { t } = useTranslation();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  // The view mounts while files load, when the split container is not rendered yet; the
  // callback ref + state lets the width observer attach when it appears.
  const [splitContainer, setSplitContainer] = useState<HTMLDivElement | null>(null);
  const setSplitContainerRef = useCallback((node: HTMLDivElement | null) => {
    splitContainerRef.current = node;
    setSplitContainer(node);
  }, []);
  const cardsScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const cardsListRef = useRef<HTMLDivElement>(null);
  const treeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestTreeWidthPxRef = useRef(readPrChangesTreeWidthPx());
  const [treeWidthPx, setTreeWidthPx] = useState(() => readPrChangesTreeWidthPx());
  const [isResizingTree, setIsResizingTree] = useState(false);
  const [containerWidthPx, setContainerWidthPx] = useState(0);
  const [expandedFilenames, setExpandedFilenames] = useState<Set<string>>(() => new Set());

  const treeNodes = useMemo(() => buildPrChangedFilesTree(files), [files]);

  const setFileOpen = useCallback((filename: string, nextOpen: boolean) => {
    setExpandedFilenames((previous) => {
      const next = new Set(previous);
      if (nextOpen) {
        next.add(filename);
      } else {
        next.delete(filename);
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    latestTreeWidthPxRef.current = treeWidthPx;
  }, [treeWidthPx]);
  const treeDragCursor = useDragResizeCursor();

  const maxTreeWidthPx = useMemo(
    () =>
      containerWidthPx > 0
        ? computePrChangesTreeMaxWidthPx(containerWidthPx)
        : computePrChangesTreeMaxWidthPx(1200),
    [containerWidthPx],
  );

  const clampTreeWidth = useCallback(
    (value: number) => Math.min(maxTreeWidthPx, Math.max(PR_CHANGES_TREE_MIN_WIDTH_PX, value)),
    [maxTreeWidthPx],
  );

  useEffect(() => {
    if (!splitContainer) {
      return;
    }
    const syncContainerWidth = () => {
      setContainerWidthPx(splitContainer.clientWidth);
    };
    syncContainerWidth();
    const observer = new ResizeObserver(syncContainerWidth);
    observer.observe(splitContainer);
    return () => observer.disconnect();
  }, [splitContainer]);

  if (treeWidthPx > maxTreeWidthPx) {
    setTreeWidthPx(clampTreeWidth(treeWidthPx));
  }

  const onTreeResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingTree(true);
      treeDragRef.current = { startX: event.clientX, startWidth: treeWidthPx };
      treeDragCursor.start(
        resizeCursor(treeWidthPx, PR_CHANGES_TREE_MIN_WIDTH_PX, maxTreeWidthPx, "right"),
      );
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [maxTreeWidthPx, treeDragCursor, treeWidthPx],
  );

  const onTreeResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = treeDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampTreeWidth(drag.startWidth + delta);
      treeDragCursor.update(
        resizeCursor(next, PR_CHANGES_TREE_MIN_WIDTH_PX, maxTreeWidthPx, "right"),
      );
      latestTreeWidthPxRef.current = next;
      setTreeWidthPx(next);
    },
    [clampTreeWidth, maxTreeWidthPx, treeDragCursor],
  );

  const endTreeResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      treeDragCursor.end();
      setIsResizingTree(false);
      if (treeDragRef.current) {
        const containerWidth = splitContainerRef.current?.clientWidth ?? 0;
        writePrChangesTreeWidthPx(
          latestTreeWidthPxRef.current,
          containerWidth > 0 ? containerWidth : undefined,
        );
      }
      treeDragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
    },
    [treeDragCursor, writePrChangesTreeWidthPx],
  );

  const revealFrameRef = useRef(0);
  const navigateToFile = useCallback((filename: string) => {
    setExpandedFilenames((previous) => {
      const next = new Set(previous);
      next.add(filename);
      return next;
    });

    // The file's header can only reach the top of the list once the list is long enough
    // below it, and the diff that makes it so is still animating open. `scrollIntoView` aims
    // at what is reachable when it is called, so wait for that room first: at most for the
    // length of the expand, after which the list is as long as it is going to get.
    cancelAnimationFrame(revealFrameRef.current);
    const deadline = performance.now() + COLLAPSIBLE_OPEN_ANIMATION_MS;
    const reveal = () => {
      const viewport = scrollAreaViewport(cardsScrollRef.current);
      const section = viewport?.querySelector<HTMLElement>(
        `[data-pr-changed-file="${CSS.escape(filename)}"]`,
      );
      if (!viewport || !section) {
        return;
      }
      const distance = section.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      const room = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      // `scrollHeight` is rounded: ask for a pixel to spare.
      if (room < distance + 1 && performance.now() < deadline) {
        revealFrameRef.current = requestAnimationFrame(reveal);
        return;
      }
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    revealFrameRef.current = requestAnimationFrame(reveal);
  }, []);

  if (loading && files.length === 0) {
    return (
      <p className={cn("px-3 pt-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChangesLoading")}
      </p>
    );
  }

  if (files.length === 0) {
    return (
      <p className={cn("px-3 pt-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChangesEmpty")}
      </p>
    );
  }

  return (
    <div
      ref={setSplitContainerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-hidden",
        isResizingTree && "select-none",
        className,
      )}
    >
      <aside
        className="flex min-h-0 shrink-0 flex-col border-r border-border/40"
        style={{ width: treeWidthPx }}
      >
        <ScrollArea className="h-full min-h-0 flex-1" type="auto">
          <WorkspacePrChangesFileTree nodes={treeNodes} onSelectFile={navigateToFile} />
        </ScrollArea>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("workspace.prChangesResizeTreeWidth")}
        className={cn(
          "group relative z-10 -ml-px w-1 shrink-0 touch-none select-none self-stretch",
          "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
        )}
        style={{
          cursor: resizeCursor(treeWidthPx, PR_CHANGES_TREE_MIN_WIDTH_PX, maxTreeWidthPx, "right"),
        }}
        onPointerDown={onTreeResizePointerDown}
        onPointerMove={onTreeResizePointerMove}
        onPointerUp={endTreeResize}
        onPointerCancel={endTreeResize}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-border/55"
          aria-hidden
        />
      </div>
      {/* The tree resize handle above is a 4px strip that overlaps the tree border by 1px. The
          list runs beneath its other 3px (-ml / pl), so row rules can start flush against the
          tree border while every row stays where the handle leaves it. */}
      <ScrollArea
        ref={cardsScrollRef}
        className="-ml-[3px] h-full min-h-0 min-w-0 flex-1"
        type="auto"
      >
        {/* overflow-y-clip keeps the shifted dock clip boxes from extending the scroll range. */}
        <div
          ref={cardsListRef}
          className="spirit-row-rules overflow-y-clip pl-[3px] [--spirit-rule-inset-start:-3px]"
          data-trailing-rule={hasMore ? undefined : ""}
        >
          {files.map((file) => (
            <PrChangedFileCard
              key={file.filename}
              file={file}
              open={expandedFilenames.has(file.filename)}
              onOpenExternal={onOpenExternal}
              onOpenChange={(nextOpen) => setFileOpen(file.filename, nextOpen)}
            />
          ))}
          {hasMore ? (
            <p className="px-3 py-2 text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
              {t("workspace.prChangesHasMore")}
            </p>
          ) : null}
        </div>
      </ScrollArea>
      <PrChangesSelectionMenu
        rootRef={cardsListRef}
        files={files}
        prUrl={prUrl}
        prStatus={prStatus}
        onPrDiffAddToThread={onPrDiffAddToThread}
      />
    </div>
  );
}
