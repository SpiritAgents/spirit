import path from "node:path";

import type {
  LlmActiveSkill,
  PendingWorkspaceFile,
  RuntimeApprovalDecision,
  RuntimeEvent,
} from "@spiritagent/agent-core";
import { cloneActiveSkills } from "./runtime.js";

import i18n from "../lib/i18n-host.js";
import type {
  AskQuestionsResult,
  ConversationMessageSnapshot,
  DesktopApprovalDecision,
  DesktopSnapshot,
} from "../types.js";
import type { DesktopToolRequest } from "./contracts.js";
import type { DesktopHostRuntime } from "./runtime.js";
import type { SessionBundle } from "./session-bundle.js";
import { spreadChipNavigateMeta } from "../lib/composer-chip-navigate-meta.js";
import type { ComposerChipNavigateMeta } from "../lib/composer-chip-navigate-meta.js";
import { toolMessageKey } from "./message-ordering.js";
import {
  runtimeEventsIncludeAppliedResponsesBuiltInToolPreview,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
  splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview,
} from "./runtime-event-orchestrator.js";
import {
  canDrainQueuedUserTurn,
  explicitWorkspaceFilesFromQueuedItem,
  turnSkillsFromQueuedItem,
  findQueuedUserTurnIndex,
  isSessionBundleQueueBlocked,
  shiftNextQueuedUserTurn,
} from "./message-queue.js";
import {
  isSessionBundleBusy,
  shouldUseComposerDirectMediaTurn,
  startComposerDirectMediaTurn,
} from "./direct-media-turn.js";
import { syncSubagentConversationProjections } from "./subagent-conversation-projection.js";
import { toRuntimeAskQuestionsResult } from "./service-utils.js";
import {
  advancePendingWorktreeBootstrapCommand,
  abortPendingWorktreeBootstrap,
  shouldAdvanceWorktreeBootstrap,
  type WorktreeBootstrapHostContext,
} from "./worktree-bootstrap-orchestrator.js";

type RuntimeEventsFacade = {
  applyRuntimeHostEvents(events: RuntimeEvent<DesktopToolRequest>[]): void;
  finalizeInterruptedDeferredThinking(input?: {
    thinkingText?: string;
    compactionText?: string;
  }): void;
  consumeCompletedTurnResult(): boolean;
  syncPendingToolStates(): void;
  syncAssistantPrefixFromHistoryBeforeToolRow(): void;
  clearTurnErrorRetryState(): void;
};

type AssistantMessagesFacade = {
  handleMessageRemoved(index: number, messageId: number, reason: string): void;
};

type TurnOrchestration = {
  runtimeEvents: RuntimeEventsFacade;
  assistantMessages: AssistantMessagesFacade;
};

export interface SubmitUserTurnAfterInitializedOptions {
  startImplementing?: boolean;
  preserveRewindWarnings?: boolean;
  displayText?: string;
  turnSkills?: LlmActiveSkill[];
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  /** Reuse message id from a queued turn when draining the queue. */
  preallocatedMessageId?: number;
  /** Target bundle; defaults to the foreground active one. Queue drains must pass the queue's owning bundle to prevent cross-session leakage. */
  bundle?: SessionBundle;
  chipNavigateMeta?: ComposerChipNavigateMeta[];
}

