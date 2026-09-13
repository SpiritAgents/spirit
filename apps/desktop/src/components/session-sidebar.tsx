import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ArrowRightToLine,
  Blocks,
  BookText,
  Bot,
  ArrowLeft,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Layers,
  Code2,
  Link2,
  MoonStar,
  Network,
  Palette,
  Pencil,
  Plug,
  Plus,
  SquarePen,
  Settings,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { SCROLL_EDGE_FADE_PX, sidebarSessionsScrollInsetClass } from "@/lib/mask-styles";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  readSidebarNoWorkspaceSectionExpanded,
  readSidebarWorkspaceSectionExpanded,
  readWorkspaceSidebarExpandedById,
  readWorkspaceSidebarGroupOrder,
  writeSidebarNoWorkspaceSectionExpanded,
  writeSidebarWorkspaceSectionExpanded,
  writeWorkspaceSidebarExpandedById,
  writeWorkspaceSidebarGroupOrder,
} from "@/lib/layout-prefs";
import { applyWorkspaceGroupOrder, workspaceGroupIdsInOrder } from "@/lib/workspace-sidebar-order";
import { listVisibleSidebarSessions } from "@/lib/session-sidebar-visible-order";
import {
  registerSessionSidebarDigitShortcut,
  unregisterSessionSidebarDigitShortcut,
} from "@/lib/session-sidebar-digit-shortcut-bridge";
import { useWorkspaceGroupReorder } from "@/hooks/use-workspace-group-reorder";
import { resolveWorkspaceGroupingRoot } from "@/lib/workspace-grouping";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { prefersReducedMotion } from "@/lib/reduce-motion";
import { isViteDev } from "@/lib/vite-dev";
import { cn } from "@/lib/utils";
import { SettingsShortcutKbd } from "@/components/layout/desktop-shortcut-kbds";
import { SESSION_TITLE_RENAME_INPUT_CLASS } from "@/lib/desktop-chrome";
import { DESKTOP_SIDEBAR_TEXT_CLASS } from "@/lib/desktop-typography";
import { useOptionalConversationSplit } from "@/contexts/conversation-split-context";
import {
  isSidebarSessionDragBlockedTarget,
  setSidebarSessionDragData,
} from "@/lib/sidebar-session-drag";
import { shortcutLabel, settingsShortcutLabel } from "@/lib/desktop-shell";
import i18n from "@/lib/i18n";
import { useHostApi } from "@/hooks/useHostApi";
import type { SessionListItem } from "@/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SessionListGitTooltip,
  useOptionalSessionListGitTooltipContext,
} from "@/components/session-list-git-tooltip";

/** Platform shortcut hint, computed at module load (the platform does not change at runtime). */
const newSessionShortcutLabel = shortcutLabel("N");
const settingsShortcutLabelText = settingsShortcutLabel();

function describeRenameError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

type SessionSidebarProps = {
  className?: string;
  /** Narrow rail: only swap styles / collapse the list without replacing the whole subtree, avoiding a beat mismatch with the outer width animation */
  narrow: boolean;
  mode?: "sessions" | "settings";
  /** User home directory, used to group home-directory sessions into the "no workspace" section. */
  userHomeDirectory?: string | null;
  sessions: SessionListItem[];
  activeFilePath: string | null;
  onSelectSession: (path: string) => void;
  onNewSession: () => void;
  onNewSessionInWorkspace?: (workspaceRoot: string) => void;
  onOpenMarketplace?: () => void;
  onOpenAutomations?: () => void;
  onOpenSettings: () => void;
  onBackToSessions?: () => void;
  marketplaceActive?: boolean;
  automationsActive?: boolean;
  settingsTab?: SettingsSidebarTab;
  extensionSettingsId?: string | null;
  extensionSettingsItems?: Array<{
    id: string;
    label: string;
  }>;
  onSettingsTabChange?: (tab: SettingsSidebarTab) => void;
  onExtensionSettingsChange?: (extensionId: string) => void;
  /** Windows Mica: the sidebar needs translucency + blur so content behind the window does not show through and look smeared */
  translucency?: boolean;
  newSessionBusy?: boolean;
  sessionNavigationBusy?: boolean;
  deleteSessionBusy?: boolean;
  onDeleteSession?: (path: string) => void | Promise<void>;
  renameSessionBusy?: boolean;
  onRenameSession?: (path: string, displayName: string) => void | Promise<void>;
  deleteWorkspaceBusy?: boolean;
  onDeleteWorkspace?: (workspacePath: string) => void | Promise<void>;
  disabled?: boolean;
  /** Shows a blue dot after a background session completes and before the user opens it. */
  unseenCompletedSessionPaths?: ReadonlySet<string>;
};

export type SettingsSidebarTab =
  | "general"
  | "appearance"
  | "networks"
  | "models"
  | "agents"
  | "tab"
  | "mcps"
  | "hooks"
  | "skills"
  | "rules"
  | "dreams"
  | "integrations"
  | "developer";

