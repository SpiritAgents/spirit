import type { DesktopSnapshot, PaneSessionSlice, PendingQuestionsSnapshot } from "../types.js";

/** Foreground session path when it holds pending approval; otherwise a background pane slice. */
export function resolvePendingApprovalSessionPath(
  snapshot: DesktopSnapshot | null | undefined,
): string | undefined {
  if (!snapshot?.conversation.pendingToolApproval) {
    if (!snapshot?.paneSessions) {
      return undefined;
    }
    for (const [sessionPath, slice] of Object.entries(snapshot.paneSessions) as Array<
      [string, PaneSessionSlice]
    >) {
      if (slice.conversation.pendingToolApproval && !slice.isForegroundActive) {
        return sessionPath;
      }
    }
    return undefined;
  }
  return snapshot.activeSession?.filePath?.trim() || undefined;
}

/** Foreground session path when it holds pending questions; otherwise a background pane slice. */
export function resolvePendingQuestionsSessionPath(
  snapshot: DesktopSnapshot | null | undefined,
): string | undefined {
  if (!snapshot?.conversation.pendingQuestions) {
    if (!snapshot?.paneSessions) {
      return undefined;
    }
    for (const [sessionPath, slice] of Object.entries(snapshot.paneSessions) as Array<
      [string, PaneSessionSlice]
    >) {
      if (slice.conversation.pendingQuestions && !slice.isForegroundActive) {
        return sessionPath;
      }
    }
    return undefined;
  }
  return snapshot.activeSession?.filePath?.trim() || undefined;
}

export function resolvePendingQuestionsSnapshot(
  snapshot: DesktopSnapshot | null | undefined,
  sessionPath?: string,
): PendingQuestionsSnapshot | null | undefined {
  if (!snapshot) {
    return null;
  }
  const trimmed = sessionPath?.trim();
  if (!trimmed || snapshot.activeSession?.filePath === trimmed) {
    return snapshot.conversation.pendingQuestions ?? null;
  }
  return snapshot.paneSessions?.[trimmed]?.conversation.pendingQuestions ?? null;
}
