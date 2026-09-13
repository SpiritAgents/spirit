import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  ComponentRef,
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
  RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ComposerDock } from "@/components/conversation/composer-dock";
import { BranchCheckoutDialog } from "@/components/branch-checkout-dialog";
import { ConversationList } from "@/components/conversation/conversation-list";
import { ConversationMessageSelectionMenu } from "@/components/conversation/conversation-message-selection-menu";
import { DesktopLayoutChromeBar } from "@/components/layout/desktop-layout-chrome-bar";
import { sessionGitTooltipItemFromChromeSession } from "@/components/session-list-git-tooltip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { CONVERSATION_GUTTER_X, CONVERSATION_MAX_W } from "@/lib/conversation-layout-constants";
import {
  desktopTranslucencyTintClass,
  desktopTranslucencyTintInnerClass,
} from "@/lib/desktop-translucency-surface";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import { scrollAreaViewport } from "@/lib/scroll-area-viewport";
import type { ActiveWorkspaceFileReferenceQuery } from "@/lib/composer-segment-model";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import { isSideChatPaneProvisionalSessionPath } from "@/lib/session-path-kind";
import type { ActiveSkillSlashQuery, SkillSlashSuggestion } from "@/lib/skill-slash";
import type { ComposerLocalFileAttachmentView } from "@/lib/local-file-attachments";
import { cn } from "@/lib/utils";
import type {
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
} from "@/types";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useConversationSessionScrollTail } from "@/hooks/useConversationSessionScrollTail";
import { useConversationStreamScrollTail } from "@/hooks/useConversationStreamScrollTail";
import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import type { TurnContinuePresentation } from "@/lib/conversation-continue-ui";
import type { PendingAssistantAux } from "@/types";
import { useConversationSplit } from "@/contexts/conversation-split-context";
import {
  PANE_DROP_ZONE_ORDER,
  effectiveRepositionZone,
  paneDropZoneGridCellClass,
  paneDropZoneGridLayoutClass,
  visiblePaneDropZonesForDrag,
  visiblePaneDropZonesForSidebarSessionDrag,
} from "@/lib/conversation-pane-drop-preview";
import type { PaneDropZone } from "@/lib/conversation-split-layout";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type ConversationListSectionProps = {
  messages: readonly ConversationMessageSnapshot[];
  conversationRenderItems: readonly ConversationRenderItem[];
  composerSessionKey: string;
  conversationListScopeKey: string;
  conversationListRemountEpoch: number;
  conversationPendingAuxState: PendingAssistantAux | undefined;
  processGroupManualOpen: Record<string, boolean>;
  processGroupManualOpenKey: (groupId: string) => string;
  onProcessGroupManualOpenChange: (groupId: string, open: boolean) => void;
  shouldPlayProcessSealAnimation: (groupId: string) => boolean;
  runtime: DesktopRuntime;
  turnContinue: TurnContinuePresentation | undefined;
  activeSessionReadOnly: boolean;
  continueBusy: boolean;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftChange: (
    updater: (current: MessageRewindDraftState | null) => MessageRewindDraftState | null,
  ) => void;
  messageRewindComposerEnabled: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  models: DesktopSnapshot["config"]["models"];
  onOpenSubagentViewer: ((toolCallId: string) => void) | undefined;
  onOpenReadFile: ((target: EditorFileTarget) => void) | undefined;
  onOpenPlan: (() => void) | undefined;
  onStartMessageRewind: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onForkMessage: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onSubmitMessageRewind: () => void;
  onRewindRemoveLocalFileAttachment: (path: string) => void;
  onRewindPickLocalFile: () => void;
  onRewindPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onRewindDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onRewindDrop: (event: ReactDragEvent<HTMLElement>) => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
};

