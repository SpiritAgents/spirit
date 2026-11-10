import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import {
  conversationRenderItemGapBeforePx,
  shouldCompactAfterPreviousRenderItem,
  shouldTightenAfterPreviousRenderItem,
} from "@/lib/message-card-spacing";
import type { ConversationMessageSnapshot } from "@/types";

// Estimate error = virtual-core first-measure compensation = the perceptible jump when scrolling
// up manually (the compensation writes scrollTop synchronously while row positions update
// asynchronously through React, so a missed frame shows up as a jump), so estimates must stay
// close to measured values: process-group is measured in the collapsed state (the expanded state
// is covered by the measured-size cache); numbers come from long-session demo measurements.
// The message-row body estimate excludes pb-3: virtual row spacing is carried by paddingTop, and
// MessageCard uses externalRowGap.
const PROCESS_GROUP_BODY_ESTIMATE_PX = 20;
const USER_MESSAGE_BODY_ESTIMATE_PX = 56;
const TOOL_MESSAGE_BODY_ESTIMATE_PX = 40;
const ASSISTANT_BODY_ESTIMATE_PX = 241;
const ASSISTANT_META_BODY_ESTIMATE_PX = 80;
const FALLBACK_BODY_ESTIMATE_PX = 120;

function gapBeforePxForRenderIndex(
  index: number,
  items: readonly ConversationRenderItem[],
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): number {
  const previousItem = items[index - 1];
  const message = messages[messageIndex];
  if (!message) {
    return 0;
  }
  return conversationRenderItemGapBeforePx({
    isFirst: index === 0,
    compactAfterPrevious: shouldCompactAfterPreviousRenderItem(previousItem, message, messages),
    tightenAfterPreviousMeta: shouldTightenAfterPreviousRenderItem(
      previousItem,
      message,
      messages,
      messageIndex,
    ),
  });
}

function bodyEstimateForMessage(message: ConversationMessageSnapshot): number {
  if (message.role === "user") {
    return USER_MESSAGE_BODY_ESTIMATE_PX;
  }
  if (message.tool) {
    return TOOL_MESSAGE_BODY_ESTIMATE_PX;
  }
  if (message.content.trim()) {
    return ASSISTANT_BODY_ESTIMATE_PX;
  }
  return ASSISTANT_META_BODY_ESTIMATE_PX;
}

export function conversationRenderItemGapBeforePxAt(
  index: number,
  items: readonly ConversationRenderItem[],
  messages: readonly ConversationMessageSnapshot[],
): number {
  const item = items[index];
  if (!item) {
    return 0;
  }
  const messageIndex = item.kind === "process-group" ? item.messageIndices[0] : item.messageIndex;
  if (messageIndex === undefined) {
    return 0;
  }
  return gapBeforePxForRenderIndex(index, items, messages, messageIndex);
}

export function estimateConversationRenderItemHeight(
  index: number,
  items: readonly ConversationRenderItem[],
  messages: readonly ConversationMessageSnapshot[],
): number {
  const item = items[index];
  if (!item) {
    return FALLBACK_BODY_ESTIMATE_PX;
  }

  if (item.kind === "process-group") {
    const anchorIndex = item.messageIndices[0];
    const anchor = anchorIndex === undefined ? undefined : messages[anchorIndex];
    const gap = anchor ? gapBeforePxForRenderIndex(index, items, messages, anchorIndex) : 0;
    return gap + PROCESS_GROUP_BODY_ESTIMATE_PX;
  }

  const message = messages[item.messageIndex];
  if (!message) {
    return FALLBACK_BODY_ESTIMATE_PX;
  }

  const gap = gapBeforePxForRenderIndex(index, items, messages, item.messageIndex);
  return gap + bodyEstimateForMessage(message);
}