type SessionWorkspaceGroup = {
  id: string;
  label: string;
  rootPath: string | null;
  sessions: SessionListItem[];
  latestModifiedAtUnixMs: number;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function deriveWorkspaceLabel(workspaceRoot: string | null | undefined): string {
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return i18n.t("sidebar.currentWorkspace");
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function buildWorkspaceGroups(
  sessions: SessionListItem[],
  workspaceRoot: string | null | undefined,
): SessionWorkspaceGroup[] {
  const currentWorkspaceRoot = workspaceRoot?.trim() || null;
  const groups = new Map<string, SessionWorkspaceGroup>();

  for (const session of sessions) {
    const rootPath = session.workspaceRoot?.trim() || currentWorkspaceRoot;
    if (!rootPath) {
      continue;
    }

    const groupingRoot = resolveWorkspaceGroupingRoot(rootPath);
    const id = normalizePath(groupingRoot);
    const existing = groups.get(id);
    if (existing) {
      existing.sessions.push(session);
      existing.latestModifiedAtUnixMs = Math.max(
        existing.latestModifiedAtUnixMs,
        session.modifiedAtUnixMs,
      );
      continue;
    }

    groups.set(id, {
      id,
      label: deriveWorkspaceLabel(groupingRoot),
      rootPath: groupingRoot,
      sessions: [session],
      latestModifiedAtUnixMs: session.modifiedAtUnixMs,
    });
  }

  return [...groups.values()].sort(
    (left, right) => right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs,
  );
}

function isNoWorkspaceSession(session: SessionListItem, homeDirectory: string): boolean {
  const root = session.workspaceRoot?.trim();
  if (!root) {
    return true;
  }
  return samePath(root, homeDirectory);
}

function partitionSessionsForSidebar(
  sessions: SessionListItem[],
  homeDirectory: string | null | undefined,
): { bound: SessionListItem[]; unbound: SessionListItem[] } {
  const home = homeDirectory?.trim();
  if (!home) {
    return { bound: sessions, unbound: [] };
  }
  const bound: SessionListItem[] = [];
  const unbound: SessionListItem[] = [];
  for (const session of sessions) {
    if (isNoWorkspaceSession(session, home)) {
      unbound.push(session);
    } else {
      bound.push(session);
    }
  }
  return { bound, unbound };
}

function sortSessionsByModified(sessions: SessionListItem[]): SessionListItem[] {
  return [...sessions].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
}

const SIDEBAR_SESSION_PAGE_SIZE = 10;

function visibleCountForSessionIndex(index: number): number {
  if (index < 0) {
    return SIDEBAR_SESSION_PAGE_SIZE;
  }
  return Math.ceil((index + 1) / SIDEBAR_SESSION_PAGE_SIZE) * SIDEBAR_SESSION_PAGE_SIZE;
}

type SessionListLoadMoreProps = {
  hiddenCount: number;
  nested?: boolean;
  disabled?: boolean;
  onLoadMore: () => void;
};

type WorkspaceSessionGroupCollapsibleProps = {
  group: SessionWorkspaceGroup;
  expanded: boolean;
  disabled?: boolean;
  translucency?: boolean;
  visibleSessions: SessionListItem[];
  hiddenSessionCount: number;
  unseenCompletedSessionPaths?: ReadonlySet<string>;
  isSessionSelected(path: string): boolean;
  onOpenChange(open: boolean): void;
  onSelectSession(path: string): void;
  onLoadMore(): void;
  onNewSessionInWorkspace?: (workspaceRoot: string) => void;
  newSessionBusy?: boolean;
  renamingSessionPath?: string | null;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onRenameStart?: (session: SessionListItem) => void;
  canRenameSession?: boolean;
  groupNodeRef?(node: HTMLElement | null): void;
  headerPointerHandlers?: {
    onPointerDown(event: PointerEvent<HTMLElement>): void;
  };
  onHeaderClickCapture?(event: MouseEvent<HTMLElement>): void;
  isDragging?: boolean;
  isPressing?: boolean;
  workspaceReorderActive?: boolean;
};

const sidebarSectionHeaderTriggerClass =
  "group flex w-full min-w-0 items-center overflow-hidden px-2.5 pb-1 text-left text-[0.65rem] text-sidebar-item-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40";

const sidebarSectionChevronClass =
  "hidden size-3 shrink-0 text-muted-foreground/55 transition-transform duration-150 group-hover:inline-flex group-focus-visible:inline-flex";

const sidebarItemShortcutClass =
  "ml-auto hidden text-[0.65rem] text-sidebar-item-foreground group-hover:inline group-focus-visible:inline";

type SidebarSectionContextMenuConfig = {
  ariaLabel: string;
  disabled?: boolean;
  disabledTitle?: string;
  onRequestDelete(): void;
};

type SidebarSectionCollapsibleProps = {
  label: string;
  expanded: boolean;
  disabled?: boolean;
  headerClassName?: string;
  onOpenChange(open: boolean): void;
  contextMenu?: SidebarSectionContextMenuConfig;
  children: ReactNode;
};

function SidebarSectionCollapsible({
  label,
  expanded,
  disabled,
  headerClassName,
  onOpenChange,
  contextMenu,
  children,
}: SidebarSectionCollapsibleProps) {
  const { t } = useTranslation();
  const headerTrigger = (
    <AnimatedCollapseTrigger
      disabled={disabled}
      className={cn(sidebarSectionHeaderTriggerClass, headerClassName)}
    >
      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
        <span className="truncate">{label}</span>
        <ChevronRight
          className={cn(sidebarSectionChevronClass, expanded && "rotate-90")}
          aria-hidden
        />
      </span>
    </AnimatedCollapseTrigger>
  );

  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (disabled) {
          return;
        }
        onOpenChange(open);
      }}
      className="min-w-0"
    >
      {contextMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{headerTrigger}</ContextMenuTrigger>
          <ContextMenuContent aria-label={contextMenu.ariaLabel}>
            <ContextMenuItem
              variant="destructive"
              disabled={contextMenu.disabled}
              title={contextMenu.disabled ? contextMenu.disabledTitle : undefined}
              onSelect={() => {
                contextMenu.onRequestDelete();
              }}
            >
              <Trash2 aria-hidden />
              {t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        headerTrigger
      )}
      <AnimatedCollapseContent className="min-w-0">{children}</AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

const WorkspaceSessionGroupCollapsible = memo(function WorkspaceSessionGroupCollapsible({
  group,
  expanded,
  disabled,
  translucency,
  visibleSessions,
  hiddenSessionCount,
  unseenCompletedSessionPaths,
  isSessionSelected,
  onOpenChange,
  onSelectSession,
  onLoadMore,
  onNewSessionInWorkspace,
  newSessionBusy = false,
  renamingSessionPath = null,
  renameValue = "",
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  canRenameSession = false,
  groupNodeRef,
  headerPointerHandlers,
  onHeaderClickCapture,
  isDragging = false,
  isPressing = false,
  workspaceReorderActive = false,
}: WorkspaceSessionGroupCollapsibleProps) {
  const { t } = useTranslation();
  const split = useOptionalConversationSplit();
  const workspaceRoot = group.rootPath?.trim() ?? "";
  const workspaceNewSessionDragEnabled =
    Boolean(split) && Boolean(workspaceRoot) && !disabled && !newSessionBusy;
  const [workspaceRowHovered, setWorkspaceRowHovered] = useState(false);
  const [plusTooltipAnchorLocked, setPlusTooltipAnchorLocked] = useState(false);
  const showWorkspaceRowHoverChrome = workspaceRowHovered || isDragging || isPressing;

  return (
    <div
      ref={groupNodeRef}
      data-workspace-group-id={group.id}
      data-workspace-reorder-dragging={isDragging ? "" : undefined}
      className={cn(
        "min-w-0",
        isDragging && "spirit-workspace-group-reorder-grabbing",
        workspaceReorderActive && !isDragging && "pointer-events-none",
      )}
      aria-grabbed={isDragging ? true : undefined}
    >
      <AnimatedCollapse open={expanded} onOpenChange={onOpenChange} className="min-w-0">
        <div
          className={cn(
            "group/workspace-row flex h-8 w-full min-w-0 items-center overflow-hidden rounded-md",
            sidebarItemDefaultTextClass,
            isDragging ? sessionRowSelectedClass(translucency) : sessionRowHoverClass(translucency),
            isPressing && !isDragging && "spirit-workspace-group-reorder-grab",
            isDragging && "select-none touch-none",
          )}
          onMouseEnter={() => {
            if (workspaceReorderActive && !isDragging) {
              return;
            }
            setWorkspaceRowHovered(true);
          }}
          onMouseLeave={() => {
            if (isDragging) {
              return;
            }
            setWorkspaceRowHovered(false);
          }}
          onClickCapture={onHeaderClickCapture}
          {...headerPointerHandlers}
        >
          <AnimatedCollapseTrigger
            disabled={disabled}
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 text-left text-sm",
              "bg-transparent outline-none hover:bg-transparent focus-visible:bg-transparent",
              sidebarInteractionMotionClass,
              "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
            )}
            title={group.rootPath ?? group.label}
            data-workspace-path={group.rootPath ?? group.id}
          >
            <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
              {expanded ? (
                <FolderOpen
                  className={cn(
                    "size-3.5",
                    showWorkspaceRowHoverChrome
                      ? "hidden"
                      : "group-hover/workspace-row:hidden group-has-[button:focus-visible]/workspace-row:hidden",
                  )}
                  aria-hidden
                />
              ) : (
                <FolderClosed
                  className={cn(
                    "size-3.5",
                    showWorkspaceRowHoverChrome
                      ? "hidden"
                      : "group-hover/workspace-row:hidden group-has-[button:focus-visible]/workspace-row:hidden",
                  )}
                  aria-hidden
                />
              )}
              <ChevronRight
                className={cn(
                  "absolute size-3.5 transition-transform duration-150",
                  showWorkspaceRowHoverChrome
                    ? "inline-flex"
                    : "hidden group-hover/workspace-row:inline-flex group-has-[button:focus-visible]/workspace-row:inline-flex",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
            </span>
            <span className={cn("truncate", DESKTOP_SIDEBAR_TEXT_CLASS)}>{group.label}</span>
          </AnimatedCollapseTrigger>
          {onNewSessionInWorkspace && workspaceRoot ? (
            <Tooltip
              delayDuration={300}
              disableHoverableContent
              onOpenChange={(open) => {
                if (open) {
                  setPlusTooltipAnchorLocked(true);
                } else if (prefersReducedMotion()) {
                  setPlusTooltipAnchorLocked(false);
                }
              }}
            >
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-workspace-new-session=""
                  draggable={workspaceNewSessionDragEnabled}
                  className={cn(
                    "mr-0.5 size-6 shrink-0",
                    workspaceRowHovered || plusTooltipAnchorLocked
                      ? "inline-flex"
                      : "hidden group-has-[button:focus-visible]/workspace-row:inline-flex",
                    plusTooltipAnchorLocked &&
                      !workspaceRowHovered &&
                      "pointer-events-none opacity-0",
                    sidebarItemDefaultTextClass,
                    sidebarInteractionMotionClass,
                    sidebarItemHoverClass(translucency),
                  )}
                  disabled={disabled || newSessionBusy}
                  aria-label={t("sidebar.newSessionInWorkspace", { workspace: group.label })}
                  onClick={() => onNewSessionInWorkspace(workspaceRoot)}
                  onDragStart={(event) => {
                    if (!split || !workspaceNewSessionDragEnabled) {
                      event.preventDefault();
                      return;
                    }
                    const payload = {
                      kind: "new-in-workspace" as const,
                      workspaceRoot,
                    };
                    setSidebarSessionDragData(event.dataTransfer, payload);
                    split.startSidebarSessionDrag(payload);
                  }}
                  onDragEnd={() => split?.clearSidebarSessionDrag()}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={4}
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) {
                    return;
                  }
                  if (event.currentTarget.getAttribute("data-state") !== "closed") {
                    return;
                  }
                  setPlusTooltipAnchorLocked(false);
                }}
              >
                {t("sidebar.newSessionInWorkspace", { workspace: group.label })}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <AnimatedCollapseContent className="min-w-0">
          <SessionListGitTooltip>
            <SessionListGitTooltip.Zone className="mt-0.5 flex min-w-0 flex-col gap-0.5">
              {visibleSessions.map((session) => (
                <SessionListGitTooltip.Row key={session.path} session={session}>
                  <SessionListRow
                    sessionPath={session.path}
                    displayName={session.displayName}
                    gitBranch={session.gitBranch}
                    isBusy={session.isBusy}
                    isBlocked={session.isBlocked}
                    showCompletedUnseen={unseenCompletedSessionPaths?.has(session.path) === true}
                    nested
                    selected={isSessionSelected(session.path)}
                    disabled={disabled}
                    translucency={translucency}
                    onSelectPath={onSelectSession}
                    renaming={renamingSessionPath === session.path}
                    renameValue={renamingSessionPath === session.path ? renameValue : undefined}
                    onRenameValueChange={onRenameValueChange}
                    onRenameCommit={onRenameCommit}
                    onRenameCancel={onRenameCancel}
                    onRenameStart={
                      canRenameSession && !session.isBusy
                        ? () => onRenameStart?.(session)
                        : undefined
                    }
                  />
                </SessionListGitTooltip.Row>
              ))}
              <SessionListLoadMore
                hiddenCount={hiddenSessionCount}
                nested
                disabled={disabled}
                onLoadMore={onLoadMore}
              />
            </SessionListGitTooltip.Zone>
          </SessionListGitTooltip>
        </AnimatedCollapseContent>
      </AnimatedCollapse>
    </div>
  );
});