export interface SessionTurnOrchestratorContext {
  runSerialized<T>(work: () => Promise<T>, label?: string): Promise<T>;
  ensureInitialized(
    workspaceRootOverride?: string,
    options?: { fastPath?: boolean },
  ): Promise<void>;
  requireRuntime(): DesktopHostRuntime;
  requireState(): { workspaceRoot: string };
  requireConfig(): import("./storage.js").DesktopConfigFile;
  resolveApiKeyForConfigModel(model: import("../types.js").ModelRef): Promise<string | undefined>;
  activeBundle(): SessionBundle;
  allBundles(): Iterable<SessionBundle>;
  bundleNeedsRuntimeProjection(bundle: SessionBundle): boolean;
  getActiveBundle(): SessionBundle | undefined;
  activeSessionId(): string | undefined;
  emitLiveSnapshotUpdate(): void;
  /** Throttled live snapshot push (sole outlet for streaming changes; host-side 33ms leading+trailing). */
  requestLiveSnapshotEmit(): void;
  notifySessionListUpdated(): void;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  syncActiveRuntimePointer(): void;
  clearAssistantContinuationMarkers(bundle?: SessionBundle): void;
  resolveTodoSessionKeyForBundle(bundle: SessionBundle): string;
  ensureActiveSession(displayText: string, bundle?: SessionBundle): void;
  prepareSessionTitleForFirstUserTurn(displayText: string, bundle?: SessionBundle): void;
  reconcileTodoScopeAfterSessionPathChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void>;
  maybeRefreshRuntimeAfterTodoScopeChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void>;
  buildRewindCheckpointSnapshot(bundle?: SessionBundle): Promise<unknown>;
  allocateMessageId(bundle?: SessionBundle): number;
  resetStreamingPlacementState(full: boolean, bundle?: SessionBundle): void;
  persistCurrentSessionIfNeeded(bundle?: SessionBundle): Promise<void>;
  dispatchUserMessageExtensionEvent(
    text: string,
    displayText: string,
    messageId: number,
  ): Promise<void>;
  ensureToolExecutor(bundle?: SessionBundle): Promise<unknown>;
  refreshArchiveFromRuntime(bundle?: SessionBundle): void;
  recordRewindCheckpoint(
    messageId: number,
    beforeUserCheckpoint?: unknown,
    bundle?: SessionBundle,
  ): Promise<void>;
  orchestrationFor(bundle: SessionBundle): TurnOrchestration;
  rebuildMessageTimelineFromMessages(bundle?: SessionBundle): void;
  flushDeferredRuntimeRefreshIfIdle(bundle?: SessionBundle): Promise<void>;
  refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void>;
  buildSnapshot(): DesktopSnapshot;
  startDreamCollectorIfNeeded(): void;
  persistSessionBundle(
    bundle: SessionBundle,
    options: { fromRuntime?: DesktopHostRuntime; bumpListSortAt?: boolean },
  ): Promise<void>;
  syncSubagentToolStreamingOutput(bundle: SessionBundle): void;
  markInterruptedToolsInCurrentTurn(): void;
  markAssistantMessageContinuable(content: string): void;
  markLatestRenderableAssistantMessageContinuableInCurrentTurn(): void;
  latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined;
  insertUserApprovalReplyMessage(content: string, pendingToolCallId?: string): void;
  normalizeApprovalDecision(decision: DesktopApprovalDecision | undefined): RuntimeApprovalDecision;
  runSessionEndForActive?(
    reason: import("@spiritagent/agent-core").SessionEndHookInput["reason"],
  ): Promise<void>;
  worktreeBootstrapHost?: WorktreeBootstrapHostContext;
}

