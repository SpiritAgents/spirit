import {
  memo,
  useMemo,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import { ComposerSurface } from "@/components/composer/composer-surface";
import type { ComposerLocalFileAttachmentView } from "@/components/composer-local-file-strip";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import {
  AssistantCompactionCollapsible,
  AssistantThinkingCollapsible,
} from "@/components/conversation/conversation-thinking-collapsibles";
import { TurnErrorMessageCard } from "@/components/conversation/turn-error-message-card";
import { QueuedUserMessageHoverActions } from "@/components/queued-user-message-hover-actions";
import { ToolCallCollapsible } from "@/components/tool-call/tool-call-collapsible";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { segmentsToAttachments } from "@/lib/composer-segment-model";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
  ReadManagedImagePreview,
  ReadManagedVideoPreview,
  SaveLocalImageAs,
} from "@/components/tool-call/tool-call-types";
import { MessageTurnActions } from "@/components/conversation/message-turn-actions";
import { UserMessageBubble } from "@/components/user-message-bubble";
import { shouldShowAssistantCompactionCollapsible } from "@/lib/conversation-compaction-ui";
import { isTurnErrorAssistantMessage } from "@/lib/conversation-turn-error-ui";
import { conversationMessageStableId } from "@/lib/conversation-list-scope";
import { DESKTOP_ELEVATION_SHADOW_SM } from "@/lib/desktop-chrome";
import { isSubagentStatusSurfaceMessage } from "@/lib/subagent-display";
import { cn } from "@/lib/utils";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import { canForkMessage, canShowForkMessage } from "@/lib/fork-eligibility";
import type {
  ConversationMessageSnapshot,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopSnapshot,
  ModelRef,
  PendingAssistantAux,
} from "@/types";

