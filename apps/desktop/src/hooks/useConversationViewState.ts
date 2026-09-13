import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TFunction } from "i18next";

import {
  normalizeDoodleSessionKey,
  resolveDoodle,
  resolveDoodleVariantForSession,
} from "@/lib/doodle";
import { resolveWorkspaceDisplayLabel } from "@/lib/workspace-display-label";
import { resolveConversationListScopeKey } from "@/lib/conversation-list-scope";
import { buildConversationRenderItems } from "@/lib/conversation-process-groups";
import { resolveTurnContinuePresentation } from "@/lib/conversation-continue-ui";
import { useProcessSealAnimationGate } from "@/lib/process-seal-animation";
import { resolveEffectiveEmptySession } from "@/lib/conversation-surface-stale";
import { useElementBoxHeight } from "@/hooks/use-element-box-height";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import type { useSubagentViewer } from "@/hooks/useSubagentViewer";
import type { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import type { useLongConversationListDemo } from "@/hooks/useLongConversationListDemo";
import { isSubagentToolCallPending } from "@/lib/subagent-viewer-pending";
import {
  CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX,
  CONVERSATION_SCROLL_BED_EXTRA_PX,
} from "@/lib/conversation-layout-constants";
import { normalizePaneSessionPathKey } from "@/lib/pane-desktop-snapshot";
import {
  busyActionBlocksConversationAbort,
  resolvePaneCanInterrupt,
  resolvePaneComposerBusy,
} from "@/lib/pane-conversation-controls";
import type { ConversationMessageSnapshot, DesktopSnapshot, PendingAssistantAux } from "@/types";
import {
  countVisiblePaneSessions,
  type ConversationAbortShortcutTargetRef,
} from "@/lib/conversation-abort-shortcut";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;
type SubagentViewer = ReturnType<typeof useSubagentViewer>;
type CompactionDemo = ReturnType<typeof useCompactionUiDemo>;
type LongConversationListDemo = ReturnType<typeof useLongConversationListDemo>;

/** IPC snapshot data is all JSON-derived (no function / Date / circular references); undefined fields are treated as absent */
export function jsonLikeEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) {
    return false;
  }
  if (aIsArray) {
    const arrayA = a as readonly unknown[];
    const arrayB = b as readonly unknown[];
    if (arrayA.length !== arrayB.length) {
      return false;
    }
    for (let index = 0; index < arrayA.length; index += 1) {
      if (!jsonLikeEquals(arrayA[index], arrayB[index])) {
        return false;
      }
    }
    return true;
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA).filter((key) => recordA[key] !== undefined);
  const keysB = Object.keys(recordB).filter((key) => recordB[key] !== undefined);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!jsonLikeEquals(recordA[key], recordB[key])) {
      return false;
    }
  }
  return true;
}

/**
 * When a snapshot arrives over IPC, all message objects are new references; reuse the previous
 * deeply-equal message objects positionally (reuse the whole array when nothing changed), so
 * downstream reference-comparing memos (MessageCard etc.) only re-render the rows that actually
 * changed on streaming deltas.
 */
export function stabilizeConversationMessages(
  previous: readonly ConversationMessageSnapshot[],
  next: readonly ConversationMessageSnapshot[],
): readonly ConversationMessageSnapshot[] {
  if (previous === next) {
    return next;
  }
  let allReused = previous.length === next.length;
  const merged: ConversationMessageSnapshot[] = Array.from({ length: next.length });
  for (let index = 0; index < next.length; index += 1) {
    const prevMessage = previous[index];
    const nextMessage = next[index]!;
    if (prevMessage && jsonLikeEquals(prevMessage, nextMessage)) {
      merged[index] = prevMessage;
    } else {
      merged[index] = nextMessage;
      allReused = false;
    }
  }
  return allReused ? previous : merged;
}

