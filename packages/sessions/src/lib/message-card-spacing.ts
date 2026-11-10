import type { ConversationMessageSnapshot } from "../types.js";
import type { ConversationRenderItem } from "./conversation-process-groups.js";
import { resolveMessageForRenderSpacing } from "./conversation-process-groups.js";
import { hasAssistantToolInCurrentTurn } from "./conversation-thinking-ui.js";
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
  if (!message.content.trim()) {
    return Boolean(
      !message.tool && (message.aux?.thinking?.trim() || message.aux?.compaction?.trim()),
    );
  }
  if (message.tool) {
    return isMinimalToolCallMessage(message);
  }
  return false;
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

export function shouldUseDefaultSpacingAfterAbortedThought(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
  currentIndex: number,
): boolean {
  return (
    isStandaloneAssistantAuxMessage(previous) &&
    previous.pending === false &&
    current.role === "assistant" &&
    !current.tool &&
    current.pending === true &&
    !hasAssistantToolInCurrentTurn(messages, currentIndex)
  );
}

export function shouldTightenAfterPreviousMetaMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
  messages?: readonly ConversationMessageSnapshot[],
  currentIndex?: number,
): boolean {
  // Symmetric Thought↔tool rhythm: list rows use space-y-3 + pb-3 only — never -mt-3 when a tool
  // is on either side (logs: tool tighten=false but nextTighten=true made tool→Thought tighter than Thought→tool).
  if (!previous || current.role !== "assistant" || current.tool || previous.tool) {
    return false;
  }

  if (
    messages !== undefined &&
    currentIndex !== undefined &&
    shouldUseDefaultSpacingAfterAbortedThought(previous, current, messages, currentIndex)
  ) {
    return false;
  }

  return isGrayMetaTrailingMessage(previous) && isGrayMetaLeadingMessage(current);
}

export function shouldTightenAfterPreviousRenderItem(
  previousItem: ConversationRenderItem | undefined,
  current: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
  currentMessageIndex?: number,
): boolean {
  if (previousItem?.kind === "process-group") {
    return Boolean(current.role === "assistant" && !current.tool && current.content.trim());
  }
  return shouldTightenAfterPreviousMetaMessage(
    resolveMessageForRenderSpacing(previousItem, messages),
    current,
    messages,
    currentMessageIndex,
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
// normal = pb-3 + space-y-3 = 24px; compact (-mt-4) = 8px; tighten (-mt-3) = 12px; the first
// row is covered by the shell's pt-6/7.
const CONVERSATION_ROW_GAP_NORMAL_PX = 24;
const CONVERSATION_ROW_GAP_COMPACT_PX = 8;
const CONVERSATION_ROW_GAP_TIGHTEN_PX = 12;

export function conversationRenderItemGapBeforePx(options: {
  isFirst: boolean;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
}): number {
  if (options.isFirst) {
    return 0;
  }
  if (options.compactAfterPrevious) {
    return CONVERSATION_ROW_GAP_COMPACT_PX;
  }
  if (options.tightenAfterPreviousMeta) {
    return CONVERSATION_ROW_GAP_TIGHTEN_PX;
  }
  return CONVERSATION_ROW_GAP_NORMAL_PX;
}
