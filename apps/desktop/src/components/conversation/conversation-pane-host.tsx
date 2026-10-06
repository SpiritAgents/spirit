import { useCallback, useEffect } from "react";

import { ConversationView } from "@/components/conversation/conversation-view";
import { ComposerChipNavigateProvider } from "@/contexts/composer-chip-navigate-context";
import { useConversationSplit } from "@/contexts/conversation-split-context";
import {
  isSideChatPaneProvisionalSessionPath,
  normalizeSessionPathKey,
} from "@/lib/session-path-kind";
import { canBeginSideChat } from "@/lib/fork-eligibility";
import { findLastForkableAssistantMessageId } from "@/lib/fork-session-utils";
import { useConversationPaneController } from "@/hooks/useConversationPaneController";
import type { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import type { useLongConversationListDemo } from "@/hooks/useLongConversationListDemo";
import type { useApprovalPreviewDemo } from "@/hooks/useApprovalPreviewDemo";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import type { useSubagentViewer } from "@/hooks/useSubagentViewer";
import type { useWorkspaceToolsController } from "@/hooks/useWorkspaceToolsController";
import type { PaneDropZone } from "@/lib/conversation-split-layout";
import type { DesktopSnapshot } from "@/types";
import type { TFunction } from "i18next";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;
type SubagentViewer = ReturnType<typeof useSubagentViewer>;
type CompactionDemo = ReturnType<typeof useCompactionUiDemo>;
type LongConversationListDemo = ReturnType<typeof useLongConversationListDemo>;
type ApprovalPreviewDemo = ReturnType<typeof useApprovalPreviewDemo>;
type WorkspaceTools = ReturnType<typeof useWorkspaceToolsController>;

export type ConversationPaneHostProps = {
  runtime: DesktopRuntime;
  baseSnapshot: DesktopSnapshot | null;
  sessionPath: string;
  paneId: string;
  isFocused: boolean;
  isAnchorPane: boolean;
  isSessionSidebarAnchorPane: boolean;
  useIsolatedPane: boolean;
  splitPaneCount: number;
  onFocusPane: () => void;
  onSideChat: () => void;
  onSplit: () => void;
  onSplitVertical: () => void;
  onClosePane: () => void;
  showClosePane: boolean;
  useTranslucency: boolean;
  subagentViewActive: boolean;
  subagentViewer: SubagentViewer;
  compactionDemo: CompactionDemo;
  longConversationListDemo: LongConversationListDemo;
  approvalPreviewDemo: ApprovalPreviewDemo;
  newChatBusy: boolean;
  onNewChat?: () => void;
  deleteSessionBusy?: boolean;
  onDeleteSession?: (path: string) => void | Promise<void>;
  renameSessionBusy?: boolean;
  onRenameSession?: (path: string, displayName: string) => void | Promise<void>;
  onTogglePinSession?: (path: string, pinned: boolean) => void | Promise<void>;
  workspaceTools: WorkspaceTools;
  onOpenIntegrationsSettings: () => void;
  onCompactionDemoStop: () => void;
  onLongConversationListDemoStop: () => void;
  onApprovalPreviewDemoStop: () => void;
  paneReorderEnabled: boolean;
  onPaneDragStart?: (paneId: string) => void;
  onPaneDragLeave?: () => void;
  onPaneDrop?: (targetPaneId: string, zone: PaneDropZone) => void;
  onSidebarSessionDrop?: (
    targetPaneId: string,
    zone: import("@/lib/conversation-split-layout").PaneRepositionZone,
  ) => void;
  paneDropOverlayActive: boolean;
  paneDragSourcePaneId: string | null;
  sidebarSessionDragActive: boolean;
  t: TFunction;
  language: string;
};

function isSideChatPaneSessionPath(sessionPath: string): boolean {
  return isSideChatPaneProvisionalSessionPath(sessionPath);
}

export function ConversationPaneHost({
  sessionPath,
  paneId,
  isFocused,
  isAnchorPane,
  isSessionSidebarAnchorPane,
  useIsolatedPane,
  splitPaneCount,
  onFocusPane,
  onSideChat,
  onSplit,
  onSplitVertical,
  onClosePane,
  showClosePane,
  useTranslucency,
  paneReorderEnabled,
  onPaneDragStart,
  onPaneDragLeave,
  onPaneDrop,
  onSidebarSessionDrop,
  paneDropOverlayActive,
  paneDragSourcePaneId,
  sidebarSessionDragActive,
  ...controllerInput
}: ConversationPaneHostProps) {
  const split = useConversationSplit();
  const pane = useConversationPaneController({
    ...controllerInput,
    onBeginSideChat: onSideChat,
    sessionPath,
    isFocused,
    isAnchorPane,
    useIsolatedPane,
    splitPaneCount,
    conversationAbortShortcutTargetRef: split.conversationAbortShortcutTargetRef ?? undefined,
  });

  const registerPaneComposerInsert = split.registerPaneComposerInsert;
  const registerPaneComposerControls = split.registerPaneComposerControls;

  // Register this Pane's composer capabilities by paneId unconditionally; readers pick by focusedPaneId,
  // non-focused Panes never write, so sibling effect execution order no longer affects the result
  useEffect(() => {
    registerPaneComposerInsert(paneId, pane.composerInsertHandlers);
    return () => {
      registerPaneComposerInsert(paneId, null);
    };
  }, [paneId, pane.composerInsertHandlers, registerPaneComposerInsert]);

  useEffect(() => {
    registerPaneComposerControls(paneId, pane.composerControls);
    return () => {
      registerPaneComposerControls(paneId, null);
    };
  }, [paneId, pane.composerControls, registerPaneComposerControls]);
  const handleDeleteSession = useCallback(
    async (path: string) => {
      if (splitPaneCount > 1) {
        if (controllerInput.runtime.apiReady) {
          await controllerInput.runtime.deleteSession(path);
        }
        return;
      }
      if (controllerInput.onDeleteSession) {
        await controllerInput.onDeleteSession(path);
      }
    },
    [controllerInput.onDeleteSession, controllerInput.runtime, splitPaneCount],
  );
  const handleDeleteSessionOverlayClosed = useCallback(() => {
    if (splitPaneCount > 1) {
      void split.collapsePaneLayoutById(paneId);
    }
  }, [paneId, split, splitPaneCount]);

  const handleRenameSession = useCallback(
    async (path: string, displayName: string) => {
      if (controllerInput.onRenameSession) {
        await controllerInput.onRenameSession(path, displayName);
      }
    },
    [controllerInput.onRenameSession],
  );

  const handleTogglePinSession = useCallback(
    async (path: string, pinned: boolean) => {
      if (controllerInput.onTogglePinSession) {
        await controllerInput.onTogglePinSession(path, pinned);
      }
    },
    [controllerInput.onTogglePinSession],
  );

  const paneSessionPathKey = normalizeSessionPathKey(sessionPath);
  const sessionPinned = controllerInput.runtime.sessions.some(
    (session) =>
      normalizeSessionPathKey(session.path) === paneSessionPathKey &&
      typeof session.pinnedAtUnixMs === "number",
  );

  const showSideChat =
    !pane.paneIsEmptySession &&
    Boolean(findLastForkableAssistantMessageId(pane.paneSnapshot?.conversation.messages ?? [])) &&
    canBeginSideChat({
      conversationBusy: pane.paneSnapshot?.conversation.isBusy === true,
      activeSessionReadOnly: pane.paneSnapshot?.activeSession?.readOnly === true,
      forkBusy: controllerInput.runtime.busyAction === "fork",
      sideChatBusy: controllerInput.runtime.busyAction === "side-chat",
      hasForkableAssistantMessage: true,
    });
  const isSideChatPane = isSideChatPaneSessionPath(sessionPath);

  return (
    <ComposerChipNavigateProvider
      runtime={controllerInput.runtime}
      snapshot={pane.paneSnapshot}
      baseSnapshot={controllerInput.baseSnapshot}
      workspaceTools={controllerInput.workspaceTools}
      paneId={paneId}
      paneSessionPath={sessionPath}
    >
      <ConversationView
        useTranslucency={useTranslucency}
        snapshot={pane.paneSnapshot}
        isEmptySession={pane.paneIsEmptySession}
        paneContentStatus={pane.paneContentStatus}
        showComposerDock
        showSessionSidebarToggle={splitPaneCount <= 1 || isSessionSidebarAnchorPane}
        showWorkspaceToggle={isAnchorPane}
        showSplitMenu
        showSideChat={showSideChat}
        sessionTitleSuffix={isSideChatPane ? controllerInput.t("app.sideChat") : null}
        showClosePane={showClosePane}
        onSideChat={onSideChat}
        onSplit={onSplit}
        onSplitVertical={onSplitVertical}
        onClosePane={onClosePane}
        paneId={paneId}
        onPaneFocus={onFocusPane}
        onPaneDragStart={paneReorderEnabled ? onPaneDragStart : undefined}
        onPaneDragLeave={paneReorderEnabled ? onPaneDragLeave : undefined}
        onPaneDrop={paneReorderEnabled ? onPaneDrop : undefined}
        onSidebarSessionDrop={onSidebarSessionDrop}
        paneDropOverlayActive={paneDropOverlayActive}
        paneDragSourcePaneId={paneDragSourcePaneId}
        sidebarSessionDragActive={sidebarSessionDragActive}
        subagentViewActive={pane.subagentViewActive}
        onExitSubagentViewer={pane.onExitSubagentViewer}
        onNewChat={controllerInput.onNewChat}
        newChatBusy={controllerInput.newChatBusy}
        showDeleteSession={!pane.paneIsEmptySession && Boolean(controllerInput.onDeleteSession)}
        deleteSessionPath={sessionPath}
        deleteSessionDisplayName={pane.paneSnapshot?.activeSession?.displayName ?? null}
        deleteSessionBusy={controllerInput.deleteSessionBusy}
        conversationBusy={pane.paneSnapshot?.conversation.isBusy === true}
        onDeleteSession={handleDeleteSession}
        onDeleteSessionOverlayClosed={handleDeleteSessionOverlayClosed}
        showRenameSession={
          !isSideChatPane && !pane.paneIsEmptySession && Boolean(controllerInput.onRenameSession)
        }
        renameSessionPath={sessionPath}
        renameSessionDisplayName={pane.paneSnapshot?.activeSession?.displayName ?? null}
        renameSessionBusy={controllerInput.renameSessionBusy}
        onRenameSession={handleRenameSession}
        sessionPinned={sessionPinned}
        onTogglePinSession={controllerInput.onTogglePinSession ? handleTogglePinSession : undefined}
        compactionDemoActive={pane.compactionDemoActive}
        onCompactionDemoStop={controllerInput.onCompactionDemoStop}
        longConversationListDemoActive={pane.longConversationListDemoActive}
        onLongConversationListDemoStop={controllerInput.onLongConversationListDemoStop}
        longConversationListDemoStats={controllerInput.longConversationListDemo.stats}
        approvalPreviewDemoActive={pane.approvalPreviewDemoActive}
        onApprovalPreviewDemoStop={controllerInput.onApprovalPreviewDemoStop}
        approvalPreviewDemoApprovals={pane.approvalPreviewDemoApprovals}
        onPaneKeyDown={pane.onPaneKeyDown}
        rewindDraft={pane.rewindDraft}
        onRewindDraftClear={pane.onRewindDraftClear}
        conversationScrollBedPaddingPx={pane.conversationScrollBedPaddingPx}
        conversationScrollOccludeMaskStyle={pane.conversationScrollOccludeMaskStyle}
        list={pane.list}
        composerDock={pane.composerDock}
        branchCheckout={pane.branchCheckout}
      />
    </ComposerChipNavigateProvider>
  );
}
