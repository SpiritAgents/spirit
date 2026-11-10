import { useLayoutEffect, useRef } from "react";

import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

function processGroupIds(renderItems: readonly ConversationRenderItem[]): string[] {
  return renderItems.filter((item) => item.kind === "process-group").map((item) => item.groupId);
}

export function isLiveComposeViewKey(viewKey: string): boolean {
  return viewKey.startsWith("__no-session__") || viewKey.startsWith("todo-scope:");
}

export function resolveProcessSealLiveTurnActive(options: {
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive?: boolean;
  isBusy?: boolean;
  busyAction?: string | null;
  pendingAuxState?: PendingAssistantAux | null;
  messages: readonly ConversationMessageSnapshot[];
}): boolean {
  if (
    options.subagentViewActive ||
    options.compactionDemoActive ||
    options.longConversationListDemoActive === true
  ) {
    return false;
  }
  if (options.busyAction === "session") {
    return false;
  }
  if (options.busyAction === "send" || options.isBusy === true) {
    return true;
  }
  if (options.pendingAuxState) {
    return true;
  }
  return options.messages.some((message) => message.pending);
}

export type ProcessSealPlanState = {
  prevViewKey: string | null;
  prevGroupIds: Set<string>;
};

export type ProcessSealAnimationPlanOptions = {
  liveTurnActive: boolean;
  composeTurnInFlight: boolean;
  sessionNavigationPending: boolean;
};

export type ProcessSealAnimationPlanResult = {
  nextState: ProcessSealPlanState;
  shouldPlayByGroupId: Map<string, boolean>;
};

export function resolveProcessSealNavigationSignals(input: {
  conversationViewKey: string;
  busyAction?: string | null;
  isBusy?: boolean;
  sessionMessages: readonly ConversationMessageSnapshot[];
  stickyComposeTurnInFlight: boolean;
}): {
  sessionNavigationPending: boolean;
  composeTurnInFlight: boolean;
  nextStickyComposeTurnInFlight: boolean;
} {
  const sessionNavigationPending = input.busyAction === "session";
  const composeTurnInFlightThisRender =
    !sessionNavigationPending &&
    isLiveComposeViewKey(input.conversationViewKey) &&
    (input.busyAction === "send" ||
      input.isBusy === true ||
      input.sessionMessages.some((message) => message.pending));

  const composeTurnInFlight =
    composeTurnInFlightThisRender || (!sessionNavigationPending && input.stickyComposeTurnInFlight);

  let nextStickyComposeTurnInFlight: boolean;
  if (sessionNavigationPending) {
    nextStickyComposeTurnInFlight = false;
  } else if (composeTurnInFlightThisRender) {
    nextStickyComposeTurnInFlight = true;
  } else if (!isLiveComposeViewKey(input.conversationViewKey)) {
    nextStickyComposeTurnInFlight = false;
  } else {
    nextStickyComposeTurnInFlight = input.stickyComposeTurnInFlight;
  }

  return {
    sessionNavigationPending,
    composeTurnInFlight,
    nextStickyComposeTurnInFlight,
  };
}

export function createInitialProcessSealPlanState(): ProcessSealPlanState {
  return { prevViewKey: null, prevGroupIds: new Set() };
}

export function buildProcessSealAnimationPlan(
  state: ProcessSealPlanState,
  conversationViewKey: string,
  groupIds: readonly string[],
  options: ProcessSealAnimationPlanOptions,
): ProcessSealAnimationPlanResult {
  const isFirstObservation = state.prevViewKey === null;
  const viewKeyChanged = !isFirstObservation && state.prevViewKey !== conversationViewKey;
  const newlyAppearedGroupIds = groupIds.filter((groupId) => !state.prevGroupIds.has(groupId));

  const shouldAnimateNewGroups = isFirstObservation
    ? false
    : viewKeyChanged
      ? !options.sessionNavigationPending && (options.liveTurnActive || options.composeTurnInFlight)
      : true;

  return {
    nextState: {
      prevViewKey: conversationViewKey,
      prevGroupIds: new Set(groupIds),
    },
    shouldPlayByGroupId: new Map(
      newlyAppearedGroupIds.map((groupId) => [groupId, shouldAnimateNewGroups]),
    ),
  };
}

function useProcessSealAnimationPlan(
  conversationViewKey: string,
  renderItems: readonly ConversationRenderItem[],
  options: ProcessSealAnimationPlanOptions,
  planResetKey?: number,
): (groupId: string) => boolean {
  const planStateRef = useRef(createInitialProcessSealPlanState());
  const planRef = useRef(new Map<string, boolean>());
  const prevPlanResetKeyRef = useRef(planResetKey ?? 0);

  if (planResetKey !== undefined && planResetKey !== prevPlanResetKeyRef.current) {
    planStateRef.current = createInitialProcessSealPlanState();
    prevPlanResetKeyRef.current = planResetKey;
  }

  const groupIds = processGroupIds(renderItems);
  const groupIdsKey = groupIds.join("|");

  const { shouldPlayByGroupId, nextState } = buildProcessSealAnimationPlan(
    planStateRef.current,
    conversationViewKey,
    groupIds,
    options,
  );
  planRef.current = shouldPlayByGroupId;

  useLayoutEffect(() => {
    planStateRef.current = nextState;
  }, [conversationViewKey, groupIdsKey]);

  return (groupId: string) => planRef.current.get(groupId) ?? false;
}

/** Returns whether a newly mounted process group should play the seal collapse animation. */
export function useProcessSealAnimationGate(input: {
  conversationViewKey: string;
  renderItems: readonly ConversationRenderItem[];
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive?: boolean;
  isBusy?: boolean;
  busyAction?: string | null;
  pendingAuxState?: PendingAssistantAux;
  sessionMessages: readonly ConversationMessageSnapshot[];
  planResetKey?: number;
}): (groupId: string) => boolean {
  const stickyComposeTurnInFlightRef = useRef(false);

  const navigationSignals = resolveProcessSealNavigationSignals({
    conversationViewKey: input.conversationViewKey,
    busyAction: input.busyAction,
    isBusy: input.isBusy,
    sessionMessages: input.sessionMessages,
    stickyComposeTurnInFlight: stickyComposeTurnInFlightRef.current,
  });

  const liveTurnActive = resolveProcessSealLiveTurnActive({
    subagentViewActive: input.subagentViewActive,
    compactionDemoActive: input.compactionDemoActive,
    longConversationListDemoActive: input.longConversationListDemoActive,
    isBusy: input.isBusy,
    busyAction: input.busyAction,
    pendingAuxState: input.pendingAuxState,
    messages: input.sessionMessages,
  });

  const shouldPlaySealAnimation = useProcessSealAnimationPlan(
    input.conversationViewKey,
    input.renderItems,
    {
      liveTurnActive,
      composeTurnInFlight: navigationSignals.composeTurnInFlight,
      sessionNavigationPending: navigationSignals.sessionNavigationPending,
    },
    input.planResetKey,
  );

  useLayoutEffect(() => {
    stickyComposeTurnInFlightRef.current = navigationSignals.nextStickyComposeTurnInFlight;
  }, [
    input.conversationViewKey,
    input.renderItems,
    navigationSignals.nextStickyComposeTurnInFlight,
  ]);

  return shouldPlaySealAnimation;
}
