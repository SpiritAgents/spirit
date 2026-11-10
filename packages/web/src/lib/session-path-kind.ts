export function normalizeSessionPathKey(sessionPath: string): string {
  return sessionPath.replace(/\\/g, "/").toLowerCase();
}

/** Reused draft session path (not a split-pane or side-chat provisional). */
export function isForegroundProvisionalSessionPath(sessionPath: string): boolean {
  const key = normalizeSessionPathKey(sessionPath);
  return (
    key.includes("/__provisional__/") && !key.includes("/split-") && !key.includes("/side-chat-")
  );
}

/** Empty session created for a split pane leaf. */
export function isSplitPaneProvisionalSessionPath(sessionPath: string): boolean {
  const key = normalizeSessionPathKey(sessionPath);
  return key.includes("/__provisional__/split-");
}

/** Fork copy opened in a side-chat split pane leaf. */
export function isSideChatPaneProvisionalSessionPath(sessionPath: string): boolean {
  const key = normalizeSessionPathKey(sessionPath);
  return key.includes("/__provisional__/side-chat-");
}

export function isStableChatSessionPath(sessionPath: string): boolean {
  const key = normalizeSessionPathKey(sessionPath);
  return key.includes("/chats/chat-") && !key.includes("/__provisional__/");
}

/** First-send promotion from a provisional draft slot to a persisted chat file. */
export function isProvisionalSessionPromotion(previousPath: string, nextPath: string): boolean {
  const prevKey = normalizeSessionPathKey(previousPath);
  if (!prevKey.includes("/__provisional__/")) {
    return false;
  }
  return isStableChatSessionPath(nextPath);
}
