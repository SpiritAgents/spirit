import type { SplitDirection } from "@/lib/conversation-split-layout";

export type SplitPaneShortcutBridge = {
  splitFocusedPane(direction: SplitDirection): void;
};

let bridge: SplitPaneShortcutBridge | null = null;

export function registerSplitPaneShortcut(registration: SplitPaneShortcutBridge): void {
  bridge = registration;
}

export function unregisterSplitPaneShortcut(): void {
  bridge = null;
}

export function triggerSplitPaneShortcut(direction: SplitDirection): boolean {
  if (!bridge) {
    return false;
  }
  bridge.splitFocusedPane(direction);
  return true;
}

export function resetSplitPaneShortcutBridgeForTests(): void {
  bridge = null;
}
