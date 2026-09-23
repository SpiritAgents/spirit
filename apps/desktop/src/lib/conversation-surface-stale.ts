export type ConversationActiveSurface =
  | "conversation"
  | "settings"
  | "marketplace"
  | "automations"
  | "automation-detail";

/** Leaving the conversation surface leaves the in-memory snapshot describing the prior session. */
export function shouldMarkConversationSnapshotStale(
  activeSurface: ConversationActiveSurface,
): boolean {
  return activeSurface !== "conversation";
}

/** Safe to show conversation snapshot again once session navigation has settled on the conversation surface. */
export function shouldClearConversationSnapshotStale(input: {
  activeSurface: ConversationActiveSurface;
  sessionNavigationBusy: boolean;
  newChatBusy: boolean;
}): boolean {
  return (
    input.activeSurface === "conversation" && !input.sessionNavigationBusy && !input.newChatBusy
  );
}

/** Hide stale conversation content while reset/open is in flight after returning from another surface. */
export function shouldSuppressStaleConversation(input: {
  conversationSnapshotStale: boolean;
  activeSurface: ConversationActiveSurface;
  sessionNavigationBusy: boolean;
  newChatBusy: boolean;
}): boolean {
  return (
    input.conversationSnapshotStale &&
    input.activeSurface === "conversation" &&
    (input.sessionNavigationBusy || input.newChatBusy)
  );
}

export function resolveEffectiveEmptySession(input: {
  sessionMessageCount: number;
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive: boolean;
  newChatBusy: boolean;
}): boolean {
  if (
    input.compactionDemoActive ||
    input.longConversationListDemoActive ||
    input.subagentViewActive
  ) {
    return false;
  }
  if (input.newChatBusy || input.sessionMessageCount === 0) {
    return true;
  }
  return false;
}

/** Opening another session should not flash the prior session's message list. */
export function shouldHideStaleConversationMessages(input: {
  suppressStaleConversation: boolean;
  sessionNavigationBusy: boolean;
}): boolean {
  return input.suppressStaleConversation && input.sessionNavigationBusy;
}