export type UseConversationViewStateOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  subagentViewActive: boolean;
  subagentViewer: SubagentViewer;
  compactionDemo: CompactionDemo;
  longConversationListDemo: LongConversationListDemo;
  t: TFunction;
  language: string;
  /** When true, composer interrupt/send state follows this pane snapshot, not global runtime. */
  useIsolatedPane?: boolean;
  conversationAbortShortcutTargetRef?: ConversationAbortShortcutTargetRef;
};

export function useConversationViewState({
  runtime,
  snapshot,
  subagentViewActive,
  subagentViewer,
  compactionDemo,
  longConversationListDemo,
  t,
  language,
  useIsolatedPane = false,
  conversationAbortShortcutTargetRef,
}: UseConversationViewStateOptions) {
  const models = snapshot?.config.models ?? [];
  const composerSessionKey = snapshot?.composerSessionKey ?? "";
  const workspaceDisplayLabel = useMemo(
    () =>
      resolveWorkspaceDisplayLabel(
        snapshot?.workspaceRoot ?? "",
        snapshot?.workspaceBinding ?? "project",
        snapshot?.availableWorkspaces ?? [],
      ),
    [snapshot?.availableWorkspaces, snapshot?.workspaceBinding, snapshot?.workspaceRoot, language],
  );
  const includeWorkspaceDoodleVariants = workspaceDisplayLabel !== null;
  const doodleText = useMemo(() => {
    const sessionKey = normalizeDoodleSessionKey(composerSessionKey);
    const navigationVariant = runtime.navigationDoodleVariant;
    const variantId =
      navigationVariant ??
      resolveDoodleVariantForSession(sessionKey, {
        includeWorkspaceVariants: includeWorkspaceDoodleVariants,
      });
    return resolveDoodle(t, variantId, workspaceDisplayLabel);
  }, [
    composerSessionKey,
    includeWorkspaceDoodleVariants,
    runtime.navigationDoodleVariant,
    workspaceDisplayLabel,
    t,
    language,
  ]);

  const sessionMessages = snapshot?.conversation.messages ?? [];
  const rawMessages = subagentViewActive
    ? (snapshot?.subagentViewer?.messages ?? [])
    : longConversationListDemo.active
      ? longConversationListDemo.messages
      : compactionDemo.active
        ? compactionDemo.messages
        : sessionMessages;
  // Every poll snapshot rebuilds all objects; structural sharing keeps "unchanged messages / unchanged array" reference-stable
  const stableMessagesRef = useRef<readonly ConversationMessageSnapshot[]>([]);
  const messages = useMemo(() => {
    const stabilized = stabilizeConversationMessages(stableMessagesRef.current, rawMessages);
    stableMessagesRef.current = stabilized;
    return stabilized;
  }, [rawMessages]);
  const conversationListScopeKey = resolveConversationListScopeKey({
    subagentViewActive,
    subagentToolCallId: subagentViewer.toolCallId,
    compactionDemoActive: compactionDemo.active,
    longConversationListDemoActive: longConversationListDemo.active,
  });
  const conversationRenderItems = useMemo(
    () => buildConversationRenderItems(messages, conversationListScopeKey),
    [conversationListScopeKey, messages],
  );
  const conversationViewKey = `${composerSessionKey.trim() || "__no-session__"}:${conversationListScopeKey}`;
  const processGroupManualOpenKey = useCallback(
    (groupId: string) => `${conversationViewKey}:${groupId}`,
    [conversationViewKey],
  );
  const rawPendingAuxState = subagentViewActive
    ? snapshot?.subagentViewer?.pendingAuxState
    : compactionDemo.active
      ? compactionDemo.pendingAuxState
      : snapshot?.conversation.pendingAuxState;
  const stablePendingAuxRef = useRef<PendingAssistantAux | undefined>(undefined);
  const conversationPendingAuxState = useMemo(() => {
    const previous = stablePendingAuxRef.current;
    const stabilized =
      previous && rawPendingAuxState && jsonLikeEquals(previous, rawPendingAuxState)
        ? previous
        : rawPendingAuxState;
    stablePendingAuxRef.current = stabilized;
    return stabilized;
  }, [rawPendingAuxState]);

  const [conversationListRemountEpoch, setConversationListRemountEpoch] = useState(0);
  const prevSessionMessageCountRef = useRef(sessionMessages.length);

  useEffect(() => {
    const count = sessionMessages.length;
    if (count < prevSessionMessageCountRef.current) {
      setConversationListRemountEpoch((epoch) => epoch + 1);
    }
    prevSessionMessageCountRef.current = count;
  }, [sessionMessages.length]);

  const shouldPlayProcessSealAnimation = useProcessSealAnimationGate({
    conversationViewKey,
    renderItems: conversationRenderItems,
    subagentViewActive,
    compactionDemoActive: compactionDemo.active,
    longConversationListDemoActive: longConversationListDemo.active,
    isBusy: snapshot?.conversation.isBusy,
    busyAction: useIsolatedPane
      ? snapshot?.conversation.isBusy
        ? "send"
        : ""
      : runtime.busyAction,
    pendingAuxState: conversationPendingAuxState,
    sessionMessages,
    planResetKey: conversationListRemountEpoch,
  });

  const [processGroupManualOpen, setProcessGroupManualOpen] = useState<Record<string, boolean>>({});
  const turnContinue = useMemo(
    () =>
      compactionDemo.active || longConversationListDemo.active || subagentViewActive
        ? undefined
        : resolveTurnContinuePresentation(messages),
    [compactionDemo.active, longConversationListDemo.active, messages, subagentViewActive],
  );

  const rewindWarnings = snapshot?.conversation.rewindWarnings ?? [];
  const pendingApproval = snapshot?.conversation.pendingToolApproval;
  const showPendingApprovalInComposer = Boolean(
    pendingApproval &&
    (!subagentViewActive ||
      pendingApproval.subagentSessionId === snapshot?.subagentViewer?.sessionId),
  );

  // Re-measure pre-paint on hero ↔ bottom dock layout switches; a demo injecting messages while the session is still empty also counts as non-hero.
  const composerLayoutHero = resolveEffectiveEmptySession({
    sessionMessageCount: sessionMessages.length,
    subagentViewActive,
    compactionDemoActive: compactionDemo.active,
    longConversationListDemoActive: longConversationListDemo.active,
    newSessionBusy: false,
  });
  const { ref: composerDockRef, heightPx: composerDockHeightPx } =
    useElementBoxHeight<HTMLDivElement>(composerLayoutHero);
  const conversationScrollBedPaddingPx =
    composerDockHeightPx > 0
      ? Math.max(
          CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX,
          composerDockHeightPx + CONVERSATION_SCROLL_BED_EXTRA_PX,
        )
      : CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX;
  /** Conversation scroll shape mask under translucency; written back by ComposerDock from the input/Changes/TODO outline */
  const [conversationScrollOccludeMaskStyle, setConversationScrollOccludeMaskStyle] = useState<
    CSSProperties | undefined
  >(undefined);
  const onConversationScrollOccludeMaskStyleChange = useCallback(
    (style: CSSProperties | undefined) => {
      setConversationScrollOccludeMaskStyle((prev) => {
        const prevKey = typeof prev?.maskImage === "string" ? prev.maskImage : "";
        const nextKey = typeof style?.maskImage === "string" ? style.maskImage : "";
        return prevKey === nextKey ? prev : style;
      });
    },
    [],
  );

  const panePendingQuestions = snapshot?.conversation.pendingQuestions ?? null;
  const pendingQuestions = useIsolatedPane ? panePendingQuestions : runtime.pendingQuestions;
  const showPendingQuestionsInComposer = useIsolatedPane
    ? Boolean(panePendingQuestions)
    : Boolean(pendingQuestions);

  const activeSessionReadOnly = snapshot?.activeSession?.readOnly === true;
  const paneSessionPathKey = normalizePaneSessionPathKey(
    snapshot?.activeSession?.filePath ?? composerSessionKey,
  );
  const paneSendBusy =
    useIsolatedPane &&
    Boolean(paneSessionPathKey) &&
    runtime.paneSendBusySessionPath === paneSessionPathKey;
  const conversationInterruptible = useIsolatedPane
    ? resolvePaneCanInterrupt(snapshot)
    : runtime.summary.canInterrupt && !busyActionBlocksConversationAbort(runtime.busyAction);
  const continueBusy = useIsolatedPane
    ? resolvePaneComposerBusy(snapshot, paneSendBusy)
    : Boolean(runtime.busyAction) || snapshot?.conversation.isBusy === true;
  const conversationAbortShortcutEligible = conversationInterruptible && !activeSessionReadOnly;
  const conversationAbortShortcutEligibleRef = useRef(false);
  conversationAbortShortcutEligibleRef.current = conversationAbortShortcutEligible;

  useEffect(() => {
    if (!conversationAbortShortcutTargetRef) {
      return;
    }
    if (countVisiblePaneSessions(snapshot) > 1) {
      return;
    }
    conversationAbortShortcutTargetRef.current = {
      eligible: conversationAbortShortcutEligible,
    };
  }, [conversationAbortShortcutEligible, conversationAbortShortcutTargetRef, snapshot]);

  const startImplementingDisabled =
    !snapshot?.runtimeReady ||
    activeSessionReadOnly ||
    runtime.busyAction === "session" ||
    Boolean(pendingApproval) ||
    Boolean(pendingQuestions) ||
    (useIsolatedPane
      ? snapshot?.conversation.isBusy === true && !conversationInterruptible
      : runtime.busyAction === "send" && !conversationInterruptible);

  const previousComposerSessionKeyRef = useRef(composerSessionKey);

  useEffect(() => {
    if (previousComposerSessionKeyRef.current !== composerSessionKey) {
      previousComposerSessionKeyRef.current = composerSessionKey;
      if (subagentViewer.active) {
        void subagentViewer.close();
      }
    }
  }, [composerSessionKey, subagentViewer]);

  useEffect(() => {
    if (subagentViewer.active && !snapshot?.subagentViewer) {
      const toolCallId = subagentViewer.toolCallId;
      const stillStarting = toolCallId
        ? isSubagentToolCallPending(snapshot?.conversation.messages ?? [], toolCallId)
        : false;
      if (stillStarting) {
        return;
      }
      void subagentViewer.close();
    }
  }, [snapshot?.conversation.messages, snapshot?.subagentViewer, subagentViewer]);

  const handleOpenSubagentViewer = useCallback(
    (toolCallId: string) => {
      compactionDemo.stop();
      longConversationListDemo.stop();
      void subagentViewer.open(toolCallId);
    },
    [compactionDemo, longConversationListDemo, subagentViewer],
  );

  return {
    models,
    composerSessionKey,
    sessionMessages,
    messages,
    conversationListScopeKey,
    conversationRenderItems,
    conversationViewKey,
    processGroupManualOpenKey,
    conversationPendingAuxState,
    conversationListRemountEpoch,
    shouldPlayProcessSealAnimation,
    processGroupManualOpen,
    setProcessGroupManualOpen,
    turnContinue,
    rewindWarnings,
    pendingApproval,
    showPendingApprovalInComposer,
    composerDockRef,
    conversationScrollBedPaddingPx,
    conversationScrollOccludeMaskStyle,
    onConversationScrollOccludeMaskStyleChange,
    pendingQuestions,
    showPendingQuestionsInComposer,
    activeSessionReadOnly,
    conversationInterruptible,
    continueBusy,
    conversationAbortShortcutEligibleRef,
    startImplementingDisabled,
    doodleText,
    handleOpenSubagentViewer,
  };
}
