import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  MoreHorizontal,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Trash2,
  X,
} from "lucide-react";

import {
  NewSessionShortcutKbd,
  WorkspaceToolsShortcutKbd,
} from "@/components/layout/desktop-shortcut-kbds";
import { SessionSidebarToggleButton } from "@/components/layout/session-sidebar-toggle-button";
import { SessionChromeBreadcrumb } from "@/components/session-chrome-breadcrumb";
import type { SessionGitTooltipItem } from "@/components/session-list-git-tooltip";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { useWorkspaceToolsChrome } from "@/contexts/workspace-tools-chrome-context";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  DESKTOP_SHELL_LAYOUT_TRANSITION,
} from "@/lib/desktop-chrome";
import {
  isDarwinElectronShell,
  modBackslashShortcutLabel,
  modShiftBackslashShortcutLabel,
} from "@/lib/desktop-shell";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { useDarwinWindowFullscreen } from "@/hooks/useDarwinWindowFullscreen";
import { cn } from "@/lib/utils";

const splitRightShortcutLabel = modBackslashShortcutLabel();
const splitDownShortcutLabel = modShiftBackslashShortcutLabel();

function isPaneDragBlockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('button, a, input, textarea, select, [role="menuitem"], [data-no-pane-drag]'),
    )
  );
}