export type ComposerDockSectionProps = {
  composerDockRef: Ref<HTMLDivElement | null>;
  doodleText: string;
  showWorkspaceBindingControls: boolean;
  paneSessionPath?: string;
  useIsolatedPaneWorkspace?: boolean;
  composerSegments: readonly import("@/lib/composer-segment-model").RichSegment[];
  onComposerSegmentsChange: (
    segments: import("@/lib/composer-segment-model").RichSegment[],
  ) => void;
  composerLocalFileAttachments: ComposerLocalFileAttachmentView[];
  onComposerLocalFileAttachmentsChange: (attachments: ComposerLocalFileAttachmentView[]) => void;
  commitBusy: boolean;
  rewindWarnings: NonNullable<DesktopSnapshot["conversation"]["rewindWarnings"]>;
  showPendingApprovalInComposer: boolean;
  pendingApproval: DesktopSnapshot["conversation"]["pendingToolApproval"];
  showPendingQuestionsInComposer: boolean;
  pendingQuestions: DesktopSnapshot["conversation"]["pendingQuestions"];
  questionDrafts?: Record<string, import("@/hooks/useDesktopRuntime").QuestionDraft>;
  onUpdateQuestionDraft?: (
    questionId: string,
    updater: (
      draft: import("@/hooks/useDesktopRuntime").QuestionDraft,
    ) => import("@/hooks/useDesktopRuntime").QuestionDraft,
  ) => void;
  onSubmitQuestions?: () => void;
  onSkipQuestions?: () => void;
  fileReferenceSelectedIndex: number;
  onFileReferenceSelectedIndexChange: (index: number) => void;
  fileReferenceMenuView: import("@/lib/composer-at-reference-demo").AtReferenceMenuView;
  atReferenceMenuItems: import("@/lib/composer-at-reference-demo").AtReferenceMenuItem[];
  onApplyFileReferenceSuggestion: (path: string) => void;
  onApplySessionReferenceSuggestion: (session: { path: string; title: string }) => void;
  onOpenAtReferenceSessions: () => void;
  onBackAtReferenceMenu: () => void;
  onDismissFileReferenceSuggestions: () => void;
  activeFileReferenceQuery: ActiveWorkspaceFileReferenceQuery | undefined;
  slashQuery: ActiveSkillSlashQuery | undefined;
  slashSuggestions: SkillSlashSuggestion[];
  slashSelectedIndex: number;
  onSlashSelectedIndexChange: (index: number) => void;
  onApplySlashSuggestionItem: (suggestion: SkillSlashSuggestion) => void;
  onDismissSlashSuggestions: () => void;
  composerCursorCodeUnits: number;
  composerPlaceholder: string;
  composerAgentModeChipPlaceholder?: string;
  composerCanSend: boolean;
  composerHasPayload: boolean;
  composerBusy: boolean;
  conversationInterruptible: boolean;
  composerBrowserElementAttachments: BrowserElementAttachment[];
  onComposerBrowserElementAttachmentsChange: (attachments: BrowserElementAttachment[]) => void;
  onSubmitComposerMessage: () => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
  composerRichInputRef: RefObject<ComposerRichInputHandle | null>;
  onMessageQuoteAddToSession: (attachment: MessageQuoteAttachment) => void;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerCursorCodeUnitsChange: (selectionStart: number) => void;
  onInsertFileReferenceTrigger: () => void;
  onPickLocalFileFromPalette: () => void;
  onInsertSkillTriggerFromPalette: () => void;
  onRemoveLocalFileAttachment: (path: string) => void;
  onComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onComposerDrop: (event: ReactDragEvent<HTMLElement>) => void;
  models: DesktopSnapshot["config"]["models"];
  onOpenGitTab: () => void;
  onScrollOccludeMaskStyleChange?: (style: CSSProperties | undefined) => void;
};

export type BranchCheckoutSectionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchCheckoutBlockedByChanges: boolean;
  commitBusy: boolean;
  onCancel: () => void;
  onConfirmCheckout: () => void;
  onDiscardAndCheckout: () => void;
};