export async function submitUserTurnAfterInitializedCommand(
  ctx: SessionTurnOrchestratorContext,
  text: string,
  options: SubmitUserTurnAfterInitializedOptions = {},
): Promise<DesktopSnapshot> {
  const bundle = options.bundle ?? ctx.activeBundle();
  const trimmed = text.trim();
  const explicitWorkspaceFiles = options.explicitWorkspaceFiles ?? [];
  const displayText = (options.displayText ?? defaultDisplayTextForUserTurn(text)).trim();
  if (!trimmed && explicitWorkspaceFiles.length === 0) {
    throw new Error(i18n.t("error.messageRequired"));
  }

  const turnSkills = cloneActiveSkills(options.turnSkills ?? []);
  bundle.currentTurnSkills = turnSkills;
  if (!bundle.runtime) {
    await ctx.refreshRuntimeForBundle(bundle);
    ctx.syncActiveRuntimePointer();
  }

  ctx.requireState();
  if (bundle.activeSession?.readOnly) {
    throw new Error(i18n.t("error.readonlySessionSend"));
  }
  if (!options.preserveRewindWarnings) {
    bundle.rewindWarnings = [];
  }
  ctx.clearAssistantContinuationMarkers(bundle);
  const todoSessionKeyBeforeEnsure = ctx.resolveTodoSessionKeyForBundle(bundle);
  ctx.ensureActiveSession(displayText, bundle);
  ctx.prepareSessionTitleForFirstUserTurn(displayText, bundle);
  await ctx.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforeEnsure);
  await ctx.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforeEnsure);
  const beforeUserCheckpoint = await ctx.buildRewindCheckpointSnapshot(bundle);
  const localFileAttachments =
    explicitWorkspaceFiles.length > 0
      ? pendingWorkspaceFilesToAttachmentSnapshots(explicitWorkspaceFiles)
      : undefined;
  const userMessage: ConversationMessageSnapshot = {
    id: options.preallocatedMessageId ?? ctx.allocateMessageId(bundle),
    role: "user",
    content: displayText,
    pending: false,
    ...(localFileAttachments ? { localFileAttachments } : {}),
    ...spreadChipNavigateMeta(options.chipNavigateMeta),
  };
  bundle.messages.push(userMessage);
  bundle.messageTimeline.beginUserTurn(userMessage.content, {
    messageId: userMessage.id,
    ...(localFileAttachments ? { localFileAttachments } : {}),
    ...spreadChipNavigateMeta(options.chipNavigateMeta),
  });
  ctx.resetStreamingPlacementState(false, bundle);
  const todoSessionKeyBeforePersist = ctx.resolveTodoSessionKeyForBundle(bundle);
  await ctx.persistCurrentSessionIfNeeded(bundle);
  await ctx.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforePersist);
  await ctx.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforePersist);
  await ctx.dispatchUserMessageExtensionEvent(trimmed, displayText, userMessage.id);

  const config = ctx.requireConfig();
  const directMediaTool = shouldUseComposerDirectMediaTurn(
    config,
    config.activeModel,
    explicitWorkspaceFiles.length,
  );

  if (directMediaTool && trimmed && !options.startImplementing) {
    try {
      await startComposerDirectMediaTurn(ctx, {
        bundle,
        toolName: directMediaTool,
        prompt: trimmed,
        userMessageId: userMessage.id,
        beforeUserCheckpoint,
      });
    } catch (error) {
      bundle.currentTurnSkills = [];
      ctx
        .orchestrationFor(bundle)
        .assistantMessages.handleMessageRemoved(
          bundle.messages.length - 1,
          userMessage.id,
          "send-user-rollback",
        );
      bundle.messages.pop();
      ctx.rebuildMessageTimelineFromMessages(bundle);
      throw error;
    }
    return ctx.buildSnapshot();
  }

  // Re-resolve after promote/persist may have replaced bundle.runtime (todo scope refresh).
  const runtime = bundle.runtime;
  if (!runtime) {
    throw new Error(i18n.t("error.runtimeNotReady"));
  }
  try {
    if (options.startImplementing) await runtime.startImplementing();
    else await runtime.startUserTurnStreaming(trimmed, [], explicitWorkspaceFiles, turnSkills);
    ctx.refreshArchiveFromRuntime(bundle);
    await ctx.recordRewindCheckpoint(userMessage.id, beforeUserCheckpoint, bundle);
    await runtime.poll();
    applyDrainedRuntimeHostEvents(ctx, bundle, runtime.drainEvents());
  } catch (error) {
    bundle.currentTurnSkills = [];
    ctx
      .orchestrationFor(bundle)
      .assistantMessages.handleMessageRemoved(
        bundle.messages.length - 1,
        userMessage.id,
        "send-user-rollback",
      );
    bundle.messages.pop();
    ctx.rebuildMessageTimelineFromMessages(bundle);
    throw error;
  }

  const orchestration = ctx.orchestrationFor(bundle);
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  await ctx.refreshTodoSnapshotForBundle(bundle);
  await drainQueuedUserTurnIfIdle(ctx, bundle);
  return ctx.buildSnapshot();
}

export async function sendQueuedUserTurnNowCommand(
  ctx: SessionTurnOrchestratorContext,
  queueId: string,
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  const index = findQueuedUserTurnIndex(bundle, queueId);
  if (index < 0) {
    throw new Error(i18n.t("error.queuedUserTurnNotFound"));
  }
  if (bundle.activeSession?.readOnly === true) {
    throw new Error(i18n.t("error.readonlySessionSend"));
  }
  if (isSessionBundleQueueBlocked(bundle)) {
    throw new Error(i18n.t("error.pendingApprovalSend"));
  }

  const item = bundle.queuedUserTurns[index];
  if (!item) {
    throw new Error(i18n.t("error.queuedUserTurnNotFound"));
  }

  if (isSessionBundleBusy(bundle)) {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    await abortConversationInContext(ctx);
  }

  bundle.queuedUserTurns.splice(index, 1);
  try {
    return await submitUserTurnAfterInitializedCommand(ctx, item.text, {
      displayText: item.displayText,
      preallocatedMessageId: item.messageId,
      explicitWorkspaceFiles: explicitWorkspaceFilesFromQueuedItem(item),
      turnSkills: turnSkillsFromQueuedItem(item),
      chipNavigateMeta: item.chipNavigateMeta,
      bundle,
    });
  } catch (error) {
    bundle.queuedUserTurns.splice(index, 0, item);
    await ctx.persistCurrentSessionIfNeeded(bundle);
    throw error;
  }
}