export function DesktopLayoutChromeBar({
  useTranslucency: _useTranslucency,
  showSessionSidebarToggle = true,
  showWorkspaceToggle,
  showSplitMenu = false,
  showSideChat = false,
  showClosePane = false,
  sessionTitle,
  sessionTitleSuffix,
  sessionTooltip,
  subagentPromptText,
  onExitSubagentViewer,
  onNewSession,
  newSessionBusy = false,
  onSplit,
  onSideChat,
  onSplitVertical,
  onClosePane,
  paneId,
  onPaneDragStart,
  onPaneDragEnter: _onPaneDragEnter,
  onPaneDragLeave,
  onPaneDrop,
  showDeleteSession = false,
  deleteSessionDisplayName,
  deleteSessionPath,
  deleteSessionBusy = false,
  conversationBusy = false,
  onDeleteSession,
  onDeleteSessionOverlayClosed,
  showRenameSession = false,
  renameSessionPath,
  renameSessionDisplayName,
  renameSessionBusy = false,
  onRenameSession,
}: {
  useTranslucency: boolean;
  showSessionSidebarToggle?: boolean;
  showWorkspaceToggle: boolean;
  showSplitMenu?: boolean;
  showSideChat?: boolean;
  showClosePane?: boolean;
  sessionTitle?: string | null;
  sessionTitleSuffix?: string | null;
  sessionTooltip?: SessionGitTooltipItem | null;
  subagentPromptText?: string | null;
  onExitSubagentViewer?: () => void;
  onNewSession?: () => void;
  newSessionBusy?: boolean;
  onSplit?: () => void;
  onSideChat?: () => void;
  onSplitVertical?: () => void;
  onClosePane?: () => void;
  paneId?: string;
  onPaneDragStart?: (paneId: string) => void;
  onPaneDragEnter?: (
    paneId: string,
    zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
  ) => void;
  onPaneDragLeave?: () => void;
  onPaneDrop?: (
    paneId: string,
    zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
  ) => void;
  showDeleteSession?: boolean;
  deleteSessionDisplayName?: string | null;
  deleteSessionPath?: string | null;
  deleteSessionBusy?: boolean;
  conversationBusy?: boolean;
  onDeleteSession?: (path: string) => void | Promise<void>;
  onDeleteSessionOverlayClosed?: () => void | Promise<void>;
  showRenameSession?: boolean;
  renameSessionPath?: string | null;
  renameSessionDisplayName?: string | null;
  renameSessionBusy?: boolean;
  onRenameSession?: (path: string, displayName: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen } = useSessionSidebarChrome();
  const {
    open: workspaceToolsOpen,
    toggle: onToggleWorkspaceTools,
    fullScreen: workspaceToolsFullScreen,
    chromePinned: workspaceToolsChromePinned,
    dismissForNewSession: dismissWorkspaceToolsForNewSession,
    registerNewSessionChrome,
  } = useWorkspaceToolsChrome();
  const darwinElectron = isDarwinElectronShell();
  const darwinFullScreen = useDarwinWindowFullscreen(darwinElectron);
  const pinSidebarToggleOnDarwin = darwinElectron && !darwinFullScreen;
  const showTrailingActions = showWorkspaceToggle || showSplitMenu;
  const trimmedSessionTitle = sessionTitle?.trim() ?? "";
  const paneDragEnabled = Boolean(paneId && onPaneDragStart);
  const [deleteSessionDialogOpen, setDeleteSessionDialogOpen] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameCommitInFlightRef = useRef(false);
  const pendingRenameFocusRef = useRef(false);
  const trimmedDeleteSessionPath = deleteSessionPath?.trim() ?? "";
  const trimmedDeleteSessionDisplayName = deleteSessionDisplayName?.trim() ?? "";
  const trimmedRenameSessionPath = renameSessionPath?.trim() ?? "";
  const trimmedRenameSessionDisplayName = renameSessionDisplayName?.trim() ?? "";
  const trimmedSubagentPromptText = subagentPromptText?.trim() ?? "";
  const canRenameTitle =
    showRenameSession &&
    Boolean(onRenameSession) &&
    Boolean(trimmedRenameSessionPath) &&
    !trimmedSubagentPromptText;

  const handleRenameCancel = useCallback(() => {
    setRenamingTitle(false);
    setRenameValue("");
  }, []);

  const handleRenameStart = useCallback(() => {
    if (renameSessionBusy || conversationBusy || !canRenameTitle) {
      return;
    }
    setRenamingTitle(true);
    setRenameValue(trimmedSessionTitle || trimmedRenameSessionDisplayName);
  }, [
    canRenameTitle,
    conversationBusy,
    renameSessionBusy,
    trimmedRenameSessionDisplayName,
    trimmedSessionTitle,
  ]);

  const handleRenameCommit = useCallback(async () => {
    if (renameCommitInFlightRef.current) {
      return;
    }
    if (!renamingTitle || !onRenameSession || !trimmedRenameSessionPath) {
      handleRenameCancel();
      return;
    }
    const trimmed = renameValue.trim();
    const currentName = trimmedSessionTitle || trimmedRenameSessionDisplayName;
    if (!trimmed || trimmed === currentName) {
      handleRenameCancel();
      return;
    }
    renameCommitInFlightRef.current = true;
    try {
      await onRenameSession(trimmedRenameSessionPath, trimmed);
      handleRenameCancel();
    } catch {
      // Runtime error banner handles host failures.
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [
    handleRenameCancel,
    onRenameSession,
    renameValue,
    renamingTitle,
    trimmedRenameSessionDisplayName,
    trimmedRenameSessionPath,
    trimmedSessionTitle,
  ]);

  useEffect(() => {
    handleRenameCancel();
  }, [handleRenameCancel, trimmedRenameSessionPath]);

  const dismissDeleteSessionDialog = useCallback((afterClose?: () => void) => {
    setDeleteSessionDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      afterClose?.();
    });
  }, []);

  const handleNewSessionClick = useCallback(() => {
    // New session = new space: while full screen, collapse the tools panel instantly (no reverse
    // animation) so the old space's tools do not linger; workspace-level tabs stay untouched.
    if (workspaceToolsFullScreen) {
      dismissWorkspaceToolsForNewSession();
    }
    onNewSession?.();
  }, [dismissWorkspaceToolsForNewSession, onNewSession, workspaceToolsFullScreen]);

  useEffect(() => {
    if (!onNewSession || !showSessionSidebarToggle) {
      return;
    }
    return registerNewSessionChrome();
  }, [onNewSession, registerNewSessionChrome, showSessionSidebarToggle]);

  return (
    <div
      role="toolbar"
      aria-label={t("app.sidebarAndTools")}
      data-spirit-surface="layout-chrome"
      data-session-sidebar-open={sessionSidebarOpen ? "true" : "false"}
      data-macos-leading-inset={showSessionSidebarToggle ? "true" : "false"}
      data-pane-id={paneId}
      draggable={paneDragEnabled}
      onDragStart={(event) => {
        if (!paneDragEnabled || !paneId || !onPaneDragStart) {
          return;
        }
        if (isPaneDragBlockedTarget(event.target)) {
          event.preventDefault();
          return;
        }
        onPaneDragStart(paneId);
      }}
      onDragEnd={() => onPaneDragLeave?.()}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-2",
        showTrailingActions ? "justify-between" : "justify-start",
        paneDragEnabled && "cursor-grab active:cursor-grabbing",
      )}
      onDragOver={(event) => {
        if (!paneId || !onPaneDrop) {
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {!showSessionSidebarToggle && pinSidebarToggleOnDarwin ? (
          <div className="h-7 w-0 shrink-0" aria-hidden />
        ) : null}
        {showSessionSidebarToggle ? (
          pinSidebarToggleOnDarwin ? (
            <div data-darwin-pinned-sidebar-toggle>
              <SessionSidebarToggleButton />
            </div>
          ) : (
            // Win/Linux (and macOS window fullscreen): while the tools panel is full screen this
            // wrapper fixed-pins the toggle above the panel (see styles.css); in-flow otherwise.
            <div
              data-workspace-tools-pinned-sidebar-toggle={
                workspaceToolsChromePinned ? "" : undefined
              }
              className="mr-1"
            >
              <SessionSidebarToggleButton />
            </div>
          )
        ) : null}
        {showSessionSidebarToggle && pinSidebarToggleOnDarwin ? (
          <div
            className={cn(
              "h-7 shrink-0 overflow-hidden",
              DESKTOP_SHELL_LAYOUT_TRANSITION,
              sessionSidebarOpen ? "mr-0 w-0" : "mr-1 w-7",
            )}
            aria-hidden
          />
        ) : null}
        {onNewSession && showSessionSidebarToggle ? (
          // While the tools panel is full screen the outer wrapper fixed-pins the button above the
          // panel (see styles.css). position:fixed takes the inner width slot out of the leading
          // flex, so an in-flow ghost keeps the breadcrumb from snapping into that gap on frame 1.
          <>
            <div
              data-workspace-tools-pinned-new-session={workspaceToolsChromePinned ? "" : undefined}
            >
              <div
                className={cn(
                  "shrink-0 overflow-hidden",
                  DESKTOP_SHELL_LAYOUT_TRANSITION,
                  sessionSidebarOpen
                    ? "pointer-events-none mr-0 w-0 opacity-0"
                    : "mr-1 w-7 opacity-100",
                )}
                aria-hidden={sessionSidebarOpen}
              >
                <Tooltip delayDuration={300} disableHoverableContent>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                      onClick={handleNewSessionClick}
                      disabled={newSessionBusy}
                      tabIndex={sessionSidebarOpen ? -1 : undefined}
                      aria-label={t("sidebar.newSession")}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" sideOffset={4}>
                    {t("sidebar.newSession")} <NewSessionShortcutKbd />
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            {workspaceToolsChromePinned && !sessionSidebarOpen ? (
              <div
                className={cn(
                  "mr-1 h-7 w-7 shrink-0 overflow-hidden",
                  DESKTOP_SHELL_LAYOUT_TRANSITION,
                )}
                aria-hidden
              />
            ) : null}
          </>
        ) : null}
        {trimmedSessionTitle || renamingTitle ? (
          // The full-screen tools panel covers the conversation column; fade the breadcrumb out for
          // the same 300ms instead of letting the column's overflow clip it mid-flight.
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center",
              "transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              workspaceToolsFullScreen && "pointer-events-none opacity-0",
            )}
          >
            <SessionChromeBreadcrumb
              sessionTitle={trimmedSessionTitle || trimmedRenameSessionDisplayName}
              sessionTitleSuffix={sessionTitleSuffix}
              sessionTooltip={sessionTooltip}
              subagentPromptText={subagentPromptText}
              onExitSubagentViewer={onExitSubagentViewer}
              renaming={renamingTitle}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onRenameCommit={() => void handleRenameCommit()}
              onRenameCancel={handleRenameCancel}
              onRenameStart={canRenameTitle ? handleRenameStart : undefined}
            />
          </div>
        ) : null}
      </div>
      {showTrailingActions ? (
        // Covered by the full-screen tools panel: fade the pane menu and workspace toggle out with
        // the same 300ms curve (and keep them unfocusable) until the reverse flight starts.
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            "transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            workspaceToolsFullScreen && "pointer-events-none opacity-0",
          )}
          data-no-pane-drag
        >
          {showSplitMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  aria-label={t("app.conversationPaneMenu")}
                >
                  <MoreHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-40 p-0"
                onCloseAutoFocus={(event) => {
                  if (!pendingRenameFocusRef.current) {
                    return;
                  }
                  event.preventDefault();
                  pendingRenameFocusRef.current = false;
                }}
              >
                <div className="p-1">
                  {showSideChat ? (
                    <DropdownMenuItem className="gap-2" onSelect={() => onSideChat?.()}>
                      <MessageCircle
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span>{t("app.sideChat")}</span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem className="gap-2" onSelect={() => onSplit?.()}>
                    <SquareSplitHorizontal
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span>{t("app.splitRight")}</span>
                    <DropdownMenuShortcut>{splitRightShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => onSplitVertical?.()}>
                    <SquareSplitVertical
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span>{t("app.splitDown")}</span>
                    <DropdownMenuShortcut>{splitDownShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {showClosePane ? (
                    <DropdownMenuItem className="gap-2" onSelect={() => onClosePane?.()}>
                      <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span>{t("app.closePane")}</span>
                    </DropdownMenuItem>
                  ) : null}
                </div>
                {canRenameTitle ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="p-1">
                      <DropdownMenuItem
                        className="gap-2"
                        disabled={renameSessionBusy || conversationBusy}
                        title={conversationBusy ? t("sidebar.cannotRenameBusySession") : undefined}
                        onSelect={() => {
                          pendingRenameFocusRef.current = true;
                          handleRenameStart();
                        }}
                      >
                        <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span>{t("sidebar.renameSession")}</span>
                      </DropdownMenuItem>
                    </div>
                  </>
                ) : null}
                {showDeleteSession && onDeleteSession && trimmedDeleteSessionPath ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="p-1">
                      <DropdownMenuItem
                        variant="destructive"
                        className="gap-2"
                        disabled={deleteSessionBusy || conversationBusy}
                        title={conversationBusy ? t("sidebar.cannotDeleteBusySession") : undefined}
                        onSelect={() => {
                          setDeleteSessionDialogOpen(true);
                        }}
                      >
                        <Trash2 className="size-3.5 shrink-0" aria-hidden />
                        <span>{t("common.delete")}</span>
                      </DropdownMenuItem>
                    </div>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showWorkspaceToggle ? (
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  onClick={onToggleWorkspaceTools}
                  aria-label={workspaceToolsOpen ? t("app.collapseTools") : t("app.expandTools")}
                  aria-expanded={workspaceToolsOpen}
                  {...(workspaceToolsOpen ? { "aria-controls": "workspace-tools-panel" } : {})}
                >
                  {workspaceToolsOpen ? (
                    <PanelRightClose className="size-3.5" aria-hidden />
                  ) : (
                    <PanelRightOpen className="size-3.5" aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align={workspaceToolsOpen ? "center" : "end"}
                sideOffset={4}
              >
                {workspaceToolsOpen ? t("app.collapseTools") : t("app.expandTools")}{" "}
                <WorkspaceToolsShortcutKbd />
              </TooltipContent>
            </Tooltip>
          ) : null}
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
        title={t("sidebar.deleteSessionConfirmTitle", { name: trimmedDeleteSessionDisplayName })}
        description={t("sidebar.deleteSessionConfirmDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteSessionBusy}
        onConfirm={async () => {
          if (!onDeleteSession) {
            return;
          }
          try {
            await onDeleteSession(trimmedDeleteSessionPath);
            dismissDeleteSessionDialog(() => {
              void onDeleteSessionOverlayClosed?.();
            });
          } catch {
            // Keep dialog open; runtime surfaces the error.
          }
        }}
      />
    </div>
  );
}
