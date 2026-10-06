import { useCallback, useMemo, useEffect } from "react";
import type { TFunction } from "i18next";

import type {
  ComposerDockSectionProps,
  ConversationListSectionProps,
} from "@/components/conversation/conversation-view";
import { useComposerController } from "@/hooks/useComposerController";
import { useConversationViewState } from "@/hooks/useConversationViewState";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useMessageRewind } from "@/hooks/useMessageRewind";
import type { useSubagentViewer } from "@/hooks/useSubagentViewer";
import type { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import type { useLongConversationListDemo } from "@/hooks/useLongConversationListDemo";
import type { useApprovalPreviewDemo } from "@/hooks/useApprovalPreviewDemo";
import type { useWorkspaceToolsController } from "@/hooks/useWorkspaceToolsController";
import { resolveEffectiveEmptySession } from "@/lib/conversation-empty-session";
import {
  resolvePaneContentStatus,
  type PaneContentStatus,
} from "@/lib/conversation-navigation-pending";
import { resolvePaneDesktopSnapshot } from "@/lib/pane-desktop-snapshot";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import type { ConversationAbortShortcutTargetRef } from "@/lib/conversation-abort-shortcut";
import type { ConversationMessageSnapshot, DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;
type SubagentViewer = ReturnType<typeof useSubagentViewer>;
type CompactionDemo = ReturnType<typeof useCompactionUiDemo>;
type LongConversationListDemo = ReturnType<typeof useLongConversationListDemo>;
type ApprovalPreviewDemo = ReturnType<typeof useApprovalPreviewDemo>;
type WorkspaceTools = ReturnType<typeof useWorkspaceToolsController>;

export type UseConversationPaneControllerOptions = {
  runtime: DesktopRuntime;
  baseSnapshot: DesktopSnapshot | null;
  sessionPath: string;
  isFocused: boolean;
  isAnchorPane: boolean;
  useIsolatedPane: boolean;
  subagentViewActive: boolean;
  subagentViewer: SubagentViewer;
  compactionDemo: CompactionDemo;
  longConversationListDemo: LongConversationListDemo;
  approvalPreviewDemo: ApprovalPreviewDemo;
  newChatBusy: boolean;
  splitPaneCount: number;
  onNewChat?: () => void;
  onBeginSideChat?: () => void;
  workspaceTools: WorkspaceTools;
  onOpenIntegrationsSettings: () => void;
  t: TFunction;
  language: string;
  conversationAbortShortcutTargetRef?: ConversationAbortShortcutTargetRef;
};

export function useConversationPaneController({
  runtime,
  baseSnapshot,
  sessionPath,
  isFocused,
  isAnchorPane,
  useIsolatedPane,
  subagentViewActive,
  subagentViewer,
  compactionDemo,
  longConversationListDemo,
  approvalPreviewDemo,
  newChatBusy,
  splitPaneCount,
  onNewChat,
  onBeginSideChat,
  workspaceTools,
  onOpenIntegrationsSettings: _onOpenIntegrationsSettings,
  t,
  language,
  conversationAbortShortcutTargetRef,
}: UseConversationPaneControllerOptions) {
  const paneSnapshot = useMemo(
    () => resolvePaneDesktopSnapshot(baseSnapshot, sessionPath),
    [baseSnapshot, sessionPath],
  );

  const paneSubagentViewActive = isFocused && subagentViewActive;
  const paneCompactionDemoActive = isFocused && compactionDemo.active;
  const paneLongConversationListDemoActive = isFocused && longConversationListDemo.active;
  const paneApprovalPreviewDemoActive = isFocused && approvalPreviewDemo.active;

  const paneContentStatus: PaneContentStatus = resolvePaneContentStatus({
    paneSessionPath: sessionPath,
    snapshot: baseSnapshot,
  });
  const paneContentPending = paneContentStatus === "pending-placeholder";

  const paneIsEmptySession = useMemo(() => {
    // While the pane's data is still in flight, "empty" is unknown — never show
    // the empty-session hero as a transitional state.
    if (paneContentPending) {
      return false;
    }
    return resolveEffectiveEmptySession({
      sessionMessageCount: paneSnapshot?.conversation.messages.length ?? 0,
      subagentViewActive: paneSubagentViewActive,
      compactionDemoActive: paneCompactionDemoActive,
      longConversationListDemoActive: paneLongConversationListDemoActive,
      approvalPreviewDemoActive: paneApprovalPreviewDemoActive,
      newChatBusy: isFocused && splitPaneCount <= 1 ? newChatBusy : false,
    });
  }, [
    isFocused,
    newChatBusy,
    paneApprovalPreviewDemoActive,
    paneCompactionDemoActive,
    paneContentPending,
    paneLongConversationListDemoActive,
    paneSnapshot?.conversation.messages.length,
    paneSubagentViewActive,
    splitPaneCount,
  ]);

  const paneShowWorkspaceBindingControls = (useIsolatedPane || isAnchorPane) && paneIsEmptySession;

  const conversation = useConversationViewState({
    runtime,
    snapshot: paneSnapshot,
    subagentViewActive: paneSubagentViewActive,
    subagentViewer,
    compactionDemo: {
      ...compactionDemo,
      active: paneCompactionDemoActive,
    },
    longConversationListDemo: {
      ...longConversationListDemo,
      active: paneLongConversationListDemoActive,
    },
    approvalPreviewDemo: {
      ...approvalPreviewDemo,
      active: paneApprovalPreviewDemoActive,
    },
    t,
    language,
    useIsolatedPane,
    conversationAbortShortcutTargetRef,
  });

  useEffect(() => {
    const ref = conversationAbortShortcutTargetRef;
    if (!ref || !isFocused || splitPaneCount <= 1) {
      return;
    }
    ref.current = {
      eligible: conversation.conversationInterruptible && !conversation.activeSessionReadOnly,
      sessionPath: useIsolatedPane ? sessionPath : undefined,
    };
    return () => {
      if (ref.current.sessionPath === sessionPath || !useIsolatedPane) {
        ref.current = { eligible: false };
      }
    };
  }, [
    conversation.activeSessionReadOnly,
    conversation.conversationInterruptible,
    conversationAbortShortcutTargetRef,
    isFocused,
    sessionPath,
    splitPaneCount,
    useIsolatedPane,
  ]);

  const composer = useComposerController({
    runtime,
    snapshot: paneSnapshot,
    t,
    isEmptySession: paneIsEmptySession,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
    compactionDemoActive: paneCompactionDemoActive,
    longConversationListDemoActive: paneLongConversationListDemoActive,
    approvalPreviewDemoActive: paneApprovalPreviewDemoActive,
    subagentViewActive: paneSubagentViewActive,
    pendingApproval: conversation.pendingApproval,
    pendingQuestions: conversation.pendingQuestions,
    conversationInterruptible: conversation.conversationInterruptible,
    handleNewChat: onNewChat ?? (() => {}),
    setActiveSurface: () => {},
    setLastNonSettingsSurface: () => {},
    paneSessionPath: useIsolatedPane ? sessionPath : undefined,
    onBeginSideChat,
  });

  const messageRewind = useMessageRewind({
    runtime,
    messages: conversation.messages,
    subagentViewer,
    messageRewindComposerEnabled: composer.messageRewindComposerEnabled,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
  });

  // Callbacks passed into MessageCard (memoized row) must be reference-stable; no inline closures rebuilt every render
  const { setProcessGroupManualOpen, processGroupManualOpenKey } = conversation;
  const onProcessGroupManualOpenChange = useCallback(
    (groupId: string, open: boolean) => {
      setProcessGroupManualOpen((current) => ({
        ...current,
        [processGroupManualOpenKey(groupId)]: open,
      }));
    },
    [processGroupManualOpenKey, setProcessGroupManualOpen],
  );
  const { openEditorFile, openWorkspacePlan } = workspaceTools;
  const onOpenReadFile = useCallback(
    (target: EditorFileTarget) => {
      openEditorFile(target);
    },
    [openEditorFile],
  );
  const onOpenPlan = useCallback(() => {
    openWorkspacePlan();
  }, [openWorkspacePlan]);
  const { forkSession } = runtime;
  const onForkMessage = useCallback(
    (message: ConversationMessageSnapshot, listIndex: number) => {
      void forkSession({ messageId: message.id, listIndex });
    },
    [forkSession],
  );

  const list: ConversationListSectionProps = {
    messages: conversation.messages,
    conversationRenderItems: conversation.conversationRenderItems,
    composerSessionKey: conversation.composerSessionKey,
    conversationListScopeKey: conversation.conversationListScopeKey,
    conversationListRemountEpoch: conversation.conversationListRemountEpoch,
    conversationPendingAuxState: conversation.conversationPendingAuxState,
    processGroupManualOpen: conversation.processGroupManualOpen,
    processGroupManualOpenKey: conversation.processGroupManualOpenKey,
    onProcessGroupManualOpenChange,
    shouldPlayProcessSealAnimation: conversation.shouldPlayProcessSealAnimation,
    runtime,
    turnContinue: conversation.turnContinue,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
    continueBusy: conversation.continueBusy,
    rewindDraft: messageRewind.rewindDraft,
    onRewindDraftChange: messageRewind.setRewindDraft,
    messageRewindComposerEnabled: composer.messageRewindComposerEnabled,
    rewindRichInputRef: messageRewind.rewindRichInputRef,
    models: conversation.models,
    onOpenSubagentViewer: paneSubagentViewActive
      ? undefined
      : conversation.handleOpenSubagentViewer,
    onOpenReadFile,
    onOpenPlan,
    onStartMessageRewind: messageRewind.startMessageRewind,
    onForkMessage,
    onSubmitMessageRewind: messageRewind.submitMessageRewind,
    onRewindRemoveLocalFileAttachment: messageRewind.removeRewindLocalFileAttachment,
    onRewindPickLocalFile: messageRewind.pickRewindLocalFileFromPalette,
    onRewindPaste: messageRewind.handleRewindComposerPaste,
    onRewindDragOver: messageRewind.handleRewindComposerDragOver,
    onRewindDrop: messageRewind.handleRewindComposerDrop,
    onComposerAgentModeChange: composer.handleComposerAgentModeChange,
  };

  const composerDock: ComposerDockSectionProps = {
    composerDockRef: conversation.composerDockRef,
    doodleText: conversation.doodleText,
    showWorkspaceBindingControls: paneShowWorkspaceBindingControls,
    paneSessionPath: useIsolatedPane ? sessionPath : undefined,
    useIsolatedPaneWorkspace: useIsolatedPane,
    composerSegments: composer.composerSegments,
    onComposerSegmentsChange: composer.setComposerSegments,
    composerLocalFileAttachments: composer.composerLocalFileAttachments,
    onComposerLocalFileAttachmentsChange: composer.setComposerLocalFileAttachments,
    commitBusy: composer.commitBusy,
    rewindWarnings: conversation.rewindWarnings,
    showPendingApprovalInComposer: conversation.showPendingApprovalInComposer,
    pendingApproval: conversation.pendingApproval,
    showPendingQuestionsInComposer: conversation.showPendingQuestionsInComposer,
    pendingQuestions: conversation.pendingQuestions ?? undefined,
    ...(composer.paneQuestionControls
      ? {
          questionDrafts: composer.paneQuestionControls.questionDrafts,
          onUpdateQuestionDraft: composer.paneQuestionControls.onUpdateQuestionDraft,
          onSubmitQuestions: composer.paneQuestionControls.onSubmitQuestions,
          onSkipQuestions: composer.paneQuestionControls.onSkipQuestions,
        }
      : {}),
    fileReferenceSelectedIndex: composer.fileReferenceSelectedIndex,
    onFileReferenceSelectedIndexChange: composer.setFileReferenceSelectedIndex,
    fileReferenceMenuView: composer.fileReferenceMenuView,
    atReferenceMenuItems: composer.atReferenceMenuItems,
    onApplyFileReferenceSuggestion: composer.applyFileReferenceSuggestion,
    onApplySessionReferenceSuggestion: composer.applySessionReferenceSuggestion,
    onOpenAtReferenceSessions: composer.openAtReferenceSessions,
    onBackAtReferenceMenu: composer.backAtReferenceMenu,
    onDismissFileReferenceSuggestions: composer.dismissFileReferenceSuggestions,
    activeFileReferenceQuery: composer.activeFileReferenceQuery,
    slashQuery: composer.slashQuery,
    slashSuggestions: composer.slashSuggestions,
    slashSelectedIndex: composer.slashSelectedIndex,
    onSlashSelectedIndexChange: composer.setSlashSelectedIndex,
    onApplySlashSuggestionItem: composer.applySlashSuggestionItem,
    onDismissSlashSuggestions: composer.dismissSlashSuggestions,
    composerCursorCodeUnits: composer.composerCursorCodeUnits,
    composerPlaceholder: composer.composerPlaceholder,
    composerAgentModeChipPlaceholder: composer.composerAgentModeChipPlaceholder,
    composerCanSend: composer.composerCanSend,
    composerHasPayload: composer.composerHasPayload,
    composerBusy: composer.composerBusy,
    conversationInterruptible: conversation.conversationInterruptible,
    composerBrowserElementAttachments: composer.composerBrowserElementAttachments,
    onComposerBrowserElementAttachmentsChange: composer.setComposerBrowserElementAttachments,
    onSubmitComposerMessage: composer.submitComposerMessage,
    onComposerAgentModeChange: composer.handleComposerAgentModeChange,
    composerRichInputRef: composer.composerRichInputRef,
    onMessageQuoteAddToChat: composer.handleMessageQuoteAddToChat,
    onComposerKeyDown: composer.handleComposerKeyDown,
    onComposerCursorCodeUnitsChange: composer.setComposerCursorCodeUnits,
    onInsertFileReferenceTrigger: composer.insertFileReferenceTrigger,
    onPickLocalFileFromPalette: composer.pickLocalFileFromPalette,
    onInsertSkillTriggerFromPalette: composer.insertSkillTriggerFromPalette,
    onRemoveLocalFileAttachment: composer.removeLocalFileAttachment,
    onComposerPaste: composer.handleComposerPaste,
    onComposerDragOver: composer.handleComposerDragOver,
    onComposerDrop: composer.handleComposerDrop,
    models: conversation.models,
    onOpenGitTab: workspaceTools.openGitTab,
    onScrollOccludeMaskStyleChange: conversation.onConversationScrollOccludeMaskStyleChange,
  };

  const composerInsertHandlers = useMemo(
    () => ({
      handleBrowserElementPicked: composer.handleBrowserElementPicked,
      handlePrDiffAddToChat: composer.handlePrDiffAddToChat,
      handleGitCommitAddToChat: composer.handleGitCommitAddToChat,
      handleTerminalAddToChat: composer.handleTerminalAddToChat,
      handleFileSnippetAddToChat: composer.handleFileSnippetAddToChat,
      handleWorkspaceFileAddToChat: composer.handleWorkspaceFileAddToChat,
      handleMessageQuoteAddToChat: composer.handleMessageQuoteAddToChat,
    }),
    [
      composer.handleBrowserElementPicked,
      composer.handleFileSnippetAddToChat,
      composer.handleGitCommitAddToChat,
      composer.handleMessageQuoteAddToChat,
      composer.handlePrDiffAddToChat,
      composer.handleTerminalAddToChat,
      composer.handleWorkspaceFileAddToChat,
    ],
  );

  const composerControls = useMemo(
    () => ({
      focusComposer: composer.focusComposer,
      setComposerText: composer.setComposerText,
      setSlashSelectedIndex: composer.setSlashSelectedIndex,
      prefillSkillChip: composer.prefillSkillChip,
    }),
    [
      composer.focusComposer,
      composer.prefillSkillChip,
      composer.setComposerText,
      composer.setSlashSelectedIndex,
    ],
  );

  return {
    paneSnapshot,
    paneIsEmptySession,
    paneContentStatus,
    list,
    composerDock,
    branchCheckout: {
      open: composer.branchCheckoutDialogOpen,
      onOpenChange: composer.handleBranchCheckoutDialogOpenChange,
      branchCheckoutBlockedByChanges: composer.branchCheckoutBlockedByChanges,
      commitBusy: composer.commitBusy,
      onCancel: composer.cancelBranchCheckoutDialog,
      onConfirmCheckout: composer.confirmBranchCheckoutAndSend,
      onDiscardAndCheckout: composer.discardBranchChangesAndCheckoutSend,
    },
    conversationScrollBedPaddingPx: conversation.conversationScrollBedPaddingPx,
    conversationScrollOccludeMaskStyle: conversation.conversationScrollOccludeMaskStyle,
    rewindDraft: messageRewind.rewindDraft,
    onRewindDraftClear: () => messageRewind.setRewindDraft(null),
    onExitSubagentViewer: paneSubagentViewActive
      ? () => {
          void subagentViewer.close();
        }
      : undefined,
    subagentViewActive: paneSubagentViewActive,
    compactionDemoActive: paneCompactionDemoActive,
    longConversationListDemoActive: paneLongConversationListDemoActive,
    approvalPreviewDemoActive: paneApprovalPreviewDemoActive,
    approvalPreviewDemoApprovals: approvalPreviewDemo.approvals,
    onPaneKeyDown: composer.handlePaneKeyDown,
    composerInsertHandlers,
    composerControls,
  };
}
