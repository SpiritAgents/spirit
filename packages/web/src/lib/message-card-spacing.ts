import type { ConversationMessageSnapshot } from "../types.js";
import type { ConversationRenderItem } from "./conversation-process-groups.js";
import { resolveMessageForRenderSpacing } from "./conversation-process-groups.js";
import { isSubagentStatusSurfaceMessage } from "./subagent-display.js";
import { isMinimalToolCallMessage } from "./tool-call-display.js";

export function isStandaloneAssistantAuxMessage(
  message: ConversationMessageSnapshot | undefined,
): message is ConversationMessageSnapshot {
  return Boolean(
    message &&
    message.role === "assistant" &&
    !message.tool &&
    !message.content.trim() &&
    (message.aux?.thinking?.trim() || message.aux?.compaction?.trim()),
  );
}

export function isGrayMetaLeadingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  if (!message || message.role !== "assistant") {
    return false;
  }
  if (isSubagentStatusSurfaceMessage(message)) {
    return true;
  }
  if (message.tool) {
    return isMinimalToolCallMessage(message);
  }
  if (message.content.trim()) {
    return false;
  }
  return Boolean(
    message.aux?.thinking?.trim() ||
    message.aux?.compaction?.trim() ||
    message.aux?.finishTaskNotice?.trim(),
  );
}

export function isGrayMetaTrailingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  if (!message || message.role !== "assistant") {
    return false;
  }
  if (isSubagentStatusSurfaceMessage(message)) {
    return true;
  }
  if (message.content.trim()) {
    return false;
  }
  if (message.tool) {
    return isMinimalToolCallMessage(message);
  }
  return Boolean(
    message.aux?.thinking?.trim() ||
    message.aux?.compaction?.trim() ||
    message.aux?.finishTaskNotice?.trim(),
  );
}

export function shouldCompactAfterPreviousMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  const currentHasStandaloneAux = Boolean(
    current.role === "assistant" &&
    !current.tool &&
    (current.aux?.thinking?.trim() || current.aux?.compaction?.trim()),
  );

  return Boolean(
    isStandaloneAssistantAuxMessage(previous) &&
    current.role === "assistant" &&
    !current.tool &&
    current.content.trim() &&
    !currentHasStandaloneAux,
  );
}

export function shouldTightenAfterPreviousMetaMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  return isGrayMetaTrailingMessage(previous) && isGrayMetaLeadingMessage(current);
}

export function shouldTightenAfterPreviousRenderItem(
  previousItem: ConversationRenderItem | undefined,
  current: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
): boolean {
  if (previousItem?.kind === "process-group") {
    return isGrayMetaLeadingMessage(current);
  }
  return shouldTightenAfterPreviousMetaMessage(
    resolveMessageForRenderSpacing(previousItem, messages),
    current,
  );
}

export function shouldTightenBodyAfterProcessGroup(
  previousItem: ConversationRenderItem | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  return Boolean(
    previousItem?.kind === "process-group" &&
    current.role === "assistant" &&
    !current.tool &&
    current.content.trim(),
  );
}

export function shouldCompactAfterPreviousRenderItem(
  previousItem: ConversationRenderItem | undefined,
  current: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
): boolean {
  return shouldCompactAfterPreviousMessage(
    resolveMessageForRenderSpacing(previousItem, messages),
    current,
  );
}

// Row spacing is self-contained: after virtualization, adjacent-sibling margin collapse no
// longer applies, so the inter-row gap is folded into the next row's paddingTop (measured by
// measureElement).
// normal = 24px; compact Thought→body, gray meta→meta, and process-group→body = 12px; the first
// row is covered by the shell's pt-6/7.
const CONVERSATION_ROW_GAP_NORMAL_PX = 24;
const CONVERSATION_ROW_GAP_COMPACT_PX = 12;

export function conversationRenderItemGapBeforePx(options: {
  isFirst: boolean;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
  tightenBodyAfterProcessGroup: boolean;
}): number {
  if (options.isFirst) {
    return 0;
  }
  if (options.compactAfterPrevious) {
    return CONVERSATION_ROW_GAP_COMPACT_PX;
  }
  if (options.tightenAfterPreviousMeta) {
    return CONVERSATION_ROW_GAP_COMPACT_PX;
  }
  if (options.tightenBodyAfterProcessGroup) {
    return CONVERSATION_ROW_GAP_COMPACT_PX;
  }
  return CONVERSATION_ROW_GAP_NORMAL_PX;
}
