import type { MutableRefObject } from "react";

export type ConversationAbortShortcutTarget = {
  eligible: boolean;
  sessionPath?: string;
};

export type ConversationAbortShortcutTargetRef = MutableRefObject<ConversationAbortShortcutTarget>;

export function countVisiblePaneSessions(
  snapshot:
    | {
        paneSessions?: Record<string, unknown>;
      }
    | null
    | undefined,
): number {
  return snapshot?.paneSessions ? Object.keys(snapshot.paneSessions).length : 1;
}
