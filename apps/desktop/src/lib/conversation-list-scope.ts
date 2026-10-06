import type { ConversationMessageSnapshot } from "@/types";

/** Which message source is rendered in the conversation column (keys must not collide across sources). */
export function resolveConversationListScopeKey(input: {
  subagentViewActive: boolean;
  subagentToolCallId: string | null;
  compactionDemoActive: boolean;
  longConversationListDemoActive: boolean;
  approvalPreviewDemoActive: boolean;
}): string {
  if (input.subagentViewActive && input.subagentToolCallId) {
    return `subagent:${input.subagentToolCallId}`;
  }
  if (input.compactionDemoActive) {
    return "compaction-demo";
  }
  if (input.longConversationListDemoActive) {
    return "long-list-demo";
  }
  if (input.approvalPreviewDemoActive) {
    return "approval-preview-demo";
  }
  return "main";
}

/** Stable list identity — must not include list index (rows insert above tools during finalize-thinking). */
export function conversationMessageStableId(
  message: ConversationMessageSnapshot,
  composerSessionKey = "",
  listScopeKey = "main",
): string {
  const sessionPart = composerSessionKey.trim() ? `${composerSessionKey.trim()}:` : "";
  const scopePart = `${listScopeKey}:`;
  const toolPart =
    message.tool?.toolCallId ??
    (message.tool ? `${message.tool.toolName}:${message.tool.phase}` : "");
  return `${sessionPart}${scopePart}message-${message.id}-${message.pending ? "p" : "m"}-${toolPart}`;
}