export async function drainQueuedUserTurnIfIdle(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
): Promise<void> {
  if (!canDrainQueuedUserTurn(bundle)) {
    return;
  }
  const next = shiftNextQueuedUserTurn(bundle);
  if (!next) {
    return;
  }
  try {
    await submitUserTurnAfterInitializedCommand(ctx, next.text, {
      displayText: next.displayText,
      preallocatedMessageId: next.messageId,
      explicitWorkspaceFiles: explicitWorkspaceFilesFromQueuedItem(next),
      turnSkills: turnSkillsFromQueuedItem(next),
      chipNavigateMeta: next.chipNavigateMeta,
      // Draining also happens when a background bundle goes busy→idle: must commit to the queue's owning bundle, not the foreground active one
      bundle,
    });
  } catch (error) {
    bundle.queuedUserTurns.unshift(next);
    await ctx.persistCurrentSessionIfNeeded(bundle);
    throw error;
  }
}

/** Body of a single pump tick (caller must already hold the runSerialized lock): advances all busy sessions and syncs host state. */
async function runSessionsPumpTick(ctx: SessionTurnOrchestratorContext): Promise<void> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const fullyTicked = new Set<SessionBundle>();
  for (const bundle of ctx.allBundles()) {
    if (
      bundle.runtime?.isBusy() ||
      shouldAdvanceWorktreeBootstrap(bundle) ||
      ctx.bundleNeedsRuntimeProjection(bundle)
    ) {
      await tickSessionCommand(ctx, bundle);
      fullyTicked.add(bundle);
    }
  }
  const active = ctx.getActiveBundle();
  if (active && !fullyTicked.has(active) && !active.runtime?.isBusy()) {
    await tickSessionCommand(ctx, active, { light: true });
  }
  ctx.syncActiveRuntimePointer();
  ctx.startDreamCollectorIfNeeded();
}

/** Called by SessionPump every tick: same body as pollCommand, but does not build a snapshot. */
export async function pumpSessionsCommand(ctx: SessionTurnOrchestratorContext): Promise<void> {
  return ctx.runSerialized(() => runSessionsPumpTick(ctx), "pump-tick");
}

export async function pollCommand(ctx: SessionTurnOrchestratorContext): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await runSessionsPumpTick(ctx);
    return ctx.buildSnapshot();
  }, "poll");
}

/** Minimum interval for tick persistence while busy; turn end states and entering a block are exempt. */
export const TICK_SESSION_PERSIST_INTERVAL_MS = 1_000;

function isRuntimeBlocked(bundle: SessionBundle): boolean {
  return Boolean(
    bundle.runtime?.currentPendingApproval() || bundle.runtime?.currentPendingQuestions(),
  );
}