export type ConversationViewProps = {
  useTranslucency: boolean;
  isEmptySession: boolean;
  hideStaleConversationMessages: boolean;
  snapshot: DesktopSnapshot | null;
  subagentViewActive: boolean;
  onExitSubagentViewer: (() => void) | undefined;
  onNewSession: (() => void) | undefined;
  newSessionBusy: boolean;
  compactionDemoActive: boolean;
  onCompactionDemoStop: () => void;
  longConversationListDemoActive: boolean;
  onLongConversationListDemoStop: () => void;
  longConversationListDemoStats: {
    turnCount: number;
    messageCount: number;
    toolCount: number;
  } | null;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftClear: () => void;
  conversationScrollBedPaddingPx: number;
  /** translucency: viewport mask following the dock outline (the top rounded-corner gap is not clipped); ScrollArea stays full height */
  conversationScrollOccludeMaskStyle?: CSSProperties;
  list: ConversationListSectionProps;
  composerDock: ComposerDockSectionProps;
  branchCheckout?: BranchCheckoutSectionProps;
  showComposerDock?: boolean;
  showSessionSidebarToggle?: boolean;
  showWorkspaceToggle?: boolean;
  showSplitMenu?: boolean;
  showSideChat?: boolean;
  sessionTitleSuffix?: string | null;
  showClosePane?: boolean;
  onSideChat?: () => void;
  onSplit?: () => void;
  onSplitVertical?: () => void;
  onClosePane?: () => void;
  showDeleteSession?: boolean;
  deleteSessionPath?: string | null;
  deleteSessionDisplayName?: string | null;
  deleteSessionBusy?: boolean;
  conversationBusy?: boolean;
  onDeleteSession?: (path: string) => void | Promise<void>;
  onDeleteSessionOverlayClosed?: () => void | Promise<void>;
  showRenameSession?: boolean;
  renameSessionPath?: string | null;
  renameSessionDisplayName?: string | null;
  renameSessionBusy?: boolean;
  onRenameSession?: (path: string, displayName: string) => void | Promise<void>;
  paneId?: string;
  onPaneFocus?: () => void;
  onPaneDragStart?: (paneId: string) => void;
  onPaneDragEnter?: (
    paneId: string,
    zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
  ) => void;
  onPaneDragLeave?: () => void;
  onPaneDrop?: (paneId: string, zone: PaneDropZone) => void;
  onSidebarSessionDrop?: (
    paneId: string,
    zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
  ) => void;
  paneDropOverlayActive?: boolean;
  paneDragSourcePaneId?: string | null;
  sidebarSessionDragActive?: boolean;
};