function MessageCardImpl({
  composerSessionKey,
  conversationListScopeKey,
  message,
  listIndex,
  compactAfterPrevious,
  tightenAfterPreviousMeta,
  showContinueButton,
  continueTarget,
  continueBusy,
  rewindSegments,
  rewindLocalFileAttachments,
  rewindSelected,
  rewindCanSubmit,
  rewindBusy,
  rewindRichInputRef,
  canPickLocalFile,
  models,
  catalogHints,
  activeModel,
  agentMode,
  onContinue,
  onRewindSegmentsChange,
  onRewindStart,
  onRewindSubmit,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onRewindDragOver,
  onRewindDrop,
  onModelSelect,
  onModelReasoningEffortSelect,
  onModelReasoningModeSelect,
  onModelThinkingEnabledSelect,
  onAgentModeChange,
  pendingAuxState,
  showThinkingCollapsible: showThinkingCollapsibleEligible,
  thinkingReasoningLive,
  collapseThinkingDuringToolPreview,
  turnActionsEligible,
  inActiveStreamingTurn,
  canCopyTurn,
  onCopyTurn,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  saveLocalImageAs,
  onOpenSubagentViewer,
  onOpenReadFile,
  onOpenPlan,
  onAbortShell,
  queuedCanMoveUp = false,
  queueActionBusy = false,
  onQueueMoveUp,
  onQueueSendNow,
  onQueueDelete,
  conversationIsBusy = false,
  activeSessionReadOnly = false,
  forkBusy = false,
  onForkMessage,
  forkMenuAlwaysVisible = false,
  forkMenuHoverRevealed = false,
  workspaceRoot = "",
  assistantTurnStartIndex = null,
  onAssistantTurnPointerEnter,
  onAssistantTurnPointerLeave,
  hiddenByProcessGroup = false,
  externalRowGap = false,
}: {
  composerSessionKey: string;
  conversationListScopeKey: string;
  /** Passed only when this row's message.pending is true; live aux only concerns pending rows, preventing other rows from re-rendering with each streaming delta */
  pendingAuxState?: PendingAssistantAux;
  message: ConversationMessageSnapshot;
  listIndex: number;
  /** The derived booleans below are computed by the parent from the full messages list; this component does not hold a full-list reference so memo can short-circuit */
  showThinkingCollapsible: boolean;
  thinkingReasoningLive: boolean;
  collapseThinkingDuringToolPreview: boolean;
  turnActionsEligible: boolean;
  inActiveStreamingTurn: boolean;
  canCopyTurn: boolean;
  onCopyTurn(listIndex: number): void;
  hiddenByProcessGroup?: boolean;
  /** Removes pb-3 / negative-margin collapsing when the row gap is carried by the virtual row's paddingTop. */
  externalRowGap?: boolean;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
  showContinueButton: boolean;
  continueTarget?: ConversationMessageSnapshot;
  continueBusy: boolean;
  rewindSegments: readonly import("@/lib/composer-segment-model").RichSegment[];
  rewindLocalFileAttachments: readonly ComposerLocalFileAttachmentView[];
  rewindSelected: boolean;
  rewindCanSubmit: boolean;
  rewindBusy: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  canPickLocalFile: boolean;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: ModelRef;
  agentMode: DesktopAgentMode;
  onContinue(message: ConversationMessageSnapshot): void;
  onRewindSegmentsChange(segments: import("@/lib/composer-segment-model").RichSegment[]): void;
  onRewindStart(message: ConversationMessageSnapshot, listIndex: number): void;
  onRewindSubmit(): void;
  onRewindRemoveLocalFileAttachment(path: string): void;
  onRewindPickLocalFile(): void;
  onRewindPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onRewindDragOver(event: ReactDragEvent<HTMLElement>): void;
  onRewindDrop(event: ReactDragEvent<HTMLElement>): void;
  onModelSelect(ref: ModelRef): void;
  onModelReasoningEffortSelect(ref: ModelRef, reasoningEffort: DesktopModelReasoningEffort): void;
  onModelReasoningModeSelect?(ref: ModelRef, reasoningMode: DesktopModelReasoningMode): void;
  onModelThinkingEnabledSelect?(ref: ModelRef, enabled: boolean): void | Promise<boolean>;
  onAgentModeChange(mode: DesktopAgentMode): void;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  saveLocalImageAs: SaveLocalImageAs;
  onOpenSubagentViewer?: (toolCallId: string) => void;
  onOpenReadFile?: (target: EditorFileTarget) => void;
  onOpenPlan?: () => void;
  onAbortShell?: (toolCallId: string) => void;
  queuedCanMoveUp?: boolean;
  queueActionBusy?: boolean;
  onQueueMoveUp?(queueId: string): void;
  onQueueSendNow?(queueId: string): void;
  onQueueDelete?(queueId: string): void;
  conversationIsBusy?: boolean;
  activeSessionReadOnly?: boolean;
  forkBusy?: boolean;
  onForkMessage?: (message: ConversationMessageSnapshot, listIndex: number) => void;
  forkMenuAlwaysVisible?: boolean;
  forkMenuHoverRevealed?: boolean;
  workspaceRoot?: string;
  assistantTurnStartIndex?: number | null;
  onAssistantTurnPointerEnter?: (turnStart: number) => void;
  onAssistantTurnPointerLeave?: (event: ReactPointerEvent, turnStart: number) => void;
}) {
  const { t } = useTranslation();
  const rewindBrowserElementAttachments = useMemo(
    () => (rewindSelected ? segmentsToAttachments([...rewindSegments]) : []),
    [rewindSegments, rewindSelected],
  );
  const isUser = message.role === "user";
  const isQueuedUser = isUser && message.queued === true && typeof message.queueId === "string";
  const canStartRewind =
    isUser && message.canRewind === true && !message.pending && message.queued !== true;
  const userBubble = cn(
    "rounded-2xl rounded-br-md border border-ring/30 bg-background px-3 py-2.5 dark:border-border/50 dark:bg-muted",
    DESKTOP_ELEVATION_SHADOW_SM,
  );
  const subagentStatusSurface =
    !isUser && message.content.trim() ? isSubagentStatusSurfaceMessage(message) : false;
  const turnErrorSurface = !isUser && isTurnErrorAssistantMessage(message);
  const showThinkingCollapsible = !hiddenByProcessGroup && showThinkingCollapsibleEligible;
  const showCompactionCollapsible =
    !hiddenByProcessGroup && shouldShowAssistantCompactionCollapsible(message, pendingAuxState);
  const showTurnActions =
    !hiddenByProcessGroup &&
    !inActiveStreamingTurn &&
    (turnActionsEligible || (showContinueButton && Boolean(continueTarget)));
  const showForkMenu =
    showTurnActions &&
    canShowForkMessage({
      message,
      activeSessionReadOnly,
    });
  const canFork =
    showForkMenu &&
    canForkMessage({
      message,
      conversationBusy: conversationIsBusy,
      activeSessionReadOnly,
      forkBusy,
    });
  const canCopy = showTurnActions && canCopyTurn;
  const showActionsMenu = canCopy || showForkMenu;
  return (
    <div
      id={conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}
      data-conversation-message-id={String(message.id)}
      data-spirit-surface="message-row"
      data-spirit-message-role={message.role}
      data-spirit-message-pending={message.pending ? "true" : "false"}
      data-spirit-fork-turn-start={
        assistantTurnStartIndex === null ? undefined : assistantTurnStartIndex
      }
      onPointerEnter={
        assistantTurnStartIndex === null || !onAssistantTurnPointerEnter
          ? undefined
          : () => onAssistantTurnPointerEnter(assistantTurnStartIndex)
      }
      onPointerLeave={
        assistantTurnStartIndex === null || !onAssistantTurnPointerLeave
          ? undefined
          : (event) => onAssistantTurnPointerLeave(event, assistantTurnStartIndex)
      }
      className={cn(
        "scroll-mt-4 flex w-full",
        externalRowGap ? "pb-0" : "pb-3 last:pb-0",
        !externalRowGap && compactAfterPrevious && "-mt-4",
        !externalRowGap && tightenAfterPreviousMeta && "-mt-3",
        isUser ? "justify-end" : "justify-start",
        rewindSelected && "relative z-40",
      )}
    >
      <div
        data-spirit-surface={isUser ? "message-user" : "message-assistant"}
        className={cn(
          "min-w-0 space-y-2",
          isUser
            ? rewindSelected
              ? "ml-auto w-full max-w-[min(100%,36rem)]"
              : "max-w-[min(85%,32rem)]"
            : "w-full",
        )}
      >
        {rewindSelected && isUser ? (
          <ComposerSurface
            key={`rewind-composer-${message.id}`}
            richInputRef={rewindRichInputRef}
            segments={rewindSegments}
            onSegmentsChange={onRewindSegmentsChange}
            browserElementAttachments={rewindBrowserElementAttachments}
            onElementAttachmentsChange={() => {}}
            localFileAttachments={rewindLocalFileAttachments}
            onSubmit={onRewindSubmit}
            placeholder={t("app.typeMessage")}
            models={models}
            catalogHints={catalogHints}
            activeModel={activeModel}
            agentMode={agentMode}
            loopEnabled={false}
            onModelSelect={onModelSelect}
            onModelReasoningEffortSelect={onModelReasoningEffortSelect}
            onModelReasoningModeSelect={onModelReasoningModeSelect}
            onModelThinkingEnabledSelect={onModelThinkingEnabledSelect}
            onAgentModeChange={onAgentModeChange}
            onLoopEnabledChange={() => {}}
            canSend={rewindCanSubmit}
            busy={rewindBusy}
            showInsertButton
            canPickLocalFile={canPickLocalFile}
            onPickLocalFile={onRewindPickLocalFile}
            onRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
            onPaste={onRewindPaste}
            onDragOver={onRewindDragOver}
            onDrop={onRewindDrop}
            saveLocalImageAs={saveLocalImageAs}
          />
        ) : null}
        {showThinkingCollapsible ? (
          <AssistantThinkingCollapsible
            message={message}
            reasoningLive={thinkingReasoningLive}
            collapseDuringToolPreview={collapseThinkingDuringToolPreview}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
            localImageBaseDir={workspaceRoot}
            localImageAllowedRootDir={workspaceRoot}
          />
        ) : null}
        {showCompactionCollapsible ? (
          <AssistantCompactionCollapsible
            message={message}
            pendingAuxState={pendingAuxState}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
            localImageBaseDir={workspaceRoot}
            localImageAllowedRootDir={workspaceRoot}
          />
        ) : null}
        {isUser && !rewindSelected ? (
          isQueuedUser && message.queueId && onQueueMoveUp && onQueueSendNow && onQueueDelete ? (
            <QueuedUserMessageHoverActions
              queueId={message.queueId}
              canMoveUp={queuedCanMoveUp}
              busy={queueActionBusy}
              onMoveUp={onQueueMoveUp}
              onSendNow={onQueueSendNow}
              onDelete={onQueueDelete}
            >
              <UserMessageBubble
                message={message}
                userBubbleClassName={userBubble}
                canStartRewind={false}
                queued
                onRewindStart={() => onRewindStart(message, listIndex)}
                readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
                saveLocalImageAs={saveLocalImageAs}
              />
            </QueuedUserMessageHoverActions>
          ) : (
            <UserMessageBubble
              message={message}
              userBubbleClassName={userBubble}
              canStartRewind={canStartRewind}
              queued={message.queued === true}
              onRewindStart={() => onRewindStart(message, listIndex)}
              readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
              saveLocalImageAs={saveLocalImageAs}
            />
          )
        ) : null}
        {!isUser && message.content.trim() ? (
          turnErrorSurface ? (
            <TurnErrorMessageCard content={message.content} retry={message.aux?.turnErrorRetry} />
          ) : subagentStatusSurface ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{message.content}</p>
          ) : (
            <div data-spirit-surface="message-bubble">
              <AgentMarkdownMessage
                content={message.content}
                streaming={message.pending}
                className="font-sans"
                readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
                readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
                readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
                localImageBaseDir={workspaceRoot}
                localImageAllowedRootDir={workspaceRoot}
              />
            </div>
          )
        ) : null}
        {!isUser && message.aux?.finishTaskNotice ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {message.aux.finishTaskNotice}
          </p>
        ) : null}
        {!isUser && message.tool ? (
          <ToolCallCollapsible
            tool={message.tool}
            workspaceRoot={workspaceRoot}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            saveLocalImageAs={saveLocalImageAs}
            onOpenSubagentViewer={onOpenSubagentViewer}
            onOpenReadFile={onOpenReadFile}
            onOpenPlan={onOpenPlan}
            onAbortShell={onAbortShell}
          />
        ) : null}
        {showTurnActions ? (
          <MessageTurnActions
            showContinueButton={showContinueButton}
            continueTarget={continueTarget}
            continueBusy={continueBusy}
            onContinue={onContinue}
            canShowActionsMenu={showActionsMenu}
            canCopy={canCopy}
            copyEnabled={canCopy}
            onCopy={() => onCopyTurn(listIndex)}
            canFork={showForkMenu && Boolean(onForkMessage)}
            forkEnabled={canFork}
            forkMenuAlwaysVisible={forkMenuAlwaysVisible}
            forkMenuHoverRevealed={forkMenuHoverRevealed}
            forkBusy={forkBusy}
            onFork={() => onForkMessage?.(message, listIndex)}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Virtual-list row-level memo: streaming deltas should only re-render the rows that actually
 * changed. The precondition is that all props are reference-stable — message/pendingAuxState are
 * structurally shared by useConversationViewState, callbacks are converged into stable references
 * by ConversationList, and whole-list derived values are passed in as boolean props (this
 * component does not hold a reference to the messages array).
 */
export const MessageCard = memo(MessageCardImpl);
