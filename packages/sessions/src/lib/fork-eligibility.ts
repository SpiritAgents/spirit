import type { ConversationMessageSnapshot } from "@/types";

function isForkableAssistantMessage(message: ConversationMessageSnapshot): boolean {
  return (
    message.role === "assistant" &&
    !message.pending &&
    Boolean(
      message.content.trim() ||
      message.tool ||
      message.aux?.thinking?.trim() ||
      message.aux?.compaction?.trim(),
    )
  );
}

export type ForkMessageEligibilityInput = {
  message: ConversationMessageSnapshot;
  conversationBusy: boolean;
  activeSessionReadOnly: boolean;
  forkBusy: boolean;
};

export type ForkSessionEligibilityInput = {
  conversationBusy: boolean;
  activeSessionReadOnly: boolean;
  forkBusy: boolean;
  hasForkableAssistantMessage: boolean;
};

export function canShowForkMessage({
  message,
  activeSessionReadOnly,
}: Pick<ForkMessageEligibilityInput, "message" | "activeSessionReadOnly">): boolean {
  if (activeSessionReadOnly) {
    return false;
  }
  return isForkableAssistantMessage(message);
}

export function canForkMessage({
  message,
  conversationBusy,
  activeSessionReadOnly,
  forkBusy,
}: ForkMessageEligibilityInput): boolean {
  if (!canShowForkMessage({ message, activeSessionReadOnly })) {
    return false;
  }
  if (forkBusy || conversationBusy) {
    return false;
  }
  return true;
}

export type SideChatEligibilityInput = ForkSessionEligibilityInput & {
  sideChatBusy: boolean;
};

export function canForkSession({
  conversationBusy,
  activeSessionReadOnly,
  forkBusy,
  hasForkableAssistantMessage,
}: ForkSessionEligibilityInput): boolean {
  if (activeSessionReadOnly || forkBusy || conversationBusy) {
    return false;
  }
  return hasForkableAssistantMessage;
}

export function canBeginSideChat({
  sideChatBusy,
  ...forkInput
}: SideChatEligibilityInput): boolean {
  if (sideChatBusy) {
    return false;
  }
  return canForkSession(forkInput);
}