export function ConversationView({
  useTranslucency,
  isEmptySession,
  hideStaleConversationMessages,
  snapshot,
  subagentViewActive,
  onExitSubagentViewer,
  onNewSession,
  newSessionBusy,
  compactionDemoActive,
  onCompactionDemoStop,
  longConversationListDemoActive,
  onLongConversationListDemoStop,
  longConversationListDemoStats,
  rewindDraft,
  onRewindDraftClear,
  conversationScrollBedPaddingPx,
  conversationScrollOccludeMaskStyle,
  list,
  composerDock,
  branchCheckout,
  showComposerDock = true,
  showSessionSidebarToggle = true,
  showWorkspaceToggle = true,
  showSplitMenu = false,
  showSideChat = false,
  sessionTitleSuffix,
  showClosePane = false,
  onSideChat,
  onSplit,
  onSplitVertical,
  onClosePane,
  showDeleteSession = false,
  deleteSessionPath,
  deleteSessionDisplayName,
  deleteSessionBusy = false,
  conversationBusy = false,
  onDeleteSession,
  onDeleteSessionOverlayClosed,
  showRenameSession = false,
  renameSessionPath,
  renameSessionDisplayName,
  renameSessionBusy = false,
  onRenameSession,
  paneId,
  onPaneFocus,
  onPaneDragStart,
  onPaneDragEnter,
  onPaneDragLeave,
  onPaneDrop,
  onSidebarSessionDrop,
  paneDropOverlayActive = false,
  paneDragSourcePaneId = null,
  sidebarSessionDragActive = false,
}: ConversationViewProps) {
  const { t } = useTranslation();
  const split = useConversationSplit();
  const conversationScrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const conversationScrollBodyRef = useRef<HTMLDivElement | null>(null);
  const getConversationScrollElement = useCallback(
    () => scrollAreaViewport(conversationScrollAreaRef.current),
    [],
  );
  const handleMessageQuoteAddToSideChat = useCallback(
    (attachment: MessageQuoteAttachment) => {
      if (!paneId) {
        return;
      }
      void split.addMessageQuoteToSideChat(paneId, attachment);
    },
    [paneId, split],
  );
  const quoteSessionPath = composerDock.paneSessionPath ?? snapshot?.activeSession?.filePath;
  const quoteOrigin =
    (paneId && split.isSideChatPane(paneId)) ||
    (quoteSessionPath ? isSideChatPaneProvisionalSessionPath(quoteSessionPath) : false)
      ? "side-chat"
      : "session";
  const conversationMessagesVisible =
    (!isEmptySession || subagentViewActive) && !hideStaleConversationMessages;
  // translucency: ScrollArea stays full height; the shape mask clips to the input/Changes/TODO
  // outline (the top rounded-corner gap is preserved).
  // In Rewind mode the mask is disabled: mask-image would make the viewport form a new stacking
  // context, so the rewind composer inside the viewport (z-40) could not escape to compete with
  // the fixed rewind overlay (z-30).
  const conversationScrollViewportStyle =
    useTranslucency && conversationMessagesVisible && !rewindDraft
      ? conversationScrollOccludeMaskStyle
      : undefined;
  const sessionTitleVisible = !isEmptySession && !hideStaleConversationMessages;
  const sessionTooltip =
    sessionTitleVisible && snapshot?.activeSession
      ? sessionGitTooltipItemFromChromeSession({
          path: snapshot.activeSession.filePath,
          gitBranch: snapshot.git?.branch,
          workspaceRoot: snapshot.workspaceRoot,
        })
      : null;

  const { listSettling } = useConversationSessionScrollTail({
    scrollAreaRef: conversationScrollAreaRef,
    contentKey: `${list.composerSessionKey || "__no-session__"}:${list.conversationListScopeKey}:e${list.conversationListRemountEpoch}`,
    enabled: conversationMessagesVisible,
    streaming: snapshot?.conversation.isBusy === true,
  });

  const { pinScrollToTail, followingTail, releaseTailFollow } = useConversationStreamScrollTail({
    scrollAreaRef: conversationScrollAreaRef,
    messages: list.messages,
    pendingAuxState: list.conversationPendingAuxState,
    isBusy: snapshot?.conversation.isBusy === true,
    scrollBedPaddingPx: conversationScrollBedPaddingPx,
    enabled: conversationMessagesVisible,
  });
  const [quoteScrollRequest, setQuoteScrollRequest] = useState<{
    messageId: number;
    behavior: ScrollBehavior;
    nonce: number;
  } | null>(null);
  const quoteSessionPathForScroll =
    composerDock.paneSessionPath ?? snapshot?.activeSession?.filePath ?? "";
  useEffect(() => {
    if (!paneId) {
      return;
    }
    split.registerQuoteScrollHandler(paneId, quoteSessionPathForScroll, setQuoteScrollRequest);
    return () => split.registerQuoteScrollHandler(paneId, quoteSessionPathForScroll, null);
  }, [paneId, quoteSessionPathForScroll, split]);

  const dropOverlayActive = Boolean(
    paneId && paneDropOverlayActive && (onPaneDrop || onSidebarSessionDrop),
  );
  const isDragSourcePane = Boolean(paneId && paneDragSourcePaneId === paneId);
  const showDropTargets = dropOverlayActive && !isDragSourcePane;
  const dropHostRef = useRef<HTMLDivElement | null>(null);

  const resolveVisibleDropZones = useCallback(() => {
    if (sidebarSessionDragActive) {
      return visiblePaneDropZonesForSidebarSessionDrag();
    }
    if (!paneId || !paneDragSourcePaneId) {
      return PANE_DROP_ZONE_ORDER;
    }
    const sourceHost = document.querySelector(`[data-pane-drop-host="${paneDragSourcePaneId}"]`);
    return visiblePaneDropZonesForDrag({
      paneCount: split.paneCount,
      sourcePaneHost: sourceHost instanceof HTMLElement ? sourceHost : null,
      targetPaneHost: dropHostRef.current,
    });
  }, [paneDragSourcePaneId, paneId, sidebarSessionDragActive, split.paneCount]);

  const updateDropTarget = useCallback(
    (zone: PaneDropZone) => {
      if (!paneId) {
        return;
      }
      const visible = resolveVisibleDropZones();
      if (!visible.includes(zone)) {
        return;
      }
      split.setPaneDropTarget({ paneId, zone });
    },
    [paneId, resolveVisibleDropZones, split],
  );

  const clearDropTargetIfLeavingHost = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!paneId || !showDropTargets) {
        return;
      }
      const related = event.relatedTarget;
      if (related instanceof Node && dropHostRef.current?.contains(related)) {
        return;
      }
      if (related instanceof Element) {
        const relatedHostEl = related.closest("[data-pane-drop-host]");
        const otherPaneId =
          relatedHostEl instanceof HTMLElement
            ? relatedHostEl.getAttribute("data-pane-drop-host")
            : null;
        const enteringValidTargetHost =
          otherPaneId && otherPaneId !== paneId && otherPaneId !== paneDragSourcePaneId;
        if (enteringValidTargetHost) {
          return;
        }
      }
      if (split.paneDropTarget?.paneId === paneId) {
        split.setPaneDropTarget(null);
      }
    },
    [paneDragSourcePaneId, paneId, showDropTargets, split],
  );

  return (
    <div
      data-spirit-surface="conversation-layout"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden min-w-0",
        desktopTranslucencyTintClass(useTranslucency),
      )}
    >
      <div
        ref={dropHostRef}
        data-spirit-surface="conversation-shell"
        {...(paneId ? { "data-pane-drop-host": paneId } : {})}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col min-w-0",
          desktopTranslucencyTintInnerClass(useTranslucency),
        )}
        onPointerDown={() => {
          onPaneFocus?.();
        }}
        onDragLeave={clearDropTargetIfLeavingHost}
      >
        <DesktopLayoutChromeBar
          useTranslucency={useTranslucency}
          showSessionSidebarToggle={showSessionSidebarToggle}
          showWorkspaceToggle={showWorkspaceToggle}
          showSplitMenu={showSplitMenu}
          showSideChat={showSideChat}
          showClosePane={showClosePane}
          onSideChat={onSideChat}
          onSplit={onSplit}
          onSplitVertical={onSplitVertical}
          onClosePane={onClosePane}
          paneId={paneId}
          onPaneDragStart={onPaneDragStart}
          onPaneDragEnter={onPaneDragEnter}
          onPaneDragLeave={onPaneDragLeave}
          onPaneDrop={onPaneDrop}
          sessionTitle={sessionTitleVisible ? snapshot?.activeSession?.displayName : null}
          sessionTitleSuffix={sessionTitleSuffix}
          sessionTooltip={sessionTooltip}
          subagentPromptText={subagentViewActive ? snapshot?.subagentViewer?.promptText : null}
          onExitSubagentViewer={onExitSubagentViewer}
          onNewSession={isEmptySession ? undefined : onNewSession}
          newSessionBusy={newSessionBusy}
          showDeleteSession={showDeleteSession}
          deleteSessionPath={deleteSessionPath}
          deleteSessionDisplayName={deleteSessionDisplayName}
          deleteSessionBusy={deleteSessionBusy}
          conversationBusy={conversationBusy}
          onDeleteSession={onDeleteSession}
          onDeleteSessionOverlayClosed={onDeleteSessionOverlayClosed}
          showRenameSession={showRenameSession}
          renameSessionPath={renameSessionPath}
          renameSessionDisplayName={renameSessionDisplayName}
          renameSessionBusy={renameSessionBusy}
          onRenameSession={onRenameSession}
        />
        {showDropTargets
          ? (() => {
              const visibleDropZones = resolveVisibleDropZones();
              return (
                <div
                  className={cn(
                    "absolute inset-0 z-30 grid cursor-crosshair",
                    paneDropZoneGridLayoutClass(visibleDropZones),
                  )}
                >
                  {visibleDropZones.map((zone) => (
                    <div
                      key={zone}
                      data-pane-drop-zone={zone}
                      className={cn(
                        "pointer-events-auto",
                        paneDropZoneGridCellClass(zone, visibleDropZones),
                      )}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        updateDropTarget(zone);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        updateDropTarget(zone);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!visibleDropZones.includes(zone)) {
                          return;
                        }
                        const repositionZone = effectiveRepositionZone(zone, visibleDropZones);
                        if (sidebarSessionDragActive && onSidebarSessionDrop) {
                          void onSidebarSessionDrop(paneId!, repositionZone);
                          return;
                        }
                        if (zone === "swap") {
                          onPaneDrop?.(paneId!, zone);
                          return;
                        }
                        onPaneDrop?.(paneId!, repositionZone);
                      }}
                    />
                  ))}
                </div>
              );
            })()
          : null}
        <div
          data-spirit-surface="conversation-drop-host"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div
            data-spirit-surface="conversation-stage"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col text-sm"
          >
            {compactionDemoActive || longConversationListDemoActive ? (
              <div
                data-spirit-surface={
                  longConversationListDemoActive
                    ? "long-list-demo-banner"
                    : "compaction-ui-demo-banner"
                }
                className={cn("shrink-0", desktopTranslucencyTintInnerClass(useTranslucency))}
              >
                <div
                  className={cn(
                    "mx-auto flex w-full flex-wrap items-center justify-between gap-2 py-2",
                    CONVERSATION_GUTTER_X,
                    CONVERSATION_MAX_W,
                  )}
                >
                  <p className="text-xs text-muted-foreground">
                    {longConversationListDemoActive ? (
                      <>
                        <span className="font-normal text-foreground">
                          {t("app.longConversationListDemo")}
                        </span>
                        <span className="hidden sm:inline">
                          {" "}
                          · {t("app.longConversationListDemoDescription")}
                          {longConversationListDemoStats
                            ? ` · ${t("app.longConversationListDemoStats", longConversationListDemoStats)}`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-normal text-foreground">
                          {t("app.compactionDemo")}
                        </span>
                        <span className="hidden sm:inline">
                          {" "}
                          · {t("app.compactionDemoDescription")}
                        </span>
                      </>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={
                      longConversationListDemoActive
                        ? onLongConversationListDemoStop
                        : onCompactionDemoStop
                    }
                  >
                    {t("app.exitDemo")}
                  </Button>
                </div>
              </div>
            ) : null}
            {rewindDraft ? (
              <button
                type="button"
                aria-label={t("app.cancelRewind")}
                className="fixed inset-0 z-30 cursor-default bg-background/35 backdrop-blur-sm"
                onClick={onRewindDraftClear}
              />
            ) : null}
            <ScrollArea
              ref={conversationScrollAreaRef}
              data-spirit-surface="conversation-scroll"
              className={cn("min-h-0 flex-1", desktopTranslucencyTintInnerClass(useTranslucency))}
              type="hover"
              scrollHideDelay={450}
              viewportStyle={conversationScrollViewportStyle}
            >
              {/* min-h-full: short content still fills the viewport; pb ≥ measured dock height + breathing room, grows in sync when the approval card pops up */}
              <div
                ref={conversationScrollBodyRef}
                data-spirit-surface="conversation-scroll-body"
                className={cn(
                  "min-h-full w-full",
                  desktopTranslucencyTintInnerClass(useTranslucency),
                )}
                style={{
                  ...((!isEmptySession || subagentViewActive) && !hideStaleConversationMessages
                    ? { paddingBottom: conversationScrollBedPaddingPx }
                    : undefined),
                  // Hide the list until bottom-anchoring settles, avoiding two visible shifts
                  // ("estimated-height anchoring → measured correction")
                  ...(listSettling ? { visibility: "hidden" as const } : undefined),
                }}
              >
                {(!isEmptySession || subagentViewActive) && !hideStaleConversationMessages ? (
                  <ConversationList
                    messages={list.messages}
                    conversationRenderItems={list.conversationRenderItems}
                    getScrollElement={getConversationScrollElement}
                    pinScrollToTail={pinScrollToTail}
                    releaseTailFollow={releaseTailFollow}
                    quoteScrollRequest={quoteScrollRequest}
                    onQuoteScrollHandled={() => setQuoteScrollRequest(null)}
                    subagentViewActive={subagentViewActive}
                    composerSessionKey={list.composerSessionKey}
                    conversationListScopeKey={list.conversationListScopeKey}
                    conversationListRemountEpoch={list.conversationListRemountEpoch}
                    conversationPendingAuxState={list.conversationPendingAuxState}
                    processGroupManualOpen={list.processGroupManualOpen}
                    processGroupManualOpenKey={list.processGroupManualOpenKey}
                    onProcessGroupManualOpenChange={list.onProcessGroupManualOpenChange}
                    shouldPlayProcessSealAnimation={list.shouldPlayProcessSealAnimation}
                    workspaceRoot={snapshot?.workspaceRoot ?? ""}
                    runtime={list.runtime}
                    turnContinue={list.turnContinue}
                    activeSessionReadOnly={list.activeSessionReadOnly}
                    conversationIsBusy={snapshot?.conversation.isBusy === true}
                    continueBusy={list.continueBusy}
                    rewindDraft={list.rewindDraft}
                    onRewindDraftChange={list.onRewindDraftChange}
                    messageRewindComposerEnabled={list.messageRewindComposerEnabled}
                    rewindRichInputRef={list.rewindRichInputRef}
                    models={list.models}
                    catalogHints={snapshot?.config.modelCatalogHints}
                    activeModel={snapshot?.config.activeModel ?? list.runtime.settings.activeModel}
                    agentMode={list.runtime.settings.agentMode}
                    onOpenSubagentViewer={list.onOpenSubagentViewer}
                    onOpenReadFile={list.onOpenReadFile}
                    onOpenPlan={list.onOpenPlan}
                    onStartMessageRewind={list.onStartMessageRewind}
                    onForkMessage={list.onForkMessage}
                    onSubmitMessageRewind={list.onSubmitMessageRewind}
                    onRewindRemoveLocalFileAttachment={list.onRewindRemoveLocalFileAttachment}
                    onRewindPickLocalFile={list.onRewindPickLocalFile}
                    onRewindPaste={list.onRewindPaste}
                    onRewindDragOver={list.onRewindDragOver}
                    onRewindDrop={list.onRewindDrop}
                    onComposerAgentModeChange={list.onComposerAgentModeChange}
                  />
                ) : null}
              </div>
            </ScrollArea>

            <ConversationMessageSelectionMenu
              rootRef={conversationScrollBodyRef}
              quoteSessionPath={quoteSessionPath}
              quoteOrigin={quoteOrigin}
              onMessageQuoteAddToSession={composerDock.onMessageQuoteAddToSession}
              onMessageQuoteAddToSideChat={
                showSideChat && paneId ? handleMessageQuoteAddToSideChat : undefined
              }
            />
            {showComposerDock ? (
              <ComposerDock
                ref={composerDock.composerDockRef}
                isEmptySession={isEmptySession}
                doodleText={composerDock.doodleText}
                showWorkspaceBindingControls={composerDock.showWorkspaceBindingControls}
                paneSessionPath={composerDock.paneSessionPath}
                useIsolatedPaneWorkspace={composerDock.useIsolatedPaneWorkspace}
                composerSegments={composerDock.composerSegments}
                onComposerSegmentsChange={composerDock.onComposerSegmentsChange}
                composerLocalFileAttachments={composerDock.composerLocalFileAttachments}
                onComposerLocalFileAttachmentsChange={
                  composerDock.onComposerLocalFileAttachmentsChange
                }
                snapshot={snapshot}
                runtime={list.runtime}
                commitBusy={composerDock.commitBusy}
                activeSessionReadOnly={list.activeSessionReadOnly}
                rewindWarnings={composerDock.rewindWarnings}
                showPendingApprovalInComposer={composerDock.showPendingApprovalInComposer}
                pendingApproval={composerDock.pendingApproval}
                showPendingQuestionsInComposer={composerDock.showPendingQuestionsInComposer}
                pendingQuestions={composerDock.pendingQuestions}
                questionDrafts={composerDock.questionDrafts}
                onUpdateQuestionDraft={composerDock.onUpdateQuestionDraft}
                onSubmitQuestions={composerDock.onSubmitQuestions}
                onSkipQuestions={composerDock.onSkipQuestions}
                fileReferenceSelectedIndex={composerDock.fileReferenceSelectedIndex}
                onFileReferenceSelectedIndexChange={composerDock.onFileReferenceSelectedIndexChange}
                fileReferenceMenuView={composerDock.fileReferenceMenuView}
                atReferenceMenuItems={composerDock.atReferenceMenuItems}
                onApplyFileReferenceSuggestion={composerDock.onApplyFileReferenceSuggestion}
                onApplySessionReferenceSuggestion={composerDock.onApplySessionReferenceSuggestion}
                onOpenAtReferenceSessions={composerDock.onOpenAtReferenceSessions}
                onBackAtReferenceMenu={composerDock.onBackAtReferenceMenu}
                onDismissFileReferenceSuggestions={composerDock.onDismissFileReferenceSuggestions}
                activeFileReferenceQuery={composerDock.activeFileReferenceQuery}
                slashQuery={composerDock.slashQuery}
                slashSuggestions={composerDock.slashSuggestions}
                slashSelectedIndex={composerDock.slashSelectedIndex}
                onSlashSelectedIndexChange={composerDock.onSlashSelectedIndexChange}
                onApplySlashSuggestionItem={composerDock.onApplySlashSuggestionItem}
                onDismissSlashSuggestions={composerDock.onDismissSlashSuggestions}
                composerCursorCodeUnits={composerDock.composerCursorCodeUnits}
                composerPlaceholder={composerDock.composerPlaceholder}
                composerAgentModeChipPlaceholder={composerDock.composerAgentModeChipPlaceholder}
                composerCanSend={composerDock.composerCanSend}
                composerHasPayload={composerDock.composerHasPayload}
                composerBusy={composerDock.composerBusy}
                conversationInterruptible={composerDock.conversationInterruptible}
                continueBusy={list.continueBusy}
                composerBrowserElementAttachments={composerDock.composerBrowserElementAttachments}
                onComposerBrowserElementAttachmentsChange={
                  composerDock.onComposerBrowserElementAttachmentsChange
                }
                onSubmitComposerMessage={composerDock.onSubmitComposerMessage}
                onComposerAgentModeChange={composerDock.onComposerAgentModeChange}
                composerRichInputRef={composerDock.composerRichInputRef}
                onComposerKeyDown={composerDock.onComposerKeyDown}
                onComposerCursorCodeUnitsChange={composerDock.onComposerCursorCodeUnitsChange}
                onInsertFileReferenceTrigger={composerDock.onInsertFileReferenceTrigger}
                onPickLocalFileFromPalette={composerDock.onPickLocalFileFromPalette}
                onInsertSkillTriggerFromPalette={composerDock.onInsertSkillTriggerFromPalette}
                onRemoveLocalFileAttachment={composerDock.onRemoveLocalFileAttachment}
                onComposerPaste={composerDock.onComposerPaste}
                onComposerDragOver={composerDock.onComposerDragOver}
                onComposerDrop={composerDock.onComposerDrop}
                models={composerDock.models}
                useTranslucency={useTranslucency}
                onOpenGitTab={composerDock.onOpenGitTab}
                showScrollToBottom={!isEmptySession && !followingTail}
                onScrollToBottom={() => pinScrollToTail(true, "smooth")}
                getScrollViewport={getConversationScrollElement}
                onScrollOccludeMaskStyleChange={composerDock.onScrollOccludeMaskStyleChange}
              />
            ) : null}
            {showComposerDock && branchCheckout ? (
              <BranchCheckoutDialog
                open={branchCheckout.open}
                onOpenChange={branchCheckout.onOpenChange}
                branchCheckoutBlockedByChanges={branchCheckout.branchCheckoutBlockedByChanges}
                git={snapshot?.git}
                commitBusy={branchCheckout.commitBusy}
                onCancel={branchCheckout.onCancel}
                onConfirmCheckout={branchCheckout.onConfirmCheckout}
                onDiscardAndCheckout={branchCheckout.onDiscardAndCheckout}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