function SessionListLoadMore({
  hiddenCount,
  nested,
  disabled,
  onLoadMore,
}: SessionListLoadMoreProps) {
  const { t } = useTranslation();
  if (hiddenCount <= 0) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onLoadMore}
      className={cn(
        "w-full py-1 text-left text-[0.65rem] text-sidebar-item-foreground outline-none",
        nested ? "pr-2.5 pl-8" : "px-2.5",
        "rounded-md hover:text-sidebar-foreground/75 focus-visible:text-sidebar-foreground/75",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {t("sidebar.loadMoreSessions")}
    </button>
  );
}

type SessionRowStatusTone = "blocked" | "completed";

function sessionRowStatusDotClass(tone: SessionRowStatusTone): string {
  return tone === "blocked" ? "bg-yellow-500" : "bg-blue-500";
}

function SessionRowStatusDot({ tone, label }: { tone: SessionRowStatusTone; label: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", sessionRowStatusDotClass(tone))}
      role="status"
      aria-label={label}
    />
  );
}

type SessionListRowProps = {
  sessionPath: string;
  displayName: string;
  gitBranch?: string;
  isBusy?: boolean;
  isBlocked?: boolean;
  showCompletedUnseen?: boolean;
  nested: boolean;
  selected: boolean;
  disabled?: boolean;
  translucency?: boolean;
  onSelectPath(path: string): void;
  renaming?: boolean;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onRenameStart?: () => void;
};