export async function tickSessionCommand(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
  options: { light?: boolean } = {},
): Promise<void> {
  if (ctx.worktreeBootstrapHost && shouldAdvanceWorktreeBootstrap(bundle)) {
    await advancePendingWorktreeBootstrapCommand(ctx, ctx.worktreeBootstrapHost, bundle);
  }

  const orchestration = ctx.orchestrationFor(bundle);
  const wasBusy = bundle.runtime?.isBusy() === true;
  const wasBlocked = isRuntimeBlocked(bundle);
  let changed = false;
  if (bundle.runtime) {
    bundle.runtime.tickThinkingSpinner();
    changed = syncSubagentConversationProjections(bundle, bundle.runtime) || changed;
    if (!options.light) {
      await bundle.runtime.poll();
      changed = syncSubagentConversationProjections(bundle, bundle.runtime) || changed;
      changed = applyDrainedRuntimeHostEvents(ctx, bundle, bundle.runtime.drainEvents()) || changed;
    } else {
      const drained = bundle.runtime.drainEvents();
      if (drained.length > 0 || bundle.deferredRuntimeHostEvents.length > 0) {
        changed = applyDrainedRuntimeHostEvents(ctx, bundle, drained) || changed;
      }
    }
  } else if (options.light && bundle.deferredRuntimeHostEvents.length > 0) {
    changed = applyDrainedRuntimeHostEvents(ctx, bundle, []) || changed;
  }
  if (options.light) {
    if (changed) {
      ctx.requestLiveSnapshotEmit();
    }
    await drainQueuedUserTurnIfIdle(ctx, bundle);
    return;
  }
  const consumedTurnResult = orchestration.runtimeEvents.consumeCompletedTurnResult();
  bundle.messages = bundle.messageTimeline.toMessages();
  if (consumedTurnResult) {
    bundle.conversationRevision += 1;
    changed = true;
  }
  if (changed) {
    ctx.requestLiveSnapshotEmit();
  }
  orchestration.runtimeEvents.syncPendingToolStates();
  ctx.syncSubagentToolStreamingOutput(bundle);
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  // Persist on time slices while busy; force persistence on turn end (busy→idle) and when entering an approval/question block, keeping persistence semantics unchanged.
  const busyAfterTick = bundle.runtime?.isBusy() === true;
  const blockedAfterTick = isRuntimeBlocked(bundle);
  const forcePersist =
    (wasBusy && !busyAfterTick) || (blockedAfterTick && !wasBlocked) || consumedTurnResult;
  const persistDue =
    Date.now() - (bundle.lastTickPersistAtMs ?? 0) >= TICK_SESSION_PERSIST_INTERVAL_MS;
  if (forcePersist || persistDue) {
    await ctx.persistSessionBundle(bundle, {
      fromRuntime: bundle.runtime,
      bumpListSortAt: false,
    });
    bundle.lastTickPersistAtMs = Date.now();
  }
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  // The TODO snapshot is refreshed only by the onTodoStoreMutated callback (see the service.ts todoItemsWriter hook); ticks no longer poll it
  await drainQueuedUserTurnIfIdle(ctx, bundle);
}

export async function abortConversationInContext(
  ctx: SessionTurnOrchestratorContext,
): Promise<boolean> {
  const bundle = ctx.activeBundle();
  if (
    ctx.worktreeBootstrapHost &&
    abortPendingWorktreeBootstrap(ctx, ctx.worktreeBootstrapHost, bundle)
  ) {
    return true;
  }

  const runtime = ctx.requireRuntime();
  const interruptedAssistantText = runtime.pendingAssistantText().trim();
  const interruptedThinkingText = runtime.thinkingText().trim();
  const interruptedCompactionText = runtime.compactionText().trim();
  const interruptedAssistantAuxText = interruptedThinkingText || interruptedCompactionText;
  const interruptible =
    runtime.isBusy() && !runtime.currentPendingApproval() && !runtime.currentPendingQuestions();

  if (!interruptible) {
    return false;
  }

  runtime.abort();
  ctx.activeBundle().currentTurnSkills = [];
  const orchestration = ctx.orchestrationFor(ctx.activeBundle());
  orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
  orchestration.runtimeEvents.clearTurnErrorRetryState();
  orchestration.runtimeEvents.finalizeInterruptedDeferredThinking({
    thinkingText: interruptedThinkingText,
    compactionText: interruptedCompactionText,
  });
  ctx.activeBundle().messageTimeline.abortActiveAssistantSegment();
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  ctx.markInterruptedToolsInCurrentTurn();
  if (interruptedAssistantText || interruptedAssistantAuxText) {
    ctx.markAssistantMessageContinuable(interruptedAssistantText);
  } else {
    ctx.markLatestRenderableAssistantMessageContinuableInCurrentTurn();
  }
  await ctx.persistCurrentSessionIfNeeded();
  await ctx.flushDeferredRuntimeRefreshIfIdle();
  return true;
}

export async function abortConversationCommand(
  ctx: SessionTurnOrchestratorContext,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const aborted = await abortConversationInContext(ctx);
    if (aborted) {
      await ctx.runSessionEndForActive?.("abort");
    }
    await drainQueuedUserTurnIfIdle(ctx, ctx.activeBundle());
    return ctx.buildSnapshot();
  });
}

