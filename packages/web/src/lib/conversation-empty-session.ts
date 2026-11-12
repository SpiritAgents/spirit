export function resolveEffectiveEmptySession(input: {
  sessionMessageCount: number;
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive: boolean;
  approvalPreviewDemoActive: boolean;
  toolCardPreviewDemoActive: boolean;
  newChatBusy: boolean;
}): boolean {
  if (
    input.compactionDemoActive ||
    input.longConversationListDemoActive ||
    input.approvalPreviewDemoActive ||
    input.toolCardPreviewDemoActive ||
    input.subagentViewActive
  ) {
    return false;
  }
  if (input.newChatBusy || input.sessionMessageCount === 0) {
    return true;
  }
  return false;
}
