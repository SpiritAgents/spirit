export type ThreadSidebarDigitShortcutBridge = {
  resolveVisibleSessions(): ReadonlyArray<{ path: string }>;
};

let bridge: ThreadSidebarDigitShortcutBridge | null = null;

export function registerThreadSidebarDigitShortcut(
  registration: ThreadSidebarDigitShortcutBridge,
): void {
  bridge = registration;
}

export function unregisterThreadSidebarDigitShortcut(): void {
  bridge = null;
}

export function resolveVisibleSidebarSessionsForDigitShortcut(): ReadonlyArray<{ path: string }> {
  return bridge?.resolveVisibleSessions() ?? [];
}

export function resetThreadSidebarDigitShortcutBridgeForTests(): void {
  bridge = null;
}
