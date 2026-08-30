import { useTranslation } from "react-i18next";

import { ProcessCardCollapsible } from "@/components/process-card-collapsible";
import { ToolCallDiffHostProvider } from "@/components/tool-call-diff-host-context";
import { ToolCallCollapsible } from "@/components/tool-call/tool-call-collapsible";
import type { ComposerLocalFileAttachmentView } from "@/components/composer-local-file-strip";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { MessageCard } from "@/components/conversation/message-card";
import { MessageTurnActions } from "@/components/conversation/message-turn-actions";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { segmentsToAttachments, segmentsToPlainText } from "@/lib/composer-segment-model";
import { conversationMessageStableId } from "@/lib/conversation-list-scope";
import {
  shouldShowContinueToolbarOnProcessGroup,
  type TurnContinuePresentation,
} from "@/lib/conversation-continue-ui";
import {
  findRenderIndexForMessageId,
  isMessageHiddenByProcessGroup,
  type ConversationRenderItem,
} from "@/lib/conversation-process-groups";
import {
  isAssistantReasoningLive,
  shouldCollapseThinkingDuringToolPreview,
  shouldShowAssistantThinkingCollapsible,
} from "@/lib/conversation-thinking-ui";
import {
  assistantTurnStartIndexForRenderItem,
  isMessageInActiveStreamingTurn,
  messageShowsAssistantTurnActions,
  resolveTurnActionsToolbarHostIndex,
  shouldClearAssistantTurnHover,
} from "@/lib/message-turn-actions-ui";
import { canCopyAssistantTurn, formatAssistantTurnCopyText } from "@/lib/message-turn-copy";
import { cn } from "@/lib/utils";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import type {
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  ModelRef,
  PendingAssistantAux,
} from "@/types";
import type { PointerEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";
import {
  conversationRenderItemGapBeforePxAt,
  estimateConversationRenderItemHeight,
} from "@/lib/conversation-virtual-row-size";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

// Memoized row props must be reference-stable; use module-level constants for empty arrays instead of inline literals
const EMPTY_MODELS: DesktopSnapshot["config"]["models"] = [];
const EMPTY_REWIND_LOCAL_FILE_ATTACHMENTS: readonly ComposerLocalFileAttachmentView[] = [];

export type ConversationListProps = {
  messages: readonly ConversationMessageSnapshot[];
  conversationRenderItems: readonly ConversationRenderItem[];
  /** Virtualized scroll container (Radix ScrollArea viewport); provided by ConversationView. */
  getScrollElement: () => HTMLElement | null;
  /** Synchronously pins to the bottom while tail-following (stream tail owns the stick semantics); called on every commit where totalSize changes */
  pinScrollToTail: () => void;
  releaseTailFollow?: () => void;
  quoteScrollRequest?: { messageId: number; behavior: ScrollBehavior; nonce: number } | null;
  onQuoteScrollHandled?: () => void;
  subagentViewActive: boolean;
  composerSessionKey: string;
  conversationListScopeKey: string;
  conversationListRemountEpoch: number;
  conversationPendingAuxState: PendingAssistantAux | undefined;
  processGroupManualOpen: Record<string, boolean>;
  processGroupManualOpenKey: (groupId: string) => string;
  onProcessGroupManualOpenChange: (groupId: string, open: boolean) => void;
  shouldPlayProcessSealAnimation: (groupId: string) => boolean;
  workspaceRoot: string;
  runtime: DesktopRuntime;
  turnContinue: TurnContinuePresentation | undefined;
  activeSessionReadOnly: boolean;
  conversationIsBusy: boolean;
  continueBusy: boolean;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftChange: (
    updater: (current: MessageRewindDraftState | null) => MessageRewindDraftState | null,
  ) => void;
  messageRewindComposerEnabled: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  models: DesktopSnapshot["config"]["models"];
  catalogHints: DesktopSnapshot["config"]["modelCatalogHints"] | undefined;
  activeModel: ModelRef;
  agentMode: DesktopAgentMode;
  onOpenSubagentViewer: ((toolCallId: string) => void) | undefined;
  onOpenReadFile: ((target: EditorFileTarget) => void) | undefined;
  onOpenPlan: (() => void) | undefined;
  onStartMessageRewind: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onSubmitMessageRewind: () => void;
  onRewindRemoveLocalFileAttachment: (path: string) => void;
  onRewindPickLocalFile: () => void;
  onRewindPaste: (event: import("react").ClipboardEvent<HTMLTextAreaElement>) => void;
  onRewindDragOver: (event: import("react").DragEvent<HTMLElement>) => void;
  onRewindDrop: (event: import("react").DragEvent<HTMLElement>) => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
  onForkMessage: (message: ConversationMessageSnapshot, listIndex: number) => void;
};

export function ConversationList({
  messages,
  conversationRenderItems,
  getScrollElement,
  pinScrollToTail,
  releaseTailFollow,
  quoteScrollRequest,
  onQuoteScrollHandled,
  subagentViewActive,
  composerSessionKey,
  conversationListScopeKey,
  conversationListRemountEpoch,
  conversationPendingAuxState,
  processGroupManualOpen,
  processGroupManualOpenKey,
  onProcessGroupManualOpenChange,
  shouldPlayProcessSealAnimation,
  workspaceRoot,
  runtime,
  turnContinue,
  activeSessionReadOnly,
  conversationIsBusy,
  continueBusy,
  rewindDraft,
  onRewindDraftChange,
  messageRewindComposerEnabled,
  rewindRichInputRef,
  models,
  catalogHints,
  activeModel,
  agentMode,
  onOpenSubagentViewer,
  onOpenReadFile,
  onOpenPlan,
  onStartMessageRewind,
  onSubmitMessageRewind,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onRewindDragOver,
  onRewindDrop,
  onComposerAgentModeChange,
  onForkMessage,
}: ConversationListProps) {
  const { t } = useTranslation();
  const [hoveredAssistantTurnStart, setHoveredAssistantTurnStart] = useState<number | null>(null);
  const turnActionsToolbarHostIndex = useMemo(
    () => resolveTurnActionsToolbarHostIndex(messages),
    [messages],
  );

  const handleAssistantTurnPointerEnter = useCallback((turnStart: number) => {
    setHoveredAssistantTurnStart(turnStart);
  }, []);

  const handleAssistantTurnPointerLeave = useCallback((event: PointerEvent, turnStart: number) => {
    if (!shouldClearAssistantTurnHover(event, turnStart)) {
      return;
    }
    setHoveredAssistantTurnStart((current) => (current === turnStart ? null : current));
  }, []);

  useEffect(() => {
    if (!conversationIsBusy) {
      return;
    }
    setHoveredAssistantTurnStart(null);
  }, [conversationIsBusy]);

  // During streaming deltas MessageCard short-circuits via memo, so the passed callbacks must be
  // stable references; the runtime object is a new reference on every render, so destructure its
  // useCallback-wrapped methods before using them as dependencies.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const {
    continueAssistantCompletion,
    abortShell,
    reorderQueuedUserTurn,
    sendQueuedUserTurnNow,
    removeQueuedUserTurn,
  } = runtime;

  const handleContinueMessage = useCallback(
    (targetMessage: ConversationMessageSnapshot) => {
      void continueAssistantCompletion(targetMessage.id);
    },
    [continueAssistantCompletion],
  );
  const handleAbortShell = useCallback(
    (toolCallId: string) => {
      void abortShell(toolCallId);
    },
    [abortShell],
  );
  const handleQueueMoveUp = useCallback(
    (queueId: string) => {
      void reorderQueuedUserTurn(queueId);
    },
    [reorderQueuedUserTurn],
  );
  const handleQueueSendNow = useCallback(
    (queueId: string) => {
      void sendQueuedUserTurnNow(queueId);
    },
    [sendQueuedUserTurnNow],
  );
  const handleQueueDelete = useCallback(
    (queueId: string) => {
      void removeQueuedUserTurn(queueId);
    },
    [removeQueuedUserTurn],
  );
  const handleRewindSegmentsChange = useCallback(
    (segments: import("@/lib/composer-segment-model").RichSegment[]) => {
      onRewindDraftChange((current) => (current ? { ...current, segments } : current));
    },
    [onRewindDraftChange],
  );
  const handleCopyTurn = useCallback((listIndex: number) => {
    const text = formatAssistantTurnCopyText(messagesRef.current, listIndex);
    if (!text.trim()) {
      return;
    }
    void navigator.clipboard.writeText(text);
  }, []);

  // Compute queued prefix counts once, avoiding O(index) slice/filter per row in renderRow
  const queuedBeforeCounts = useMemo(() => {
    const counts = Array.from<number>({ length: messages.length });
    let queued = 0;
    for (let index = 0; index < messages.length; index += 1) {
      counts[index] = queued;
      if (messages[index]!.queued === true) {
        queued += 1;
      }
    }
    return counts;
  }, [messages]);

  const toolCallDiffHostValue = useMemo(
    () => ({
      workspaceRoot,
      readWorkspaceTextFile: runtime.readWorkspaceTextFile,
    }),
    [workspaceRoot, runtime.readWorkspaceTextFile],
  );

  const sizingRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The viewport is the parent ScrollArea's DOM; on cold start getScrollElement() is null on
  // the first frame, so it must be converted to state to make the virtualizer re-run _willUpdate
  // and bind the scroll listener.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  // useLayoutEffect is required: useEffect binds scrollElement only after paint, so navigating
  // into this view would first paint one frame of an empty list (virtualItems empty), perceived
  // as a blank flash. setState in a layout effect flushes synchronously before paint, and
  // virtual-core measures the rect synchronously when registering observeElementRect, so the
  // first frame already has rows.
  // After a full page reload (e.g. HMR) the snapshot is ready on the first commit, and this
  // component mounts in the same commit as the ancestor ScrollArea; child layout effects run
  // before the ancestor viewport ref is attached, so we get null here.
  // A one-shot binding would leave the virtualizer without a scroll element forever (blank
  // list), so poll until the viewport is available.
  useLayoutEffect(() => {
    const el = getScrollElement();
    if (el) {
      setScrollElement(el);
      return;
    }
    let rafId = 0;
    const waitForViewport = () => {
      const next = getScrollElement();
      if (!next) {
        rafId = requestAnimationFrame(waitForViewport);
        return;
      }
      setScrollElement(next);
    };
    rafId = requestAnimationFrame(waitForViewport);
    return () => cancelAnimationFrame(rafId);
  }, [getScrollElement]);

  const getItemKey = useCallback(
    (index: number) => {
      const item = conversationRenderItems[index];
      if (!item) {
        return index;
      }
      if (item.kind === "process-group") {
        return item.groupId;
      }
      const message = messages[item.messageIndex];
      if (!message) {
        return index;
      }
      return `${conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}@${item.messageIndex}`;
    },
    [conversationRenderItems, messages, composerSessionKey, conversationListScopeKey],
  );

  const estimateSize = useCallback(
    (index: number) =>
      estimateConversationRenderItemHeight(index, conversationRenderItems, messages),
    [conversationRenderItems, messages],
  );

  // Do not override shouldAdjustScrollPositionOnItemSizeChange, and do not use anchorTo:'end':
  // virtual-core 3.17.x's default policy already has "first-measure compensation / skip backward
  // re-measurement" built in; overriding it (isScrolling always false) in the last experiment was
  // exactly the root cause of the jump-on-scroll-up; anchorTo:'end''s wasAtEnd path bypasses
  // shouldAdjust and rewrites scrollTop directly (logs in the stash experiment), so it is dropped too.
  //
  // directDomUpdates: container height and row offsets are written to the DOM synchronously in
  // onChange (inside the RO callback). When an inline collapsing card animation changes row height
  // frame by frame, React's async re-render leaves totalSize/translateY one frame behind; during
  // that window pinning to the bottom is a no-op (scrollHeight unchanged), so the group row's
  // bottom edge dips then bounces back (measured 10px jump + ±1px per frame) — i.e. "while a
  // card pinned at the bottom expands, nested cards and the cards below shake vertically".
  // Direct writes make row-height changes, container growth, and the pin in onChange land in the
  // same frame.
  //
  // The pin in onChange must be gated on totalSize changes: onChange also fires for pure
  // scrolling, and stick happens to re-engage when the user scrolls down into the 48px threshold;
  // without the gate, the next scroll notification would immediately slam the viewport to the
  // bottom (measured forced pulls from 14~17px above the bottom) — i.e. "scrolling down but not
  // yet at the bottom suddenly jumps to the bottom".
  const lastPinnedTotalSizeRef = useRef(-1);
  const suppressTailPinRef = useRef(false);
  const virtualizer = useVirtualizer({
    count: conversationRenderItems.length,
    getScrollElement: () => scrollElement,
    getItemKey,
    estimateSize,
    overscan: 8,
    scrollMargin,
    directDomUpdates: true,
    onChange: (instance) => {
      const totalSize = instance.getTotalSize();
      if (totalSize === lastPinnedTotalSizeRef.current) {
        return;
      }
      lastPinnedTotalSizeRef.current = totalSize;
      if (suppressTailPinRef.current) {
        return;
      }
      pinScrollToTail();
    },
  });

  // scrollMargin = offset of the list start relative to the scroll viewport top (including shell
  // pt-6/7), otherwise translateY and scrollToIndex would be offset as a whole.
  useLayoutEffect(() => {
    const viewport = scrollElement;
    const listEl = sizingRef.current;
    if (!viewport || !listEl) {
      return;
    }
    const measure = () => {
      const listRect = listEl.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const next = listRect.top - viewportRect.top + viewport.scrollTop;
      setScrollMargin((current) => (Math.abs(current - next) > 0.5 ? next : current));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [scrollElement, composerSessionKey, conversationListScopeKey, conversationListRemountEpoch]);

  useEffect(() => {
    if (!quoteScrollRequest) {
      return;
    }
    const found = findRenderIndexForMessageId(
      messages,
      conversationRenderItems,
      quoteScrollRequest.messageId,
    );
    if (!found) {
      onQuoteScrollHandled?.();
      return;
    }
    if (found.processGroupId) {
      onProcessGroupManualOpenChange(found.processGroupId, true);
    }
    suppressTailPinRef.current = true;
    releaseTailFollow?.();
    virtualizer.scrollToIndex(found.renderIndex, {
      align: "start",
      behavior: quoteScrollRequest.behavior,
    });
    const delayMs = quoteScrollRequest.behavior === "smooth" ? 450 : 50;
    const timer = window.setTimeout(() => {
      suppressTailPinRef.current = false;
      onQuoteScrollHandled?.();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    conversationRenderItems,
    messages,
    onProcessGroupManualOpenChange,
    onQuoteScrollHandled,
    quoteScrollRequest,
    releaseTailFollow,
    virtualizer,
  ]);

  const renderRow = (renderIndex: number): ReactNode => {
    const renderItem = conversationRenderItems[renderIndex];
    if (!renderItem) {
      return null;
    }
    const assistantTurnStart = assistantTurnStartIndexForRenderItem(renderItem, messages);
    const forkMenuHoverRevealed =
      assistantTurnStart !== null && hoveredAssistantTurnStart === assistantTurnStart;

    if (renderItem.kind === "process-group") {
      const anchorMessage = messages[renderItem.messageIndices[0]];
      if (!anchorMessage) {
        return null;
      }
      const showProcessGroupContinue = shouldShowContinueToolbarOnProcessGroup(
        renderItem.messageIndices,
        messages,
        turnContinue,
        conversationIsBusy === true,
        activeSessionReadOnly,
      );
      return (
        <div
          id={renderItem.groupId}
          data-spirit-surface="message-row"
          data-spirit-message-role="assistant"
          data-spirit-message-pending="false"
          data-spirit-fork-turn-start={assistantTurnStart ?? undefined}
          onPointerEnter={
            assistantTurnStart === null
              ? undefined
              : () => handleAssistantTurnPointerEnter(assistantTurnStart)
          }
          onPointerLeave={
            assistantTurnStart === null
              ? undefined
              : (event) => handleAssistantTurnPointerLeave(event, assistantTurnStart)
          }
          className="scroll-mt-4 flex w-full justify-start"
        >
          <div data-spirit-surface="message-assistant" className="min-w-0 w-full space-y-2">
            <ProcessCardCollapsible
              groupId={renderItem.groupId}
              messageIndices={renderItem.messageIndices}
              messages={messages}
              toolCounts={renderItem.toolCounts}
              pendingAuxState={conversationPendingAuxState}
              playSealAnimation={shouldPlayProcessSealAnimation(renderItem.groupId)}
              manualOpen={processGroupManualOpen[processGroupManualOpenKey(renderItem.groupId)]}
              onManualOpenChange={(open) => {
                onProcessGroupManualOpenChange(renderItem.groupId, open);
              }}
              renderToolBlock={(message) => (
                <ToolCallCollapsible
                  tool={message.tool!}
                  workspaceRoot={workspaceRoot}
                  readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
                  readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
                  readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
                  saveLocalImageAs={runtime.saveLocalImageAs}
                  onOpenSubagentViewer={onOpenSubagentViewer}
                  onOpenReadFile={onOpenReadFile}
                  onOpenPlan={onOpenPlan}
                  onAbortShell={handleAbortShell}
                />
              )}
              readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
              readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
              readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
              localImageBaseDir={workspaceRoot}
              localImageAllowedRootDir={workspaceRoot}
            />
            {showProcessGroupContinue && turnContinue ? (
              <MessageTurnActions
                showContinueButton
                continueTarget={turnContinue.continuableMessage}
                continueBusy={continueBusy}
                onContinue={handleContinueMessage}
                canShowActionsMenu={false}
                canCopy={false}
                copyEnabled={false}
                onCopy={() => {}}
                canFork={false}
                forkBusy={false}
                forkEnabled={false}
                forkMenuAlwaysVisible={false}
                onFork={() => {}}
              />
            ) : null}
          </div>
        </div>
      );
    }

    const index = renderItem.messageIndex;
    const message = messages[index];
    if (!message) {
      return null;
    }
    const queuedCanMoveUp = message.queued === true && (queuedBeforeCounts[index] ?? 0) > 0;
    const hiddenByProcessGroup = isMessageHiddenByProcessGroup(conversationRenderItems, index);
    const rewindSelected = rewindDraft?.listIndex === index;
    // Derived booleans are computed with the full aux (shouldShow… inspects adjacent rows' live
    // state); only MessageCard's pendingAuxState prop is gated by message.pending — live aux only
    // concerns the pending row itself, so non-pending rows get undefined to keep memo from being
    // broken by aux reference changes during streaming.
    const pendingAuxForRow = message.pending ? conversationPendingAuxState : undefined;
    return (
      <MessageCard
        composerSessionKey={composerSessionKey}
        conversationListScopeKey={conversationListScopeKey}
        pendingAuxState={pendingAuxForRow}
        listIndex={index}
        message={message}
        hiddenByProcessGroup={hiddenByProcessGroup}
        externalRowGap
        compactAfterPrevious={false}
        tightenAfterPreviousMeta={false}
        showThinkingCollapsible={shouldShowAssistantThinkingCollapsible(
          message,
          conversationPendingAuxState,
          messages,
          index,
        )}
        thinkingReasoningLive={isAssistantReasoningLive(
          message,
          conversationPendingAuxState,
          messages,
          index,
        )}
        collapseThinkingDuringToolPreview={shouldCollapseThinkingDuringToolPreview(messages, index)}
        turnActionsEligible={messageShowsAssistantTurnActions(message, messages, index)}
        inActiveStreamingTurn={isMessageInActiveStreamingTurn(
          messages,
          index,
          conversationIsBusy === true,
        )}
        canCopyTurn={canCopyAssistantTurn(messages, index)}
        onCopyTurn={handleCopyTurn}
        showContinueButton={
          turnContinue?.showContinueAtIndex === index &&
          !activeSessionReadOnly &&
          conversationIsBusy !== true
        }
        continueTarget={turnContinue?.continuableMessage}
        continueBusy={continueBusy}
        rewindSelected={rewindSelected}
        rewindSegments={rewindSelected ? rewindDraft.segments : []}
        rewindLocalFileAttachments={
          rewindSelected ? rewindDraft.localFileAttachments : EMPTY_REWIND_LOCAL_FILE_ATTACHMENTS
        }
        rewindRichInputRef={rewindRichInputRef}
        rewindCanSubmit={
          messageRewindComposerEnabled &&
          rewindSelected &&
          (Boolean(segmentsToPlainText(rewindDraft.segments).trim()) ||
            segmentsToAttachments(rewindDraft.segments).length > 0 ||
            rewindDraft.localFileAttachments.length > 0)
        }
        canPickLocalFile={runtime.hostKind === "electron"}
        rewindBusy={runtime.busyAction === "rewind"}
        models={rewindSelected ? models : EMPTY_MODELS}
        catalogHints={rewindSelected ? catalogHints : undefined}
        activeModel={activeModel}
        agentMode={agentMode}
        onContinue={handleContinueMessage}
        onRewindStart={onStartMessageRewind}
        onRewindSegmentsChange={handleRewindSegmentsChange}
        onRewindSubmit={onSubmitMessageRewind}
        onRewindRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
        onRewindPickLocalFile={onRewindPickLocalFile}
        onRewindPaste={onRewindPaste}
        onRewindDragOver={onRewindDragOver}
        onRewindDrop={onRewindDrop}
        onModelSelect={runtime.setActiveModel}
        onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
        onModelReasoningModeSelect={runtime.setModelReasoningMode}
        onModelThinkingEnabledSelect={runtime.setModelThinkingEnabled}
        onAgentModeChange={onComposerAgentModeChange}
        readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
        readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
        readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
        readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
        saveLocalImageAs={runtime.saveLocalImageAs}
        workspaceRoot={workspaceRoot}
        onOpenSubagentViewer={onOpenSubagentViewer}
        onOpenReadFile={onOpenReadFile}
        onOpenPlan={onOpenPlan}
        onAbortShell={handleAbortShell}
        queuedCanMoveUp={queuedCanMoveUp}
        queueActionBusy={runtime.busyAction === "send"}
        onQueueMoveUp={handleQueueMoveUp}
        onQueueSendNow={handleQueueSendNow}
        onQueueDelete={handleQueueDelete}
        conversationIsBusy={conversationIsBusy}
        activeSessionReadOnly={activeSessionReadOnly}
        forkBusy={runtime.busyAction === "fork"}
        forkMenuAlwaysVisible={!conversationIsBusy && turnActionsToolbarHostIndex === index}
        forkMenuHoverRevealed={forkMenuHoverRevealed}
        assistantTurnStartIndex={assistantTurnStart}
        onAssistantTurnPointerEnter={handleAssistantTurnPointerEnter}
        onAssistantTurnPointerLeave={handleAssistantTurnPointerLeave}
        onForkMessage={onForkMessage}
      />
    );
  };

  const virtualItems = virtualizer.getVirtualItems();
  const virtualTotalSize = virtualizer.getTotalSize();

  // Tail-following must synchronously re-pin on every commit where totalSize changes: card height
  // animations cause multiple layout feedback rounds per frame (row-height change → re-measure →
  // re-rendered totalSize), and the browser RO has a loop limit beyond which notifications are
  // deferred to the next frame; relying only on the stream tail's content RO to pin would let some
  // frames paint with unpinned drift (measured 4~17px oscillation — i.e. "while a bottom-pinned
  // card expands, cards shake vertically"). The layout effect runs in the same JS task as this
  // reflow and is unaffected by the RO loop limit; it is a no-op when not tail-following.
  useLayoutEffect(() => {
    pinScrollToTail();
  }, [virtualTotalSize, pinScrollToTail]);

  return (
    <div
      data-spirit-surface="conversation-list-shell"
      // overflow-x must be clip, not hidden: hidden computes overflow-y as auto, and during
      // streaming virtual rows measure before totalSize commits, briefly overflowing the sizing
      // container, so the shell would flash a native scrollbar and squeeze the layout narrower;
      // clip does not create a scroll container, and x-axis clipping behavior is unchanged.
      className={cn(
        "mx-auto w-full overflow-x-clip pt-6 sm:pt-7",
        CONVERSATION_GUTTER_X,
        CONVERSATION_MESSAGE_LIST_MAX_W,
      )}
    >
      <ToolCallDiffHostProvider value={toolCallDiffHostValue}>
        {subagentViewActive && messages.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("app.subagentViewerEmpty")}
          </p>
        ) : null}
        <div
          key={`${composerSessionKey || "__no-session__"}:${conversationListScopeKey}:e${conversationListRemountEpoch}`}
          // directDomUpdates: container height and row transforms are written directly by the
          // virtualizer; JSX must not set height / translateY again (see the useVirtualizer comment above).
          ref={(el) => {
            sizingRef.current = el;
            virtualizer.containerRef(el);
          }}
          data-spirit-surface="conversation-list"
          className="relative w-full"
        >
          {virtualItems.map((virtualItem) => (
            <div
              key={virtualItem.key}
              ref={(el) => {
                virtualizer.measureElement(el);
                // For rows mounted mid-scroll, virtual-core skips synchronous measurement
                // (when isScrolling and no scrollState it only registers RO); measurement and
                // scrollTop compensation are deferred until after paint.
                // When not scrolling, measureElement already resizeItem'ed synchronously; do not
                // call it again.
                if (el && virtualizer.isScrolling) {
                  virtualizer.resizeItem(virtualItem.index, el.offsetHeight);
                }
              }}
              data-index={virtualItem.index}
              className="absolute left-0 top-0 w-full"
              style={{
                paddingTop: conversationRenderItemGapBeforePxAt(
                  virtualItem.index,
                  conversationRenderItems,
                  messages,
                ),
                // translateY (written directly by the virtualizer) makes the row wrapper its own
                // stacking context, so the in-card z-40 cannot escape to compete with the z-30
                // rewind overlay; rewind rows must be promoted in z at the wrapper level.
                ...(rewindDraft &&
                (() => {
                  const item = conversationRenderItems[virtualItem.index];
                  return item?.kind === "message" && item.messageIndex === rewindDraft.listIndex;
                })()
                  ? { zIndex: 40 }
                  : undefined),
              }}
            >
              {renderRow(virtualItem.index)}
            </div>
          ))}
        </div>
      </ToolCallDiffHostProvider>
    </div>
  );
}