export async function continueAssistantCompletionCommand(
  ctx: SessionTurnOrchestratorContext,
  messageId: number,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }
    if (!Number.isFinite(messageId)) {
      throw new Error(i18n.t("error.invalidMessageId"));
    }

    ctx.requireState();
    if (ctx.activeBundle().activeSession?.readOnly) {
      throw new Error(i18n.t("error.readonlySessionContinue"));
    }

    const continuable = ctx.latestContinuableAssistantMessage();
    if (!continuable || continuable.id !== messageId) {
      throw new Error(i18n.t("error.messageNotContinuable"));
    }

    const previousContinuationIds = ctx
      .activeBundle()
      .messages.filter((message) => message.canContinue === true)
      .map((message) => message.id);
    try {
      ctx.clearAssistantContinuationMarkers();
      ctx.resetStreamingPlacementState(false);
      await ctx.persistCurrentSessionIfNeeded();
      ctx.activeBundle().nextTimelineAssistantSegmentKind = "continuation";
      await runtime.continueAssistantCompletionStreaming();
    } catch (error) {
      ctx.activeBundle().nextTimelineAssistantSegmentKind = "initial";
      for (const message of ctx.activeBundle().messages) {
        if (previousContinuationIds.includes(message.id)) {
          message.canContinue = true;
        }
      }
      throw error;
    }
    ctx.refreshArchiveFromRuntime();
    await runtime.poll();
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export async function replyPendingApprovalCommand(
  ctx: SessionTurnOrchestratorContext,
  decision: DesktopApprovalDecision,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    const pendingApproval = runtime.currentPendingApproval();
    const runtimeDecision = ctx.normalizeApprovalDecision(decision);
    if (runtimeDecision.kind === "guidance" && runtimeDecision.userMessage.trim()) {
      ctx.insertUserApprovalReplyMessage(
        runtimeDecision.userMessage.trim(),
        pendingApproval ? toolMessageKey(pendingApproval) : undefined,
      );
      ctx.resetStreamingPlacementState(false);
    }
    await runtime.continuePendingApproval(runtimeDecision);
    await runtime.poll();
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    ctx.activeBundle().messages = ctx.activeBundle().messageTimeline.toMessages();
    ctx.emitLiveSnapshotUpdate();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export async function replyPendingQuestionsCommand(
  ctx: SessionTurnOrchestratorContext,
  result: AskQuestionsResult,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    await runtime.continuePendingQuestions(toRuntimeAskQuestionsResult(result));
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.persistCurrentSessionIfNeeded();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

/** @returns Whether an event was applied (lets the tick decide whether to request a throttled push). */
export function applyDrainedRuntimeHostEvents(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
  drained: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  const orchestration = ctx.orchestrationFor(bundle);
  const queued = [...bundle.deferredRuntimeHostEvents, ...drained];
  bundle.deferredRuntimeHostEvents = [];
  const splitFinish = splitRuntimeEventsForIncrementalFinishTaskPreview(queued);
  const splitBuiltin = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(
    splitFinish.toApply,
    bundle.responsesBuiltInPreviewSeenCallIds,
  );
  bundle.deferredRuntimeHostEvents = [...splitFinish.deferred, ...splitBuiltin.deferred];
  orchestration.runtimeEvents.applyRuntimeHostEvents(splitBuiltin.toApply);
  for (const event of splitBuiltin.toApply) {
    if (
      event.kind === "streaming-tool-preview" &&
      runtimeEventsIncludeAppliedResponsesBuiltInToolPreview([event])
    ) {
      bundle.responsesBuiltInPreviewSeenCallIds.add(event.toolCallId);
    }
  }
  bundle.messages = bundle.messageTimeline.toMessages();
  if (splitBuiltin.toApply.length === 0) {
    return false;
  }
  bundle.conversationRevision += 1;
  return true;
}

function defaultDisplayTextForUserTurn(text: string): string {
  return text.trim();
}

function pendingWorkspaceFilesToAttachmentSnapshots(
  files: readonly PendingWorkspaceFile[],
): ConversationMessageSnapshot["localFileAttachments"] {
  return files.map((file) => ({
    path: file.path,
    name: path.basename(file.path),
    isImage: file.kind === "image",
  }));
}
