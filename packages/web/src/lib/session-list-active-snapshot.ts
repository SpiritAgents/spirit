import type { DesktopSnapshot, SessionListItem } from "@/types";

/**
 * Keep the active session's sidebar title and activity in sync with its snapshot.
 * Background sessions still come from listSessions; the active snapshot is authoritative here.
 */
export function patchActiveSessionSnapshotInList(
  list: SessionListItem[],
  snapshot: Pick<DesktopSnapshot, "activeSession" | "conversation">,
): SessionListItem[] | null {
  const filePath = snapshot.activeSession?.filePath;
  const displayName = snapshot.activeSession?.displayName;
  if (!filePath || displayName === undefined) {
    return null;
  }

  const isBusy = snapshot.conversation.isBusy;
  const isBlocked =
    isBusy &&
    (snapshot.conversation.pendingToolApproval !== undefined ||
      snapshot.conversation.pendingQuestions !== undefined);
  let changed = false;
  const next = list.map((session) => {
    if (session.path !== filePath) {
      return session;
    }

    const patched = { ...session, displayName };
    if (isBusy) {
      patched.isBusy = true;
      if (isBlocked) {
        patched.isBlocked = true;
      } else {
        delete patched.isBlocked;
      }
    } else {
      delete patched.isBusy;
      delete patched.isBlocked;
    }

    if (
      session.displayName === patched.displayName &&
      session.isBusy === patched.isBusy &&
      session.isBlocked === patched.isBlocked
    ) {
      return session;
    }
    changed = true;
    return patched;
  });
  return changed ? next : null;
}
