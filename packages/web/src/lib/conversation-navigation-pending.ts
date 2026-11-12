import { lookupPaneSessionSlice } from "@/lib/pane-desktop-snapshot";
import { normalizeSessionPathKey } from "@/lib/session-path-kind";
import type { DesktopSnapshot } from "@/types";

/**
 * Navigation intent recorded when the user asks to open a session. "Pending" is
 * derived by comparing the intent with the applied snapshot, so it resolves
 * itself when the target session arrives — there is no release action to miss.
 *
 * Session navigation freezes the current page until the target snapshot lands;
 * this intent exists so the arrival can be detected, not to gate rendering.
 */
export type SessionNavTarget = {
  path: string;
};

export function resolveSessionNavPending(input: {
  navTarget: SessionNavTarget | null;
  snapshot: DesktopSnapshot | null;
}): boolean {
  const { navTarget, snapshot } = input;
  if (!navTarget) {
    return false;
  }
  const activePath = snapshot?.activeSession?.filePath;
  if (!activePath) {
    return true;
  }
  return normalizeSessionPathKey(activePath) !== normalizeSessionPathKey(navTarget.path);
}

export type PaneContentStatus = "ready" | "pending-placeholder";

/**
 * A pane's session data is only absent while a split-layout sync is in flight
 * (a stale layout path after promote, or a binding whose pane slices the host
 * has not loaded yet). Steady-state panes always resolve; only then does the
 * pane render a placeholder — ordinary session navigation freezes the previous
 * page instead of producing an intermediate blank frame.
 */
export function resolvePaneContentStatus(input: {
  paneSessionPath: string;
  snapshot: DesktopSnapshot | null;
}): PaneContentStatus {
  const { snapshot, paneSessionPath } = input;
  if (!snapshot) {
    return "pending-placeholder";
  }
  const paneSessions = snapshot.paneSessions;
  if (!paneSessions || Object.keys(paneSessions).length === 0) {
    // No per-pane slices: every pane projects the foreground snapshot.
    return "ready";
  }
  const target = normalizeSessionPathKey(paneSessionPath);
  const activePath = snapshot.activeSession?.filePath;
  if (activePath && normalizeSessionPathKey(activePath) === target) {
    return "ready";
  }
  return lookupPaneSessionSlice(snapshot, paneSessionPath) ? "ready" : "pending-placeholder";
}
