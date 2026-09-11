export type SessionSidebarDigitShortcutBridge = {
  resolveVisibleSessions(): ReadonlyArray<{ path: string }>;
};

let bridge: SessionSidebarDigitShortcutBridge | null = null;

export function registerSessionSidebarDigitShortcut(
  registration: SessionSidebarDigitShortcutBridge,
): void {
  bridge = registration;
}

export function unregisterSessionSidebarDigitShortcut(): void {
  bridge = null;
}

export function resolveVisibleSidebarSessionsForDigitShortcut(): ReadonlyArray<{ path: string }> {
  return bridge?.resolveVisibleSessions() ?? [];
}

export function resetSessionSidebarDigitShortcutBridgeForTests(): void {
  bridge = null;
}
