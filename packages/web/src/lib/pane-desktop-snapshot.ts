import type { DesktopSnapshot, PaneSessionSlice } from "@/types";

function normalizeSessionPathKey(sessionPath: string): string {
  return sessionPath.replace(/\\/g, "/").toLowerCase();
}

export const normalizePaneSessionPathKey = normalizeSessionPathKey;

export function lookupPaneSessionSlice(
  snapshot: DesktopSnapshot | null | undefined,
  sessionPath: string,
): PaneSessionSlice | undefined {
  if (!snapshot?.paneSessions) {
    return undefined;
  }
  const target = normalizeSessionPathKey(sessionPath);
  for (const [key, slice] of Object.entries(snapshot.paneSessions)) {
    if (normalizeSessionPathKey(key) === target) {
      return slice;
    }
  }
  return undefined;
}

export function resolvePaneDesktopSnapshot(
  snapshot: DesktopSnapshot | null,
  sessionPath: string,
): DesktopSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const target = normalizeSessionPathKey(sessionPath);
  const activeKey = snapshot.activeSession?.filePath
    ? normalizeSessionPathKey(snapshot.activeSession.filePath)
    : "";
  if (activeKey && target === activeKey) {
    return snapshot;
  }

  const pane = lookupPaneSessionSlice(snapshot, sessionPath);
  if (!pane) {
    // Stale layout path after promote: do not project the foreground conversation onto this pane.
    if (snapshot.paneSessions && Object.keys(snapshot.paneSessions).length > 0) {
      const isProvisional = sessionPath.includes("__provisional__");
      return {
        ...snapshot,
        activeSession: {
          filePath: sessionPath,
          displayName:
            sessionPath
              .split(/[/\\]/)
              .pop()
              ?.replace(/\.json$/i, "") ?? sessionPath,
          kind: isProvisional ? "ephemeral" : "stored",
          readOnly: false,
        },
        conversation: {
          ...snapshot.conversation,
          messages: [],
          isBusy: false,
        },
        composerSessionKey: sessionPath,
      };
    }
    return snapshot;
  }
  if (pane.isForegroundActive) {
    return snapshot;
  }

  return {
    ...snapshot,
    conversation: pane.conversation,
    ...(pane.activeSession ? { activeSession: pane.activeSession } : {}),
    composerSessionKey: pane.composerSessionKey,
    ...(pane.workspaceRoot ? { workspaceRoot: pane.workspaceRoot } : {}),
    ...(pane.workspaceBinding ? { workspaceBinding: pane.workspaceBinding } : {}),
    ...(pane.git ? { git: pane.git } : {}),
    ...(pane.activeModel
      ? {
          config: {
            ...snapshot.config,
            activeModel: pane.activeModel,
          },
        }
      : {}),
  };
}

export function resolvePaneIsEmptySession(
  snapshot: DesktopSnapshot | null,
  sessionPath: string,
): boolean {
  const paneSnapshot = resolvePaneDesktopSnapshot(snapshot, sessionPath);
  if (!paneSnapshot) {
    return true;
  }
  return paneSnapshot.conversation.messages.length === 0;
}