const SessionListRow = memo(function SessionListRow({
  sessionPath,
  displayName,
  gitBranch,
  isBusy,
  isBlocked,
  showCompletedUnseen,
  nested,
  selected,
  disabled,
  translucency,
  onSelectPath,
  renaming = false,
  renameValue = "",
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
}: SessionListRowProps) {
  const { t } = useTranslation();
  const split = useOptionalConversationSplit();
  const gitTooltipContext = useOptionalSessionListGitTooltipContext();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);
  const sessionDragEnabled = Boolean(split) && !disabled && !isBusy && !renaming;
  const hasIndicator = (isBusy && !isBlocked) || (!selected && (isBlocked || showCompletedUnseen));
  const showGitTooltip = Boolean(gitBranch?.trim()) && gitTooltipContext !== null;

  useLayoutEffect(() => {
    if (!renaming) {
      return;
    }
    const input = renameInputRef.current;
    if (!input) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [renaming]);

  const rowClassName = cn(
    "group flex w-full min-w-0 items-center overflow-hidden rounded-md text-left text-sm outline-none",
    sidebarInteractionMotionClass,
    "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
    nested ? "py-2 pr-2.5 pl-2.5 gap-2" : hasIndicator ? "h-8 pr-2.5 pl-2.5 gap-2" : "h-8 px-2.5",
    selected
      ? sessionRowSelectedClass(translucency)
      : cn(
          sidebarItemDefaultTextClass,
          renaming ? sessionRowRenamingClass(translucency) : sessionRowHoverClass(translucency),
        ),
  );

  const leading =
    nested || hasIndicator ? (
      <span className="flex w-3.5 shrink-0 items-center justify-center" aria-hidden>
        {isBusy && !isBlocked ? (
          <Spinner className="size-3 shrink-0 text-foreground" aria-label={t("common.running")} />
        ) : !selected && isBlocked ? (
          <SessionRowStatusDot tone="blocked" label={t("sidebar.sessionBlocked")} />
        ) : !selected && showCompletedUnseen ? (
          <SessionRowStatusDot tone="completed" label={t("sidebar.sessionCompleted")} />
        ) : null}
      </span>
    ) : null;

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      onRenameCommit?.();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel?.();
    }
  };

  const handleSessionDragStart = (event: DragEvent<HTMLButtonElement>) => {
    if (!split || !sessionDragEnabled || isSidebarSessionDragBlockedTarget(event.target)) {
      event.preventDefault();
      return;
    }
    const payload = { kind: "stored" as const, sessionPath };
    setSidebarSessionDragData(event.dataTransfer, payload);
    split.startSidebarSessionDrag(payload);
  };

  const handleSessionDragEnd = () => {
    split?.clearSidebarSessionDrag();
  };

  if (renaming) {
    return (
      <div data-session-path={sessionPath} className={rowClassName}>
        {leading}
        <input
          ref={renameInputRef}
          value={renameValue}
          className={cn(SESSION_TITLE_RENAME_INPUT_CLASS, "flex-1 basis-0")}
          aria-label={t("sidebar.renameSession")}
          onChange={(event) => onRenameValueChange?.(event.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={() => {
            if (!skipBlurCommitRef.current) {
              onRenameCommit?.();
            }
            skipBlurCommitRef.current = false;
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-session-path={sessionPath}
      disabled={disabled}
      draggable={sessionDragEnabled}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectPath(sessionPath)}
      onDragStart={handleSessionDragStart}
      onDragEnd={handleSessionDragEnd}
      onDoubleClick={(event) => {
        if (!onRenameStart || disabled || isBusy) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onRenameStart();
      }}
      className={rowClassName}
    >
      {leading}
      <span
        className={cn("min-w-0 flex-1 basis-0 truncate", DESKTOP_SIDEBAR_TEXT_CLASS)}
        title={showGitTooltip ? undefined : displayName}
      >
        {displayName}
      </span>
    </button>
  );
});

type SessionListNavProps = {
  ariaLabel: string;
  canRenameSession: boolean;
  canDeleteSession: boolean;
  contextMenuSession: SessionListItem | null;
  contextMenuSessionRef: RefObject<SessionListItem | null>;
  renameSessionBusy?: boolean;
  deleteSessionBusy?: boolean;
  onSessionContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenuOpenChange(open: boolean): void;
  onContextMenuCloseAutoFocus(event: Event): void;
  onRequestRename(session: SessionListItem): void;
  onRequestDelete(session: SessionListItem): void;
  children: ReactNode;
};

function SessionListNav({
  ariaLabel,
  canRenameSession,
  canDeleteSession,
  contextMenuSession,
  contextMenuSessionRef,
  renameSessionBusy,
  deleteSessionBusy,
  onSessionContextMenuCapture,
  onContextMenuOpenChange,
  onContextMenuCloseAutoFocus,
  onRequestRename,
  onRequestDelete,
  children,
}: SessionListNavProps) {
  const { t } = useTranslation();
  const canSessionContextMenu = canRenameSession || canDeleteSession;

  const nav = (
    <nav
      className="flex min-w-0 flex-col gap-0.5"
      aria-label={ariaLabel}
      onContextMenuCapture={canSessionContextMenu ? onSessionContextMenuCapture : undefined}
    >
      {children}
    </nav>
  );

  if (!canSessionContextMenu) {
    return nav;
  }

  const busy = (contextMenuSession ?? contextMenuSessionRef.current)?.isBusy === true;

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>{nav}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={t("sidebar.sessionActions")}
        onCloseAutoFocus={onContextMenuCloseAutoFocus}
      >
        {canRenameSession ? (
          <ContextMenuItem
            disabled={renameSessionBusy || busy}
            title={busy ? t("sidebar.cannotRenameBusySession") : undefined}
            onSelect={() => {
              const session = contextMenuSessionRef.current ?? contextMenuSession;
              if (session) {
                onRequestRename(session);
              }
            }}
          >
            <Pencil aria-hidden />
            {t("sidebar.renameSession")}
          </ContextMenuItem>
        ) : null}
        {canRenameSession && canDeleteSession ? <ContextMenuSeparator /> : null}
        {canDeleteSession ? (
          <ContextMenuItem
            variant="destructive"
            disabled={deleteSessionBusy || busy}
            title={busy ? t("sidebar.cannotDeleteBusySession") : undefined}
            onSelect={() => {
              const session = contextMenuSessionRef.current ?? contextMenuSession;
              if (session) {
                onRequestDelete(session);
              }
            }}
          >
            <Trash2 aria-hidden />
            {t("common.delete")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

type WorkspaceListNavProps = {
  canDeleteWorkspace: boolean;
  canRenameSession: boolean;
  canDeleteSession: boolean;
  contextMenuWorkspaceGroup: SessionWorkspaceGroup | null;
  contextMenuWorkspaceGroupRef: RefObject<SessionWorkspaceGroup | null>;
  contextMenuSession: SessionListItem | null;
  contextMenuSessionRef: RefObject<SessionListItem | null>;
  deleteWorkspaceBusy?: boolean;
  renameSessionBusy?: boolean;
  deleteSessionBusy?: boolean;
  onContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenuCloseAutoFocus(event: Event): void;
  onRequestDeleteWorkspace(group: SessionWorkspaceGroup): void;
  onRequestRenameSession(session: SessionListItem): void;
  onRequestDeleteSession(session: SessionListItem): void;
  children: ReactNode;
};

function WorkspaceListNav({
  canDeleteWorkspace,
  canRenameSession,
  canDeleteSession,
  contextMenuWorkspaceGroup,
  contextMenuWorkspaceGroupRef,
  contextMenuSession,
  contextMenuSessionRef,
  deleteWorkspaceBusy,
  renameSessionBusy,
  deleteSessionBusy,
  onContextMenuCapture,
  onContextMenuCloseAutoFocus,
  onRequestDeleteWorkspace,
  onRequestRenameSession,
  onRequestDeleteSession,
  children,
}: WorkspaceListNavProps) {
  const { t } = useTranslation();
  const { api, kind, ready: hostReady } = useHostApi();
  const canOpenWorkspaceDirectory = kind === "electron" && hostReady && api != null;

  const canShowMenu =
    canDeleteWorkspace || canRenameSession || canDeleteSession || canOpenWorkspaceDirectory;

  const inner = (
    <div className="min-w-0" onContextMenuCapture={canShowMenu ? onContextMenuCapture : undefined}>
      {children}
    </div>
  );

  if (!canShowMenu) {
    return inner;
  }

  const isWorkspaceTarget = Boolean(
    contextMenuWorkspaceGroup ?? contextMenuWorkspaceGroupRef.current,
  );
  const workspaceTarget = contextMenuWorkspaceGroupRef.current ?? contextMenuWorkspaceGroup;
  const sessionTarget = contextMenuSession ?? contextMenuSessionRef.current;
  const sessionBusy = sessionTarget?.isBusy === true;
  const showOpenWorkspaceDirectory =
    isWorkspaceTarget && canOpenWorkspaceDirectory && Boolean(workspaceTarget?.rootPath);
  const showDeleteWorkspace = isWorkspaceTarget && canDeleteWorkspace;

  // Do not clear target in onOpenChange(false): the Content is still mounted while the Radix exit
  // animation (duration-100) runs, and clearing it immediately would flip isWorkspaceTarget to
  // false, making the final exit frames flash into "delete session". Updating on capture / delete
  // confirmation is enough.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{inner}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={isWorkspaceTarget ? t("sidebar.workspaceActions") : t("sidebar.sessionActions")}
        onCloseAutoFocus={onContextMenuCloseAutoFocus}
      >
        {showOpenWorkspaceDirectory ? (
          <ContextMenuItem
            onSelect={() => {
              const group = contextMenuWorkspaceGroupRef.current ?? contextMenuWorkspaceGroup;
              const rootPath = group?.rootPath?.trim();
              if (rootPath && api) {
                void api.revealWorkspaceEntry("", rootPath);
              }
            }}
          >
            <FolderOpen aria-hidden />
            {t("sidebar.openWorkspaceDirectory")}
          </ContextMenuItem>
        ) : null}
        {showOpenWorkspaceDirectory && showDeleteWorkspace ? <ContextMenuSeparator /> : null}
        {showDeleteWorkspace ? (
          <ContextMenuItem
            variant="destructive"
            disabled={deleteWorkspaceBusy}
            onSelect={() => {
              const group = contextMenuWorkspaceGroupRef.current ?? contextMenuWorkspaceGroup;
              if (group) {
                onRequestDeleteWorkspace(group);
              }
            }}
          >
            <Trash2 aria-hidden />
            {t("common.delete")}
          </ContextMenuItem>
        ) : null}
        {!isWorkspaceTarget && canRenameSession ? (
          <ContextMenuItem
            disabled={renameSessionBusy || sessionBusy}
            title={sessionBusy ? t("sidebar.cannotRenameBusySession") : undefined}
            onSelect={() => {
              const session = contextMenuSessionRef.current ?? contextMenuSession;
              if (session) {
                onRequestRenameSession(session);
              }
            }}
          >
            <Pencil aria-hidden />
            {t("sidebar.renameSession")}
          </ContextMenuItem>
        ) : null}
        {!isWorkspaceTarget && canRenameSession && canDeleteSession ? (
          <ContextMenuSeparator />
        ) : null}
        {!isWorkspaceTarget && canDeleteSession ? (
          <ContextMenuItem
            variant="destructive"
            disabled={deleteSessionBusy || sessionBusy}
            title={sessionBusy ? t("sidebar.cannotDeleteBusySession") : undefined}
            onSelect={() => {
              const session = contextMenuSessionRef.current ?? contextMenuSession;
              if (session) {
                onRequestDeleteSession(session);
              }
            }}
          >
            <Trash2 aria-hidden />
            {t("common.delete")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const settingsPrimaryTabs: Array<{
  id: SettingsSidebarTab;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "general",
    labelKey: "settings.general",
    icon: Settings,
  },
  {
    id: "appearance",
    labelKey: "settings.appearance",
    icon: Palette,
  },
];

const settingsCapabilityTabs: Array<{
  id: SettingsSidebarTab;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "models",
    labelKey: "settings.models",
    icon: Layers,
  },
  {
    id: "agents",
    labelKey: "settings.agents",
    icon: Bot,
  },
  {
    id: "tab",
    labelKey: "settings.tab",
    icon: ArrowRightToLine,
  },
  {
    id: "skills",
    labelKey: "settings.skills",
    icon: Sparkles,
  },
  {
    id: "rules",
    labelKey: "settings.rules",
    icon: BookText,
  },
  {
    id: "mcps",
    labelKey: "settings.mcps",
    icon: Plug,
  },
  {
    id: "hooks",
    labelKey: "settings.hooks",
    icon: Code2,
  },
  {
    id: "dreams",
    labelKey: "settings.dreams",
    icon: MoonStar,
  },
];

const settingsConnectTabs: Array<{
  id: SettingsSidebarTab;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "networks",
    labelKey: "settings.networks",
    icon: Network,
  },
  {
    id: "integrations",
    labelKey: "settings.integrations",
    icon: Link2,
  },
  ...(isViteDev
    ? [
        {
          id: "developer" as const,
          labelKey: "settings.developer",
          icon: Code2,
        },
      ]
    : []),
];

const sidebarInteractionMotionClass = "!transition-[opacity,transform,box-shadow] duration-150";

/** Sidebar interactive items' default text/icon color; hover and selection return to sidebar-foreground */
const sidebarItemDefaultTextClass = "text-sidebar-action-foreground";

const sidebarItemActiveTextClass = "!text-sidebar-foreground";

/** Sidebar menu/session row hover: a unified semi-transparent wash, so nested buttons no longer stack a solid accent */
const sidebarMenuHoverClass = cn(
  "hover:!bg-canvas-hover focus-visible:!bg-canvas-hover",
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
);

/** Sidebar menu/session row selected: the same semi-transparent wash as hover, not deepened by selection */
const sidebarMenuSelectedClass = cn(
  "!bg-canvas-hover hover:!bg-canvas-hover focus-visible:!bg-canvas-hover",
  sidebarItemActiveTextClass,
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
);

const SIDEBAR_SCROLL_EDGE_THRESHOLD_PX = 1;

type SidebarScrollEdgeFades = {
  top: boolean;
  bottom: boolean;
};

function readSidebarScrollEdgeFades(viewport: HTMLElement): SidebarScrollEdgeFades {
  const { scrollTop, scrollHeight, clientHeight } = viewport;
  return {
    top: scrollTop > SIDEBAR_SCROLL_EDGE_THRESHOLD_PX,
    bottom: scrollTop + clientHeight < scrollHeight - SIDEBAR_SCROLL_EDGE_THRESHOLD_PX,
  };
}

const SIDEBAR_SCROLL_MASK = `linear-gradient(to bottom, rgb(0 0 0 / var(--sidebar-mask-top-alpha)) 0, black ${SCROLL_EDGE_FADE_PX}px, black calc(100% - ${SCROLL_EDGE_FADE_PX}px), rgb(0 0 0 / var(--sidebar-mask-bottom-alpha)) 100%)`;

function sidebarScrollAreaMaskStyle(top: boolean, bottom: boolean): React.CSSProperties {
  return {
    "--sidebar-mask-top-alpha": top ? "0" : "1",
    "--sidebar-mask-bottom-alpha": bottom ? "0" : "1",
    maskImage: SIDEBAR_SCROLL_MASK,
    WebkitMaskImage: SIDEBAR_SCROLL_MASK,
    transition: "--sidebar-mask-top-alpha 150ms, --sidebar-mask-bottom-alpha 150ms",
  } as React.CSSProperties;
}

function sidebarItemHoverClass(_translucency?: boolean) {
  return sidebarMenuHoverClass;
}

function sidebarItemSelectedClass(_translucency?: boolean) {
  return sidebarMenuSelectedClass;
}

function sidebarNavButtonVariant(_translucency?: boolean, _selected?: boolean): "ghost" {
  return "ghost";
}

function sessionRowSelectedClass(_translucency?: boolean) {
  return sidebarMenuSelectedClass;
}

function sessionRowHoverClass(_translucency?: boolean) {
  return sidebarMenuHoverClass;
}

/** Rename editing state: the same semi-transparent wash as hover, shown permanently */
function sessionRowRenamingClass(_translucency?: boolean) {
  return "!bg-canvas-hover";
}

function SessionSidebarInner({
  className,
  narrow,
  mode = "sessions",
  userHomeDirectory,
  sessions,
  activeFilePath,
  onSelectSession,
  onNewSession,
  onNewSessionInWorkspace,
  onOpenMarketplace,
  onOpenAutomations,
  onOpenSettings,
  onBackToSessions,
  marketplaceActive = false,
  automationsActive = false,
  settingsTab = "models",
  extensionSettingsId = null,
  extensionSettingsItems = [],
  onSettingsTabChange,
  onExtensionSettingsChange,
  translucency,
  newSessionBusy = false,
  sessionNavigationBusy = false,
  deleteSessionBusy = false,
  onDeleteSession,
  renameSessionBusy = false,
  onRenameSession,
  deleteWorkspaceBusy = false,
  onDeleteWorkspace,
  disabled,
  unseenCompletedSessionPaths,
}: SessionSidebarProps) {
  const { t, i18n } = useTranslation();
  const split = useOptionalConversationSplit();
  const settingsMode = mode === "settings";

  useEffect(() => {
    if (settingsMode && settingsTab === "developer" && !isViteDev) {
      onSettingsTabChange?.("models");
    }
  }, [settingsMode, settingsTab, onSettingsTabChange]);

  const { bound, unbound } = useMemo(
    () => partitionSessionsForSidebar(sessions, userHomeDirectory),
    [sessions, userHomeDirectory],
  );
  const builtWorkspaceGroups = useMemo(
    () => buildWorkspaceGroups(bound, undefined),
    [bound, i18n.language],
  );
  const [workspaceGroupOrder, setWorkspaceGroupOrder] = useState(readWorkspaceSidebarGroupOrder);
  const workspaceGroups = useMemo(
    () => applyWorkspaceGroupOrder(builtWorkspaceGroups, workspaceGroupOrder),
    [builtWorkspaceGroups, workspaceGroupOrder],
  );
  const effectiveWorkspaceGroupOrder = useMemo(
    () => workspaceGroupIdsInOrder(workspaceGroups),
    [workspaceGroups],
  );
  const handleWorkspaceGroupOrderChange = useCallback((nextOrder: string[]) => {
    setWorkspaceGroupOrder(nextOrder);
  }, []);
  const handleWorkspaceGroupOrderPersist = useCallback((nextOrder: string[]) => {
    writeWorkspaceSidebarGroupOrder(nextOrder);
  }, []);
  const workspaceGroupReorder = useWorkspaceGroupReorder({
    enabled: !disabled && !settingsMode && workspaceGroups.length > 1,
    order: effectiveWorkspaceGroupOrder,
    onOrderChange: handleWorkspaceGroupOrderChange,
    onPersist: handleWorkspaceGroupOrderPersist,
  });
  const unboundSessions = useMemo(() => sortSessionsByModified(unbound), [unbound]);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState(
    readWorkspaceSidebarExpandedById,
  );
  const [workspaceSectionExpanded, setWorkspaceSectionExpanded] = useState(
    readSidebarWorkspaceSectionExpanded,
  );
  const [noWorkspaceSectionExpanded, setNoWorkspaceSectionExpanded] = useState(
    readSidebarNoWorkspaceSectionExpanded,
  );
  const [visibleCountByWorkspaceGroupId, setVisibleCountByWorkspaceGroupId] = useState<
    Record<string, number>
  >({});
  const [unboundVisibleCount, setUnboundVisibleCount] = useState(SIDEBAR_SESSION_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [deleteSessionDialogOpen, setDeleteSessionDialogOpen] = useState(false);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<SessionWorkspaceGroup | null>(
    null,
  );
  const [deleteWorkspaceDialogOpen, setDeleteWorkspaceDialogOpen] = useState(false);
  const [deleteSectionTarget, setDeleteSectionTarget] = useState<
    "workspace-section" | "no-workspace-section" | null
  >(null);
  const [deleteSectionDialogOpen, setDeleteSectionDialogOpen] = useState(false);
  const [contextMenuSession, setContextMenuSession] = useState<SessionListItem | null>(null);
  const contextMenuSessionRef = useRef<SessionListItem | null>(null);
  const [contextMenuWorkspaceGroup, setContextMenuWorkspaceGroup] =
    useState<SessionWorkspaceGroup | null>(null);
  const contextMenuWorkspaceGroupRef = useRef<SessionWorkspaceGroup | null>(null);
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [, setRenameError] = useState("");
  const renameCommitInFlightRef = useRef(false);
  const pendingRenameFocusPathRef = useRef<string | null>(null);
  const scrollFadeRegionRef = useRef<HTMLDivElement>(null);
  const [scrollEdgeFades, setScrollEdgeFades] = useState<SidebarScrollEdgeFades>({
    top: false,
    bottom: false,
  });
  const sessionByPath = useMemo(() => {
    const map = new Map<string, SessionListItem>();
    for (const session of sessions) {
      map.set(session.path, session);
    }
    return map;
  }, [sessions]);
  const canDeleteSession = Boolean(onDeleteSession) && !disabled;
  const canRenameSession = Boolean(onRenameSession) && !disabled;
  const canDeleteWorkspace = Boolean(onDeleteWorkspace) && !disabled;
  const workspaceSectionSessionCount = useMemo(
    () => workspaceGroups.reduce((total, group) => total + group.sessions.length, 0),
    [workspaceGroups],
  );
  const workspaceSectionHasBusySession = useMemo(
    () => workspaceGroups.some((group) => group.sessions.some((session) => session.isBusy)),
    [workspaceGroups],
  );
  const noWorkspaceSectionHasBusySession = useMemo(
    () => unboundSessions.some((session) => session.isBusy),
    [unboundSessions],
  );
  const sectionDeleteBusy = deleteSessionBusy || deleteWorkspaceBusy;

  const dismissDeleteSessionDialog = useCallback(() => {
    setDeleteSessionDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setDeleteTarget(null);
    });
  }, []);

  const dismissDeleteWorkspaceDialog = useCallback(() => {
    setDeleteWorkspaceDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setDeleteWorkspaceTarget(null);
    });
  }, []);

  const dismissDeleteSectionDialog = useCallback(() => {
    setDeleteSectionDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setDeleteSectionTarget(null);
    });
  }, []);

  const workspaceGroupById = useMemo(() => {
    const map = new Map<string, SessionWorkspaceGroup>();
    for (const group of workspaceGroups) {
      map.set(group.rootPath ?? group.id, group);
      map.set(group.id, group);
    }
    return map;
  }, [workspaceGroups]);

  const handleWorkspaceContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const workspaceBtn = (event.target as HTMLElement).closest("[data-workspace-path]");
      if (workspaceBtn) {
        const workspacePath = workspaceBtn.getAttribute("data-workspace-path");
        const group = workspacePath ? workspaceGroupById.get(workspacePath) : undefined;
        if (group) {
          contextMenuWorkspaceGroupRef.current = group;
          setContextMenuWorkspaceGroup(group);
          contextMenuSessionRef.current = null;
          setContextMenuSession(null);
          return;
        }
      }

      const sessionRow = (event.target as HTMLElement).closest("[data-session-path]");
      if (sessionRow) {
        const sessionPath = sessionRow.getAttribute("data-session-path");
        const session = sessionPath ? sessionByPath.get(sessionPath) : undefined;
        if (session) {
          contextMenuSessionRef.current = session;
          setContextMenuSession(session);
          contextMenuWorkspaceGroupRef.current = null;
          setContextMenuWorkspaceGroup(null);
          return;
        }
      }
    },
    [sessionByPath, workspaceGroupById],
  );

  const handleWorkspaceContextMenuDelete = useCallback((group: SessionWorkspaceGroup) => {
    setDeleteWorkspaceTarget(group);
    setDeleteWorkspaceDialogOpen(true);
    runAfterRadixOverlayClose(() => {
      contextMenuWorkspaceGroupRef.current = null;
      setContextMenuWorkspaceGroup(null);
    });
  }, []);

  const handleSessionContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest("[data-session-path]");
      if (!row) {
        return;
      }
      const sessionPath = row.getAttribute("data-session-path");
      const session = sessionPath ? sessionByPath.get(sessionPath) : undefined;
      if (!session) {
        return;
      }
      contextMenuSessionRef.current = session;
      setContextMenuSession(session);
    },
    [sessionByPath],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      contextMenuSessionRef.current = null;
      setContextMenuSession(null);
    }
  }, []);

  const handleContextMenuDelete = useCallback((session: SessionListItem) => {
    contextMenuSessionRef.current = null;
    setContextMenuSession(null);
    setDeleteTarget(session);
    setDeleteSessionDialogOpen(true);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionPath(null);
    setRenameValue("");
    setRenameError("");
  }, []);

  const handleRenameStart = useCallback((session: SessionListItem) => {
    if (session.isBusy) {
      return;
    }
    setRenamingSessionPath(session.path);
    setRenameValue(session.displayName);
    setRenameError("");
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (renameCommitInFlightRef.current) {
      return;
    }
    if (!renamingSessionPath || !onRenameSession) {
      handleRenameCancel();
      return;
    }
    const trimmed = renameValue.trim();
    const session = sessionByPath.get(renamingSessionPath);
    if (!trimmed || trimmed === session?.displayName) {
      handleRenameCancel();
      return;
    }
    renameCommitInFlightRef.current = true;
    try {
      await onRenameSession(renamingSessionPath, trimmed);
      handleRenameCancel();
    } catch (error) {
      setRenameError(describeRenameError(error));
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [handleRenameCancel, onRenameSession, renameValue, renamingSessionPath, sessionByPath]);

  const handleRenameStartFromMenu = useCallback(
    (session: SessionListItem) => {
      pendingRenameFocusPathRef.current = session.path;
      handleRenameStart(session);
      contextMenuSessionRef.current = null;
      setContextMenuSession(null);
    },
    [handleRenameStart],
  );

  const handleContextMenuCloseAutoFocus = useCallback((event: Event) => {
    if (!pendingRenameFocusPathRef.current) {
      return;
    }
    event.preventDefault();
    pendingRenameFocusPathRef.current = null;
  }, []);

  const isSessionSelected = (sessionPath: string) =>
    !marketplaceActive &&
    !automationsActive &&
    !newSessionBusy &&
    activeFilePath !== null &&
    samePath(sessionPath, activeFilePath);

  const isActiveSessionInSidebar =
    activeFilePath !== null && sessions.some((session) => samePath(session.path, activeFilePath));

  const newSessionNavActive =
    !marketplaceActive &&
    !automationsActive &&
    !sessionNavigationBusy &&
    (newSessionBusy || !isActiveSessionInSidebar);
  const newSessionDragEnabled =
    Boolean(split) && !disabled && !(newSessionBusy && !newSessionNavActive);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    const unboundIndex = unboundSessions.findIndex((session) =>
      samePath(session.path, activeFilePath),
    );
    if (unboundIndex >= 0) {
      const needed = visibleCountForSessionIndex(unboundIndex);
      setUnboundVisibleCount((current) => (current >= needed ? current : needed));
      return;
    }
    for (const group of workspaceGroups) {
      const index = group.sessions.findIndex((session) => samePath(session.path, activeFilePath));
      if (index < 0) {
        continue;
      }
      const needed = visibleCountForSessionIndex(index);
      setVisibleCountByWorkspaceGroupId((current) => {
        const previous = current[group.id] ?? SIDEBAR_SESSION_PAGE_SIZE;
        if (previous >= needed) {
          return current;
        }
        return { ...current, [group.id]: needed };
      });
      return;
    }
  }, [activeFilePath, unboundSessions, workspaceGroups]);

  const loadMoreWorkspaceGroupSessions = useCallback((groupId: string, total: number) => {
    setVisibleCountByWorkspaceGroupId((current) => {
      const previous = current[groupId] ?? SIDEBAR_SESSION_PAGE_SIZE;
      return {
        ...current,
        [groupId]: Math.min(previous + SIDEBAR_SESSION_PAGE_SIZE, total),
      };
    });
  }, []);

  const loadMoreUnboundSessions = useCallback(() => {
    setUnboundVisibleCount((current) =>
      Math.min(current + SIDEBAR_SESSION_PAGE_SIZE, unboundSessions.length),
    );
  }, [unboundSessions.length]);

  useEffect(() => {
    const suppressScrollFade = !settingsMode && narrow;
    if (suppressScrollFade) {
      setScrollEdgeFades({ top: false, bottom: false });
      return;
    }

    const region = scrollFadeRegionRef.current;
    if (!region) {
      return;
    }

    const viewport = region.querySelector("[data-radix-scroll-area-viewport]");
    if (!(viewport instanceof HTMLElement)) {
      return;
    }

    const syncScrollEdgeFades = () => {
      setScrollEdgeFades(readSidebarScrollEdgeFades(viewport));
    };

    syncScrollEdgeFades();
    viewport.addEventListener("scroll", syncScrollEdgeFades, { passive: true });
    const resizeObserver = new ResizeObserver(syncScrollEdgeFades);
    resizeObserver.observe(viewport);
    const scrollContent = viewport.firstElementChild;
    if (scrollContent instanceof Element) {
      resizeObserver.observe(scrollContent);
    }

    return () => {
      viewport.removeEventListener("scroll", syncScrollEdgeFades);
      resizeObserver.disconnect();
    };
  }, [
    translucency,
    settingsMode,
    narrow,
    settingsTab,
    extensionSettingsId,
    extensionSettingsItems.length,
    sessions.length,
    workspaceGroups.length,
    unboundSessions.length,
    collapsedWorkspaceIds,
    workspaceSectionExpanded,
    noWorkspaceSectionExpanded,
  ]);

  const setWorkspaceGroupExpanded = useCallback((groupId: string, open: boolean) => {
    setCollapsedWorkspaceIds((current) => {
      const next = { ...current, [groupId]: open };
      writeWorkspaceSidebarExpandedById(next);
      return next;
    });
  }, []);

  useEffect(() => {
    registerSessionSidebarDigitShortcut({
      resolveVisibleSessions() {
        return listVisibleSidebarSessions({
          workspaceGroups,
          unboundSessions,
          workspaceSectionExpanded,
          noWorkspaceSectionExpanded,
          collapsedWorkspaceIds,
          visibleCountByWorkspaceGroupId,
          unboundVisibleCount,
        });
      },
    });
    return () => {
      unregisterSessionSidebarDigitShortcut();
    };
  }, [
    collapsedWorkspaceIds,
    noWorkspaceSectionExpanded,
    unboundSessions,
    unboundVisibleCount,
    visibleCountByWorkspaceGroupId,
    workspaceGroups,
    workspaceSectionExpanded,
  ]);

  const setWorkspaceSectionExpandedPersisted = useCallback((open: boolean) => {
    setWorkspaceSectionExpanded(open);
    writeSidebarWorkspaceSectionExpanded(open);
  }, []);

  const setNoWorkspaceSectionExpandedPersisted = useCallback((open: boolean) => {
    setNoWorkspaceSectionExpanded(open);
    writeSidebarNoWorkspaceSectionExpanded(open);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden text-sidebar-item-foreground",
        translucency ? "bg-transparent" : "bg-sidebar",
        className,
      )}
      data-narrow={narrow || undefined}
      id="session-sidebar-panel"
      aria-label={settingsMode ? t("sidebar.settingsNavAria") : t("sidebar.sessionNavAria")}
    >
      {settingsMode ? (
        <div className={cn("flex flex-col gap-2 px-1.5 pt-2.5", narrow && "items-center")}>
          <Button
            type="button"
            variant="ghost"
            size={narrow ? "icon" : "sm"}
            className={cn(
              "text-xs",
              sidebarItemDefaultTextClass,
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(translucency),
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onBackToSessions}
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t("common.back")}</span>
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-1.5 pb-1.5 px-1.5 pt-2.5",
            narrow && "shrink-0 items-center",
          )}
        >
          <Button
            type="button"
            variant={sidebarNavButtonVariant(translucency, newSessionNavActive)}
            size={narrow ? "icon" : "sm"}
            aria-current={newSessionNavActive ? "page" : undefined}
            draggable={newSessionDragEnabled}
            className={cn(
              "text-xs",
              sidebarItemDefaultTextClass,
              sidebarInteractionMotionClass,
              newSessionNavActive
                ? sidebarItemSelectedClass(translucency)
                : sidebarItemHoverClass(translucency),
              narrow ? "size-8 shrink-0" : "group h-8 w-full justify-start gap-2",
            )}
            disabled={disabled || (newSessionBusy && !newSessionNavActive)}
            onClick={onNewSession}
            onDragStart={(event) => {
              if (!split || !newSessionDragEnabled) {
                event.preventDefault();
                return;
              }
              const payload = { kind: "new" as const };
              setSidebarSessionDragData(event.dataTransfer, payload);
              split.startSidebarSessionDrag(payload);
            }}
            onDragEnd={() => split?.clearSidebarSessionDrag()}
          >
            <SquarePen className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t("sidebar.newSession")}</span>
            {!narrow && (
              <span className={sidebarItemShortcutClass} aria-hidden>
                {newSessionShortcutLabel}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant={sidebarNavButtonVariant(translucency, marketplaceActive)}
            size={narrow ? "icon" : "sm"}
            title={narrow ? t("sidebar.extensions") : undefined}
            aria-current={marketplaceActive ? "page" : undefined}
            className={cn(
              "text-xs",
              sidebarItemDefaultTextClass,
              sidebarInteractionMotionClass,
              marketplaceActive
                ? sidebarItemSelectedClass(translucency)
                : sidebarItemHoverClass(translucency),
              narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled}
            onClick={onOpenMarketplace}
          >
            <Blocks className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t("sidebar.extensions")}</span>
          </Button>
          {onOpenAutomations ? (
            <Button
              type="button"
              variant={sidebarNavButtonVariant(translucency, automationsActive)}
              size={narrow ? "icon" : "sm"}
              title={narrow ? t("sidebar.automations") : undefined}
              aria-current={automationsActive ? "page" : undefined}
              className={cn(
                "text-xs",
                sidebarItemDefaultTextClass,
                sidebarInteractionMotionClass,
                automationsActive
                  ? sidebarItemSelectedClass(translucency)
                  : sidebarItemHoverClass(translucency),
                narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
              )}
              disabled={disabled}
              onClick={onOpenAutomations}
            >
              <Bot className="size-3.5" aria-hidden />
              <span className={cn(narrow && "sr-only")}>{t("sidebar.automations")}</span>
            </Button>
          ) : null}
        </div>
      )}

      <div
        ref={scrollFadeRegionRef}
        className={cn(
          "relative min-h-0 w-full min-w-0 flex-1 overflow-hidden",
          !settingsMode && narrow && "hidden min-h-0 flex-none",
        )}
        aria-hidden={!settingsMode && narrow}
      >
        <ScrollArea
          className="h-full min-h-0 min-w-0"
          type="hover"
          scrollHideDelay={450}
          style={sidebarScrollAreaMaskStyle(scrollEdgeFades.top, scrollEdgeFades.bottom)}
        >
          {settingsMode ? (
            <nav
              className="flex min-w-0 flex-col gap-0.5 p-1.5"
              aria-label={t("sidebar.settingsTabsAria")}
            >
              {(
                [
                  { key: "settings-primary", tabs: settingsPrimaryTabs },
                  { key: "settings-capability", tabs: settingsCapabilityTabs },
                  { key: "settings-connect", tabs: settingsConnectTabs },
                ] as const
              ).map((group, groupIndex) => (
                <div
                  key={group.key}
                  className={cn("flex min-w-0 flex-col gap-0.5", groupIndex > 0 && "mt-3")}
                >
                  {group.tabs.map((tab) => {
                    const selected = extensionSettingsId === null && tab.id === settingsTab;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSettingsTabChange?.(tab.id)}
                        aria-current={selected ? "page" : undefined}
                        title={narrow ? t(tab.labelKey) : undefined}
                        className={cn(
                          buttonVariants({
                            variant: sidebarNavButtonVariant(translucency, selected),
                            size: narrow ? "icon" : "sm",
                          }),
                          "text-xs",
                          sidebarItemDefaultTextClass,
                          sidebarInteractionMotionClass,
                          selected
                            ? sidebarItemSelectedClass(translucency)
                            : sidebarItemHoverClass(translucency),
                          narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        <span className={cn("min-w-0 truncate", narrow && "sr-only")}>
                          {t(tab.labelKey)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {extensionSettingsItems.length > 0 ? (
                <>
                  <div className="h-2" aria-hidden />
                  {narrow ? null : (
                    <p className="px-2.5 pb-1 text-[0.65rem] text-sidebar-item-foreground">
                      {t("sidebar.extensionSettings")}
                    </p>
                  )}
                  {extensionSettingsItems.map((item) => {
                    const selected = item.id === extensionSettingsId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onExtensionSettingsChange?.(item.id)}
                        aria-current={selected ? "page" : undefined}
                        title={narrow ? item.label : undefined}
                        className={cn(
                          buttonVariants({
                            variant: sidebarNavButtonVariant(translucency, selected),
                            size: narrow ? "icon" : "sm",
                          }),
                          "text-xs",
                          sidebarItemDefaultTextClass,
                          sidebarInteractionMotionClass,
                          selected
                            ? sidebarItemSelectedClass(translucency)
                            : sidebarItemHoverClass(translucency),
                          narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
                        )}
                      >
                        <Blocks className="size-3.5" aria-hidden />
                        <span className={cn("min-w-0 truncate", narrow && "sr-only")}>
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : null}
            </nav>
          ) : (
            <div className={cn("min-w-0 px-1.5", sidebarSessionsScrollInsetClass)}>
              {workspaceGroups.length > 0 ? (
                <SidebarSectionCollapsible
                  label={t("sidebar.workspace")}
                  expanded={workspaceSectionExpanded}
                  disabled={disabled}
                  onOpenChange={setWorkspaceSectionExpandedPersisted}
                  contextMenu={
                    canDeleteWorkspace
                      ? {
                          ariaLabel: t("sidebar.sectionActions"),
                          disabled: sectionDeleteBusy || workspaceSectionHasBusySession,
                          disabledTitle: workspaceSectionHasBusySession
                            ? t("sidebar.cannotDeleteBusyInSection")
                            : undefined,
                          onRequestDelete: () => {
                            setDeleteSectionTarget("workspace-section");
                            setDeleteSectionDialogOpen(true);
                          },
                        }
                      : undefined
                  }
                >
                  <WorkspaceListNav
                    canDeleteWorkspace={canDeleteWorkspace}
                    canRenameSession={canRenameSession}
                    canDeleteSession={canDeleteSession}
                    contextMenuWorkspaceGroup={contextMenuWorkspaceGroup}
                    contextMenuWorkspaceGroupRef={contextMenuWorkspaceGroupRef}
                    contextMenuSession={contextMenuSession}
                    contextMenuSessionRef={contextMenuSessionRef}
                    deleteWorkspaceBusy={deleteWorkspaceBusy}
                    renameSessionBusy={renameSessionBusy}
                    deleteSessionBusy={deleteSessionBusy}
                    onContextMenuCapture={handleWorkspaceContextMenuCapture}
                    onContextMenuCloseAutoFocus={handleContextMenuCloseAutoFocus}
                    onRequestDeleteWorkspace={handleWorkspaceContextMenuDelete}
                    onRequestRenameSession={handleRenameStartFromMenu}
                    onRequestDeleteSession={handleContextMenuDelete}
                  >
                    {workspaceGroups.map((group) => {
                      const expanded = collapsedWorkspaceIds[group.id] !== false;
                      const visibleCount =
                        visibleCountByWorkspaceGroupId[group.id] ?? SIDEBAR_SESSION_PAGE_SIZE;
                      const visibleSessions = group.sessions.slice(0, visibleCount);
                      const hiddenSessionCount = group.sessions.length - visibleSessions.length;

                      return (
                        <WorkspaceSessionGroupCollapsible
                          key={group.id}
                          group={group}
                          expanded={expanded}
                          disabled={disabled}
                          translucency={translucency}
                          visibleSessions={visibleSessions}
                          hiddenSessionCount={hiddenSessionCount}
                          unseenCompletedSessionPaths={unseenCompletedSessionPaths}
                          isSessionSelected={isSessionSelected}
                          onOpenChange={(open) => {
                            if (disabled) {
                              return;
                            }
                            setWorkspaceGroupExpanded(group.id, open);
                          }}
                          onSelectSession={onSelectSession}
                          onLoadMore={() =>
                            loadMoreWorkspaceGroupSessions(group.id, group.sessions.length)
                          }
                          onNewSessionInWorkspace={onNewSessionInWorkspace}
                          newSessionBusy={newSessionBusy}
                          renamingSessionPath={renamingSessionPath}
                          renameValue={renameValue}
                          onRenameValueChange={setRenameValue}
                          onRenameCommit={() => void handleRenameCommit()}
                          onRenameCancel={handleRenameCancel}
                          onRenameStart={handleRenameStart}
                          canRenameSession={canRenameSession}
                          groupNodeRef={(node) =>
                            workspaceGroupReorder.registerGroupNode(group.id, node)
                          }
                          headerPointerHandlers={workspaceGroupReorder.getHeaderPointerHandlers(
                            group.id,
                          )}
                          onHeaderClickCapture={workspaceGroupReorder.handleHeaderClickCapture}
                          isDragging={workspaceGroupReorder.draggingGroupId === group.id}
                          isPressing={workspaceGroupReorder.pressingGroupId === group.id}
                          workspaceReorderActive={workspaceGroupReorder.draggingGroupId !== null}
                        />
                      );
                    })}
                  </WorkspaceListNav>
                </SidebarSectionCollapsible>
              ) : null}
              {unboundSessions.length > 0 && workspaceGroups.length > 0 ? (
                <div className="h-2" aria-hidden />
              ) : null}
              <SessionListNav
                ariaLabel={t("sidebar.workspaceSessionsAria")}
                canRenameSession={canRenameSession}
                canDeleteSession={canDeleteSession}
                contextMenuSession={contextMenuSession}
                contextMenuSessionRef={contextMenuSessionRef}
                renameSessionBusy={renameSessionBusy}
                deleteSessionBusy={deleteSessionBusy}
                onSessionContextMenuCapture={handleSessionContextMenuCapture}
                onContextMenuOpenChange={handleContextMenuOpenChange}
                onContextMenuCloseAutoFocus={handleContextMenuCloseAutoFocus}
                onRequestRename={handleRenameStartFromMenu}
                onRequestDelete={handleContextMenuDelete}
              >
                {unboundSessions.length > 0 ? (
                  <SidebarSectionCollapsible
                    label={t("sidebar.noWorkspaceSessions")}
                    expanded={noWorkspaceSectionExpanded}
                    disabled={disabled}
                    headerClassName="pt-1"
                    onOpenChange={setNoWorkspaceSectionExpandedPersisted}
                    contextMenu={
                      canDeleteSession
                        ? {
                            ariaLabel: t("sidebar.sectionActions"),
                            disabled: sectionDeleteBusy || noWorkspaceSectionHasBusySession,
                            disabledTitle: noWorkspaceSectionHasBusySession
                              ? t("sidebar.cannotDeleteBusyInSection")
                              : undefined,
                            onRequestDelete: () => {
                              setDeleteSectionTarget("no-workspace-section");
                              setDeleteSectionDialogOpen(true);
                            },
                          }
                        : undefined
                    }
                  >
                    <SessionListGitTooltip>
                      <SessionListGitTooltip.Zone className="flex min-w-0 flex-col gap-0.5">
                        {unboundSessions.slice(0, unboundVisibleCount).map((session) => (
                          <SessionListGitTooltip.Row key={session.path} session={session}>
                            <SessionListRow
                              sessionPath={session.path}
                              displayName={session.displayName}
                              gitBranch={session.gitBranch}
                              isBusy={session.isBusy}
                              isBlocked={session.isBlocked}
                              showCompletedUnseen={
                                unseenCompletedSessionPaths?.has(session.path) === true
                              }
                              nested={false}
                              selected={isSessionSelected(session.path)}
                              disabled={disabled}
                              translucency={translucency}
                              onSelectPath={onSelectSession}
                              renaming={renamingSessionPath === session.path}
                              renameValue={
                                renamingSessionPath === session.path ? renameValue : undefined
                              }
                              onRenameValueChange={setRenameValue}
                              onRenameCommit={() => void handleRenameCommit()}
                              onRenameCancel={handleRenameCancel}
                              onRenameStart={
                                canRenameSession && !session.isBusy
                                  ? () => handleRenameStart(session)
                                  : undefined
                              }
                            />
                          </SessionListGitTooltip.Row>
                        ))}
                        <SessionListLoadMore
                          hiddenCount={unboundSessions.length - unboundVisibleCount}
                          disabled={disabled}
                          onLoadMore={loadMoreUnboundSessions}
                        />
                      </SessionListGitTooltip.Zone>
                    </SessionListGitTooltip>
                  </SidebarSectionCollapsible>
                ) : null}
              </SessionListNav>
            </div>
          )}
        </ScrollArea>
      </div>

      {!settingsMode ? (
        <div className={cn("shrink-0 px-2 pb-2", narrow && "mt-auto flex flex-col items-center")}>
          {narrow ? (
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    sidebarItemDefaultTextClass,
                    sidebarInteractionMotionClass,
                    sidebarItemHoverClass(translucency),
                    "size-8",
                  )}
                  onClick={onOpenSettings}
                  aria-label={t("settings.title")}
                >
                  <Settings className="size-4" aria-hidden />
                  <span className="sr-only">{t("settings.title")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {t("settings.title")} <SettingsShortcutKbd />
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                sidebarItemDefaultTextClass,
                sidebarInteractionMotionClass,
                sidebarItemHoverClass(translucency),
                "group h-8 w-full justify-start gap-2",
              )}
              onClick={onOpenSettings}
            >
              <Settings className="size-4" aria-hidden />
              <span>{t("settings.title")}</span>
              <span className={sidebarItemShortcutClass} aria-hidden>
                {settingsShortcutLabelText}
              </span>
            </Button>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={deleteSessionDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteSessionDialogOpen(true);
          } else if (!deleteSessionBusy) {
            dismissDeleteSessionDialog();
          }
        }}
        title={t("sidebar.deleteSessionConfirmTitle", { name: deleteTarget?.displayName ?? "" })}
        description={t("sidebar.deleteSessionConfirmDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteSessionBusy}
        onConfirm={async () => {
          const target = deleteTarget;
          if (!target || !onDeleteSession) {
            return;
          }
          await onDeleteSession(target.path);
          dismissDeleteSessionDialog();
        }}
      />

      <AlertDialog
        open={deleteSectionDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteSectionDialogOpen(true);
          } else if (!sectionDeleteBusy) {
            dismissDeleteSectionDialog();
          }
        }}
        title={
          deleteSectionTarget === "workspace-section"
            ? t("sidebar.deleteAllWorkspacesConfirmTitle")
            : t("sidebar.deleteAllNoWorkspaceSessionsConfirmTitle")
        }
        description={
          deleteSectionTarget === "workspace-section"
            ? t("sidebar.deleteAllWorkspacesConfirmDescription", {
                workspaceCount: workspaceGroups.length,
                sessionCount: workspaceSectionSessionCount,
              })
            : t("sidebar.deleteAllNoWorkspaceSessionsConfirmDescription", {
                count: unboundSessions.length,
              })
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={sectionDeleteBusy}
        onConfirm={async () => {
          const target = deleteSectionTarget;
          if (!target) {
            return;
          }
          if (target === "workspace-section") {
            if (!onDeleteWorkspace) {
              return;
            }
            for (const group of workspaceGroups) {
              await onDeleteWorkspace(group.rootPath ?? group.id);
            }
          } else if (onDeleteSession) {
            for (const session of unboundSessions) {
              await onDeleteSession(session.path);
            }
          }
          dismissDeleteSectionDialog();
        }}
      />

      <AlertDialog
        open={deleteWorkspaceDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteWorkspaceDialogOpen(true);
          } else if (!deleteWorkspaceBusy) {
            dismissDeleteWorkspaceDialog();
          }
        }}
        title={t("sidebar.deleteWorkspaceConfirmTitle", {
          name: deleteWorkspaceTarget?.label ?? "",
        })}
        description={t("sidebar.deleteWorkspaceConfirmDescription", {
          count: deleteWorkspaceTarget?.sessions.length ?? 0,
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteWorkspaceBusy}
        onConfirm={async () => {
          const target = deleteWorkspaceTarget;
          if (!target || !onDeleteWorkspace) {
            return;
          }
          await onDeleteWorkspace(target.rootPath ?? target.id);
          dismissDeleteWorkspaceDialog();
        }}
      />
    </aside>
  );
}

export const SessionSidebar = memo(SessionSidebarInner);
