export const CONVERSATION_SPLIT_SHELL_SELECTOR = "[data-conversation-split-shell]";
export const CONVERSATION_SPLIT_SHELL_DIVIDER_ATTR = "data-spirit-conversation-split-shell-divider";

export function getConversationSplitShell(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CONVERSATION_SPLIT_SHELL_SELECTOR);
}

/** getBoundingClientRect deltas are already local CSS px under native Chromium page zoom. */
export function conversationSplitShellLocalLength(delta: number): number {
  return delta;
}

/** Inset of the split container within the shell; both horizontal and vertical lines are clipped to it so nesting never paints outside the container. */
export function conversationSplitShellInsetBounds(
  shell: HTMLElement,
  bounds: HTMLElement,
): { topPx: number; rightPx: number; bottomPx: number; leftPx: number } {
  const shellRect = shell.getBoundingClientRect();
  const boundsRect = bounds.getBoundingClientRect();
  return {
    topPx: conversationSplitShellLocalLength(Math.max(0, boundsRect.top - shellRect.top)),
    rightPx: conversationSplitShellLocalLength(Math.max(0, shellRect.right - boundsRect.right)),
    bottomPx: conversationSplitShellLocalLength(Math.max(0, shellRect.bottom - boundsRect.bottom)),
    leftPx: conversationSplitShellLocalLength(Math.max(0, boundsRect.left - shellRect.left)),
  };
}
