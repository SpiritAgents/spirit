import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import { BranchSelectMenu } from "@/components/branch-select-menu";
import { ComposerSurface } from "@/components/composer/composer-surface";
import { Doodle } from "@/components/conversation/doodle";
import { ComposerChangesCard } from "@/components/composer-changes-card";
import { ComposerContextUsageRing } from "@/components/composer-context-usage-ring";
import { ComposerScrollToBottomButton } from "@/components/composer-scroll-to-bottom-button";
import { ComposerSuggestionDropdown } from "@/components/composer-suggestion-dropdown";
import { ComposerTodoCard } from "@/components/composer-todo-card";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { EmptyStateWorkspaceSelector } from "@/components/empty-state-workspace-selector";
import { PendingApprovalCard } from "@/components/pending-approval-card";
import { PendingQuestionsCard } from "@/components/pending-questions-card";
import { SkillSlashMenu } from "@/components/skill-slash-menu";
import { WorkLocationMenu } from "@/components/work-location-menu";
import { WorkspaceFileReferenceMenu } from "@/components/workspace-file-reference-menu";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  CONVERSATION_GUTTER_NEG_X,
  CONVERSATION_GUTTER_X,
  CONVERSATION_MAX_W,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";
import { desktopTranslucencyTintInnerClass } from "@/lib/desktop-translucency-surface";
import {
  buildConversationScrollOccludeMaskStyle,
  conversationScrollOccludeShapeFromRects,
  readElementTopBorderRadius,
  readElementUniformBorderRadius,
  type ConversationScrollOccludeShape,
} from "@/lib/conversation-scroll-occlude-mask";
import type { ActiveWorkspaceFileReferenceQuery, RichSegment } from "@/lib/composer-segment-model";
import type { ActiveSkillSlashQuery, SkillSlashSuggestion } from "@/lib/skill-slash";
import { sameWorkspacePath } from "@/lib/workspace-display-label";
import { normalizePaneSessionPathKey } from "@/lib/pane-desktop-snapshot";
import { shouldShowComposerChangesCard } from "@/lib/composer-changes-card-visibility";
import { viewportLengthToScaleRootLocal } from "@/lib/ui-layout-scale";
import type { ComposerLocalFileAttachmentView } from "@/lib/local-file-attachments";
import { cn } from "@/lib/utils";
import { useComposerSuggestionAnchor } from "@/hooks/use-composer-suggestion-anchor";
import type { DesktopSnapshot } from "@/types";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type ComposerDockProps = {
  isEmptySession: boolean;
  doodleText: string;
  showWorkspaceBindingControls: boolean;
  paneSessionPath?: string;
  useIsolatedPaneWorkspace?: boolean;
  composerSegments: readonly RichSegment[];
  onComposerSegmentsChange: (segments: RichSegment[]) => void;
  composerLocalFileAttachments: ComposerLocalFileAttachmentView[];
  onComposerLocalFileAttachmentsChange: (attachments: ComposerLocalFileAttachmentView[]) => void;
  snapshot: DesktopSnapshot | null;
  runtime: DesktopRuntime;
  commitBusy: boolean;
  activeSessionReadOnly: boolean;
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
  continueBusy: boolean;
  composerBrowserElementAttachments: BrowserElementAttachment[];
  onComposerBrowserElementAttachmentsChange: (attachments: BrowserElementAttachment[]) => void;
  onSubmitComposerMessage: () => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
  composerRichInputRef: RefObject<ComposerRichInputHandle | null>;
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
  useTranslucency: boolean;
  onOpenGitTab: () => void;
  /** Shows "back to bottom" when the user has scrolled up away from the bottom. */
  showScrollToBottom?: boolean;
  onScrollToBottom?: () => void;
  /** Conversation scroll viewport (used to convert the dock shape into viewport coordinates for the shape mask) */
  getScrollViewport?: () => HTMLElement | null;
  /** translucency: clips messages to the input/Changes/TODO outline; the top rounded-corner gap is not clipped */
  onScrollOccludeMaskStyleChange?: (style: CSSProperties | undefined) => void;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

export const ComposerDock = forwardRef<HTMLDivElement, ComposerDockProps>(function ComposerDock(
  {
    isEmptySession,
    doodleText,
    showWorkspaceBindingControls,
    paneSessionPath,
    useIsolatedPaneWorkspace = false,
    composerSegments,
    onComposerSegmentsChange,
    composerLocalFileAttachments,
    onComposerLocalFileAttachmentsChange: _onComposerLocalFileAttachmentsChange,
    snapshot,
    runtime,
    commitBusy,
    activeSessionReadOnly,
    rewindWarnings,
    showPendingApprovalInComposer,
    pendingApproval,
    showPendingQuestionsInComposer,
    pendingQuestions,
    questionDrafts: questionDraftsOverride,
    onUpdateQuestionDraft,
    onSubmitQuestions,
    onSkipQuestions,
    fileReferenceSelectedIndex,
    onFileReferenceSelectedIndexChange: _onFileReferenceSelectedIndexChange,
    fileReferenceMenuView,
    atReferenceMenuItems,
    onApplyFileReferenceSuggestion,
    onApplySessionReferenceSuggestion,
    onOpenAtReferenceSessions,
    onBackAtReferenceMenu,
    onDismissFileReferenceSuggestions,
    activeFileReferenceQuery,
    slashQuery,
    slashSuggestions,
    slashSelectedIndex,
    onSlashSelectedIndexChange: _onSlashSelectedIndexChange,
    onApplySlashSuggestionItem,
    onDismissSlashSuggestions,
    composerCursorCodeUnits,
    composerPlaceholder,
    composerAgentModeChipPlaceholder,
    composerCanSend,
    composerHasPayload,
    composerBusy,
    conversationInterruptible,
    continueBusy: _continueBusy,
    composerBrowserElementAttachments,
    onComposerBrowserElementAttachmentsChange,
    onSubmitComposerMessage,
    onComposerAgentModeChange,
    composerRichInputRef,
    onComposerKeyDown,
    onComposerCursorCodeUnitsChange,
    onInsertFileReferenceTrigger,
    onPickLocalFileFromPalette,
    onInsertSkillTriggerFromPalette,
    onRemoveLocalFileAttachment,
    onComposerPaste,
    onComposerDragOver,
    onComposerDrop,
    models,
    useTranslucency,
    onOpenGitTab,
    showScrollToBottom = false,
    onScrollToBottom,
    getScrollViewport,
    onScrollOccludeMaskStyleChange,
  },
  ref,
) {
  const { t } = useTranslation();
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const dockElementRef = useRef<HTMLDivElement | null>(null);
  /** Column containing Changes/Todo + the input box */
  const composerChromeRef = useRef<HTMLDivElement | null>(null);
  const setDockRef = useCallback(
    (node: HTMLDivElement | null) => {
      dockElementRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (!onScrollOccludeMaskStyleChange) {
      return;
    }
    if (isEmptySession || !useTranslucency) {
      onScrollOccludeMaskStyleChange(undefined);
      return;
    }
    const dock = dockElementRef.current;
    const chrome = composerChromeRef.current;
    if (!dock || !chrome) {
      onScrollOccludeMaskStyleChange(undefined);
      return;
    }

    const syncOcclude = () => {
      const viewport = getScrollViewport?.() ?? null;
      if (!viewport) {
        onScrollOccludeMaskStyleChange(undefined);
        return;
      }
      const viewportRect = viewport.getBoundingClientRect();
      const shapes: ConversationScrollOccludeShape[] = [];

      // The approval / question cards sit outside the chrome but still overlap the scroll area;
      // under the translucency tint, messages showing through them must be clipped as well
      for (const selector of [
        '[data-spirit-surface="pending-approval-card"]',
        '[data-spirit-surface="pending-questions-card"]',
      ] as const) {
        const card = dock.querySelector<HTMLElement>(selector);
        if (!card) {
          continue;
        }
        const radius = readElementUniformBorderRadius(card);
        shapes.push(
          conversationScrollOccludeShapeFromRects(
            viewportRect,
            card.getBoundingClientRect(),
            radius,
            radius,
          ),
        );
      }

      const changes = chrome.querySelector<HTMLElement>(
        '[data-spirit-surface="composer-changes-card"]',
      );
      if (changes) {
        const radius = readElementUniformBorderRadius(changes);
        shapes.push(
          conversationScrollOccludeShapeFromRects(
            viewportRect,
            changes.getBoundingClientRect(),
            radius,
            radius,
          ),
        );
      }

      const scrollToBottom = showScrollToBottom
        ? chrome.querySelector<HTMLElement>('[data-spirit-surface="composer-scroll-to-bottom"]')
        : null;
      if (scrollToBottom) {
        const radius = readElementUniformBorderRadius(scrollToBottom);
        shapes.push(
          conversationScrollOccludeShapeFromRects(
            viewportRect,
            scrollToBottom.getBoundingClientRect(),
            radius,
            radius,
          ),
        );
      }

      const todo = chrome.querySelector<HTMLElement>('[data-spirit-surface="composer-todo-card"]');
      if (todo) {
        const topRadius = readElementTopBorderRadius(todo);
        shapes.push(
          conversationScrollOccludeShapeFromRects(
            viewportRect,
            todo.getBoundingClientRect(),
            topRadius,
            topRadius,
            { roundTopOnly: true },
          ),
        );
      }

      const surface = chrome.querySelector<HTMLElement>('[data-spirit-surface="composer-surface"]');
      let bottomSlabFromY: number | undefined;
      if (surface) {
        const surfaceRect = surface.getBoundingClientRect();
        const radius = readElementUniformBorderRadius(surface);
        shapes.push(
          conversationScrollOccludeShapeFromRects(viewportRect, surfaceRect, radius, radius),
        );
        // The bottom band starts at the "bottom corner-radius start": the gap outside the bottom
        // rounded corner + the approval bar; the top rounded-corner gap is not part of the band
        bottomSlabFromY = surfaceRect.bottom - viewportRect.top - radius;
      }

      const localShapes: ConversationScrollOccludeShape[] = shapes.map((shape) => ({
        ...shape,
        x: viewportLengthToScaleRootLocal(shape.x),
        y: viewportLengthToScaleRootLocal(shape.y),
        width: viewportLengthToScaleRootLocal(shape.width),
        height: viewportLengthToScaleRootLocal(shape.height),
      }));
      const localBottomSlabFromY =
        bottomSlabFromY == null ? undefined : viewportLengthToScaleRootLocal(bottomSlabFromY);

      onScrollOccludeMaskStyleChange(
        buildConversationScrollOccludeMaskStyle({
          viewportWidth: viewport.clientWidth,
          viewportHeight: viewport.clientHeight,
          shapes: localShapes,
          bottomSlabFromY: localBottomSlabFromY,
        }),
      );
    };

    syncOcclude();
    const observer = new ResizeObserver(syncOcclude);
    observer.observe(dock);
    observer.observe(chrome);
    const viewport = getScrollViewport?.() ?? null;
    if (viewport) {
      observer.observe(viewport);
    }
    window.addEventListener("resize", syncOcclude);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncOcclude);
      onScrollOccludeMaskStyleChange(undefined);
    };
  }, [
    getScrollViewport,
    isEmptySession,
    onScrollOccludeMaskStyleChange,
    showScrollToBottom,
    useTranslucency,
  ]);
  const fileReferenceAnchor = useComposerSuggestionAnchor(
    composerRichInputRef,
    activeFileReferenceQuery ? composerCursorCodeUnits : null,
    composerRootRef,
  );
  const slashAnchor = useComposerSuggestionAnchor(
    composerRichInputRef,
    slashQuery ? composerCursorCodeUnits : null,
    composerRootRef,
  );

  const showChangesCard = shouldShowComposerChangesCard(snapshot?.git);
  const changesLineDelta = snapshot?.git.workingTreeLineDelta;
  const hasComposerTodos = Boolean(snapshot?.conversation.todos);
  // Content cards above the composer are mutually exclusive by priority:
  // approval/questions > TODO > Changes. Hidden cards unmount entirely and
  // reappear automatically once the higher-priority card is gone.
  const showBlockingCard =
    (showPendingApprovalInComposer && pendingApproval != null) ||
    (showPendingQuestionsInComposer && pendingQuestions != null);
  const showTodoCard = hasComposerTodos && !showBlockingCard;
  const showChangesCardEffective = showChangesCard && !showBlockingCard && !showTodoCard;
  const workspaceControlsDisabled =
    useIsolatedPaneWorkspace && paneSessionPath
      ? runtime.paneWorkspaceBusySessionPath === normalizePaneSessionPathKey(paneSessionPath)
      : runtime.busyAction === "bootstrap" || runtime.busyAction === "session";
  const gitControlsDisabled = workspaceControlsDisabled || commitBusy;
  const approvalSessionPath =
    useIsolatedPaneWorkspace && paneSessionPath ? paneSessionPath : undefined;
  const questionsSessionPath = approvalSessionPath;

  return (
    <div
      ref={setDockRef}
      data-spirit-surface="composer-dock"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 bg-transparent",
        isEmptySession
          ? cn(
              "inset-y-0 flex items-center justify-center pb-[env(safe-area-inset-bottom,0px)]",
              CONVERSATION_GUTTER_X,
            )
          : "bottom-0 pt-2 pb-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto w-full",
          CONVERSATION_GUTTER_X,
          isEmptySession ? CONVERSATION_MAX_W : CONVERSATION_MESSAGE_LIST_MAX_W,
        )}
      >
        {isEmptySession ? <Doodle>{doodleText}</Doodle> : null}
        <div className="space-y-2">
          {showWorkspaceBindingControls ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
              <EmptyStateWorkspaceSelector
                currentWorkspaceRoot={snapshot?.workspaceRoot ?? ""}
                workspaceBinding={snapshot?.workspaceBinding ?? "project"}
                availableWorkspaces={snapshot?.availableWorkspaces ?? []}
                disabled={workspaceControlsDisabled}
                onSelectWorkspace={(workspaceRoot) => {
                  if (
                    snapshot?.workspaceBinding === "project" &&
                    snapshot.workspaceRoot &&
                    sameWorkspacePath(snapshot.workspaceRoot, workspaceRoot)
                  ) {
                    return;
                  }
                  if (useIsolatedPaneWorkspace && paneSessionPath) {
                    void runtime.switchPaneWorkspace(paneSessionPath, workspaceRoot);
                    return;
                  }
                  void runtime.switchWorkspaceRoot(workspaceRoot);
                }}
                onSelectNoWorkspace={() => {
                  if (snapshot?.workspaceBinding === "none") {
                    return;
                  }
                  if (useIsolatedPaneWorkspace && paneSessionPath) {
                    void runtime.switchPaneToNoWorkspaceBinding(paneSessionPath);
                    return;
                  }
                  void runtime.switchToNoWorkspaceBinding();
                }}
                onAddWorkspace={() => {
                  void (async () => {
                    const workspaceRoot = await runtime.pickWorkspaceDirectory();
                    if (!workspaceRoot) {
                      return;
                    }
                    if (useIsolatedPaneWorkspace && paneSessionPath) {
                      await runtime.switchPaneWorkspace(paneSessionPath, workspaceRoot);
                      return;
                    }
                    await runtime.switchWorkspaceRoot(workspaceRoot);
                  })();
                }}
              />
              {isEmptySession ? (
                <>
                  <BranchSelectMenu
                    branches={snapshot?.git.branches ?? []}
                    selectedBranch={snapshot?.git.selectedBranch}
                    currentBranch={snapshot?.git.branch}
                    disabled={gitControlsDisabled}
                    onBranchChange={(branch) => {
                      if (useIsolatedPaneWorkspace && paneSessionPath) {
                        void runtime.setPanePendingGitBranch(paneSessionPath, branch);
                        return;
                      }
                      void runtime.setPendingGitBranch(branch);
                    }}
                  />
                  <WorkLocationMenu
                    workLocation={snapshot?.git.workLocation ?? "local"}
                    disabled={gitControlsDisabled || snapshot?.git.isRepository !== true}
                    onWorkLocationChange={(workLocation) => {
                      if (useIsolatedPaneWorkspace && paneSessionPath) {
                        void runtime.setPaneWorkLocation(paneSessionPath, workLocation);
                        return;
                      }
                      void runtime.setWorkLocation(workLocation);
                    }}
                  />
                  <ApprovalLevelMenu
                    approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                    disabled={activeSessionReadOnly}
                    onApprovalLevelChange={(level) => {
                      void runtime.setApprovalLevel(level);
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {rewindWarnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
              <p>{t("app.rewindComplete", { count: rewindWarnings.length })}</p>
              <p className="mt-1 truncate" title={rewindWarnings[0]?.message}>
                {rewindWarnings[0]?.path}: {rewindWarnings[0]?.message}
              </p>
            </div>
          ) : null}

          {showPendingApprovalInComposer && pendingApproval ? (
            <PendingApprovalCard
              pendingApproval={pendingApproval}
              approvalGuidance={runtime.approvalGuidance}
              approveBusy={runtime.busyAction === "approve"}
              useTranslucency={useTranslucency}
              onApprovalGuidanceChange={runtime.setApprovalGuidance}
              onSubmitApproval={(decision) => {
                if (decision.kind === "allow") {
                  void runtime.submitApproval(
                    {
                      kind: "allow",
                      ...(decision.remember ? { remember: decision.remember } : {}),
                    },
                    approvalSessionPath,
                  );
                  return;
                }
                if (decision.kind === "deny") {
                  void runtime.submitApproval({ kind: "deny" }, approvalSessionPath);
                  return;
                }
                void runtime.submitApproval(
                  {
                    kind: "guidance",
                    userMessage: decision.userMessage ?? "",
                  },
                  approvalSessionPath,
                );
              }}
            />
          ) : null}

          {showPendingQuestionsInComposer && pendingQuestions ? (
            <PendingQuestionsCard
              pendingQuestions={pendingQuestions}
              questionDrafts={questionDraftsOverride ?? runtime.questionDrafts}
              questionsBusy={runtime.busyAction === "questions"}
              useTranslucency={useTranslucency}
              onUpdateDraft={onUpdateQuestionDraft ?? runtime.updateQuestionDraft}
              onSubmitQuestions={() => {
                if (onSubmitQuestions) {
                  onSubmitQuestions();
                  return;
                }
                void runtime.submitQuestions(questionsSessionPath, pendingQuestions);
              }}
              onSkipQuestions={() => {
                if (onSkipQuestions) {
                  onSkipQuestions();
                  return;
                }
                void runtime.skipQuestions(questionsSessionPath, pendingQuestions);
              }}
            />
          ) : null}

          <div className="relative" ref={composerRootRef}>
            <div className="relative z-10 flex flex-col" ref={composerChromeRef}>
              {/*
                Changes row: the button shares the row with Changes in document flow (row height
                is held up by Changes).
                Without Changes, the button is absolutely overlaid above the chrome and does not
                count toward the dock height → it does not participate in scroll-bed compensation
                (toggling with followingTail won't change padding, avoiding a "hitch" when sliding
                to the bottom).
              */}
              {!isEmptySession && showChangesCardEffective && changesLineDelta ? (
                <div className="relative z-20 mb-2 flex shrink-0 items-center gap-2 self-start">
                  <ComposerChangesCard
                    delta={changesLineDelta}
                    onOpenGitTab={onOpenGitTab}
                    useTranslucency={useTranslucency}
                  />
                  <ComposerScrollToBottomButton
                    visible={showScrollToBottom}
                    onClick={() => onScrollToBottom?.()}
                    useTranslucency={useTranslucency}
                  />
                </div>
              ) : null}
              {!isEmptySession && !(showChangesCardEffective && changesLineDelta) ? (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 flex justify-center"
                  data-spirit-layout="composer-scroll-to-bottom-overlay"
                >
                  <div className="pointer-events-auto">
                    <ComposerScrollToBottomButton
                      visible={showScrollToBottom}
                      onClick={() => onScrollToBottom?.()}
                      useTranslucency={useTranslucency}
                    />
                  </div>
                </div>
              ) : null}
              {snapshot?.conversation.todos && showTodoCard ? (
                <div className="relative z-20 mx-4 -mb-px shrink-0">
                  <ComposerTodoCard
                    todos={snapshot.conversation.todos}
                    sessionKey={snapshot.composerSessionKey}
                    useTranslucency={useTranslucency}
                  />
                </div>
              ) : null}
              <ComposerSurface
                segments={composerSegments}
                onSegmentsChange={onComposerSegmentsChange}
                onSubmit={onSubmitComposerMessage}
                browserElementAttachments={composerBrowserElementAttachments}
                onElementAttachmentsChange={onComposerBrowserElementAttachmentsChange}
                onAbort={() => {
                  void runtime.abortConversation(
                    useIsolatedPaneWorkspace && paneSessionPath
                      ? { sessionPath: paneSessionPath }
                      : undefined,
                  );
                }}
                placeholder={composerPlaceholder}
                agentModeChipPlaceholder={composerAgentModeChipPlaceholder}
                localFileAttachments={composerLocalFileAttachments}
                models={models}
                catalogHints={snapshot?.config.modelCatalogHints}
                activeModel={snapshot?.config.activeModel ?? runtime.settings.activeModel}
                agentMode={runtime.settings.agentMode}
                loopEnabled={snapshot?.conversation.loopEnabled === true}
                onModelSelect={(ref) => {
                  if (useIsolatedPaneWorkspace && paneSessionPath) {
                    void runtime.switchPaneModel(paneSessionPath, ref);
                    return;
                  }
                  runtime.setActiveModel(ref);
                }}
                onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                onModelReasoningModeSelect={runtime.setModelReasoningMode}
                onModelThinkingEnabledSelect={runtime.setModelThinkingEnabled}
                onAgentModeChange={onComposerAgentModeChange}
                onLoopEnabledChange={(enabled) => {
                  void runtime.setLoopEnabled(enabled);
                }}
                richInputRef={composerRichInputRef}
                onKeyDown={onComposerKeyDown}
                onSelectionChange={(selectionStart) => {
                  if (selectionStart !== null) {
                    onComposerCursorCodeUnitsChange(selectionStart);
                  }
                }}
                canSend={composerCanSend}
                hasComposerPayload={composerHasPayload}
                canAbort={conversationInterruptible}
                busy={composerBusy}
                agentModeChipDismissed={runtime.agentModeChipDismissed}
                onAgentModeChipDismissChange={runtime.setAgentModeChipDismissed}
                readOnly={activeSessionReadOnly}
                showInsertButton
                canPickLocalFile={runtime.hostKind === "electron"}
                onInsertWorkspaceFileReferenceTrigger={onInsertFileReferenceTrigger}
                onPickLocalFile={onPickLocalFileFromPalette}
                onInsertSkillTrigger={onInsertSkillTriggerFromPalette}
                onRemoveLocalFileAttachment={onRemoveLocalFileAttachment}
                onPaste={onComposerPaste}
                onDragOver={onComposerDragOver}
                onDrop={onComposerDrop}
                saveLocalImageAs={runtime.saveLocalImageAs}
                useTranslucency={useTranslucency}
              />
            </div>
            <ComposerSuggestionDropdown
              active={Boolean(activeFileReferenceQuery)}
              anchor={fileReferenceAnchor}
              composerRootRef={composerRootRef}
              ariaLabel={
                fileReferenceMenuView === "sessions"
                  ? t("composer.atReference.sessionCandidates")
                  : t("composer.atReference.candidates")
              }
              onDismiss={onDismissFileReferenceSuggestions}
            >
              {activeFileReferenceQuery ? (
                <WorkspaceFileReferenceMenu
                  items={atReferenceMenuItems}
                  selectedIndex={fileReferenceSelectedIndex}
                  onApplyFile={onApplyFileReferenceSuggestion}
                  onApplySession={onApplySessionReferenceSuggestion}
                  onOpenSessions={onOpenAtReferenceSessions}
                  onBack={onBackAtReferenceMenu}
                />
              ) : null}
            </ComposerSuggestionDropdown>
            <ComposerSuggestionDropdown
              active={Boolean(slashQuery)}
              anchor={slashAnchor}
              composerRootRef={composerRootRef}
              ariaLabel={t("composer.slashCommand")}
              onDismiss={onDismissSlashSuggestions}
            >
              {slashQuery ? (
                <SkillSlashMenu
                  suggestions={slashSuggestions}
                  selectedIndex={slashSelectedIndex}
                  onApplySuggestion={onApplySlashSuggestionItem}
                />
              ) : null}
            </ComposerSuggestionDropdown>
            {!isEmptySession ? (
              <div
                className={cn(
                  "pointer-events-none relative z-0 -mt-4 pt-[calc(1rem+0.375rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
                  desktopTranslucencyTintInnerClass(useTranslucency),
                  CONVERSATION_GUTTER_NEG_X,
                  CONVERSATION_GUTTER_X,
                )}
              >
                <div className="pointer-events-auto relative z-[11] flex items-center justify-between gap-3 px-3">
                  <ApprovalLevelMenu
                    approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                    disabled={activeSessionReadOnly}
                    onApprovalLevelChange={(level) => {
                      void runtime.setApprovalLevel(level);
                    }}
                  />
                  <ComposerContextUsageRing usage={snapshot?.conversation.contextUsage} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
