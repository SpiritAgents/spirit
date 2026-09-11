export type ConversationAbortShortcutContext = {
  activeSurface: "conversation" | "settings" | "marketplace" | "automations" | "automation-detail";
  conversationAbortShortcutEligible: boolean;
};

export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code" | "key"
> & {
  target: EventTarget | null;
};

/** Physical Ctrl+C abort shortcut (conversation surface only). */
export function shouldTriggerConversationAbortShortcut(
  event: KeyboardEventLike,
  context: ConversationAbortShortcutContext,
): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.code !== "KeyC") {
    return false;
  }
  if (context.activeSurface !== "conversation") {
    return false;
  }
  if (!context.conversationAbortShortcutEligible) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest(".workspace-terminal-xterm, .shell-tool-xterm, .xterm, .monaco-editor")) {
    return false;
  }
  if (
    target &&
    (target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      (target.isContentEditable && !target.closest("[data-spirit-surface='composer-surface']")))
  ) {
    return false;
  }
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (selection && !selection.isCollapsed) {
    return false;
  }
  return true;
}

/** Mod+P opens file picker; Mod+Shift+P opens action picker. */
export function resolveModPShortcutAction(
  event: Pick<KeyboardEventLike, "defaultPrevented" | "key" | "shiftKey"> & {
    modPressed: boolean;
  },
): "action-picker" | "file-picker" | null {
  if (event.defaultPrevented || !event.modPressed || event.key.toLowerCase() !== "p") {
    return null;
  }
  return event.shiftKey ? "action-picker" : "file-picker";
}

export type SettingsShortcutSurfaceContext = {
  activeSurface: ConversationAbortShortcutContext["activeSurface"];
};

export function isEditableShortcutTarget(target: HTMLElement | null): boolean {
  if (!target) {
    return false;
  }
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    (target.isContentEditable && !target.closest("[data-spirit-surface='composer-surface']"))
  );
}

function hasOpenDialogInDocument(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  // Radix Dialog (see dialog.tsx / overlay-motion.ts) uses data-open for the open state, not data-state.
  return document.querySelector('[data-slot="dialog-content"][data-open]') !== null;
}

/** Mod+, opens settings when not already on the settings surface. */
export function resolveModCommaSettingsShortcutAction(
  event: Pick<KeyboardEventLike, "defaultPrevented" | "key" | "shiftKey" | "altKey" | "target"> & {
    modPressed: boolean;
  },
  context: SettingsShortcutSurfaceContext,
): "open-settings" | null {
  if (event.defaultPrevented || !event.modPressed || event.shiftKey || event.altKey) {
    return null;
  }
  if (event.key !== "," && event.key !== "，") {
    return null;
  }
  if (context.activeSurface === "settings") {
    return null;
  }
  const target = event.target as HTMLElement | null;
  if (isEditableShortcutTarget(target)) {
    return null;
  }
  return "open-settings";
}

/** Mod+T opens the workspace new tool tab menu on the conversation surface. */
export function resolveModTNewToolTabShortcutAction(
  event: Pick<KeyboardEventLike, "defaultPrevented" | "key" | "shiftKey" | "altKey"> & {
    modPressed: boolean;
  },
  context: SettingsShortcutSurfaceContext,
): "open-new-tool-tab" | null {
  if (event.defaultPrevented || !event.modPressed || event.shiftKey || event.altKey) {
    return null;
  }
  if (event.key.toLowerCase() !== "t") {
    return null;
  }
  if (context.activeSurface !== "conversation") {
    return null;
  }
  return "open-new-tool-tab";
}

/** Mod+\\ splits right; Mod+Shift+\\ splits down on the conversation surface. */
export function resolveModBackslashSplitShortcutAction(
  event: Pick<KeyboardEventLike, "defaultPrevented" | "shiftKey" | "altKey" | "code" | "target"> & {
    modPressed: boolean;
  },
  context: SettingsShortcutSurfaceContext,
): "split-right" | "split-down" | null {
  if (event.defaultPrevented || !event.modPressed || event.altKey) {
    return null;
  }
  if (event.code !== "Backslash") {
    return null;
  }
  if (context.activeSurface !== "conversation") {
    return null;
  }
  const target = event.target as HTMLElement | null;
  if (isEditableShortcutTarget(target)) {
    return null;
  }
  if (target?.closest(".workspace-terminal-xterm, .shell-tool-xterm, .xterm, .monaco-editor")) {
    return null;
  }
  return event.shiftKey ? "split-down" : "split-right";
}

const WORKSPACE_PANEL_SURFACE_SELECTOR = '[data-spirit-surface="workspace-panel"]';

/** Last pointerdown was inside the open workspace panel (file tree clicks often leave focus on body). */
let workspacePanelRegionActive = false;

export function setWorkspacePanelRegionActive(active: boolean): void {
  workspacePanelRegionActive = active;
}

export function resetWorkspacePanelRegionActiveForTests(): void {
  workspacePanelRegionActive = false;
}

export type ModDigitIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ModDigitShortcutEvent = Pick<
  KeyboardEventLike,
  "defaultPrevented" | "shiftKey" | "altKey" | "code"
> & {
  modPressed: boolean;
};

/** Physical number-row Mod+1..9. Digit 9 is the 9th item, never "last". */
export function parseModDigitIndex(event: ModDigitShortcutEvent): ModDigitIndex | null {
  if (event.defaultPrevented || !event.modPressed || event.shiftKey || event.altKey) {
    return null;
  }
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) {
    return null;
  }
  return Number(match[1]) as ModDigitIndex;
}

export function isFocusInOpenWorkspaceToolsPanel(
  target: EventTarget | null,
  workspaceToolsOpen: boolean,
): boolean {
  if (!workspaceToolsOpen) {
    return false;
  }
  const element = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(element?.closest?.(WORKSPACE_PANEL_SURFACE_SELECTOR)) || workspacePanelRegionActive;
}

export type ModDigitShortcutAction = "session" | "tab";

export type ModDigitShortcutContext = {
  workspaceToolsOpen: boolean;
};

/** Route Mod+1..9: open workspace panel focus → tab strip; otherwise sidebar sessions. */
export function resolveModDigitShortcutAction(
  event: ModDigitShortcutEvent & Pick<KeyboardEventLike, "target">,
  context: ModDigitShortcutContext,
): ModDigitShortcutAction | null {
  if (parseModDigitIndex(event) == null) {
    return null;
  }
  if (isFocusInOpenWorkspaceToolsPanel(event.target, context.workspaceToolsOpen)) {
    return "tab";
  }
  return "session";
}

/** Escape returns from settings when no modal is open and focus is not in an editable field. */
export function shouldTriggerSettingsEscapeShortcut(
  event: KeyboardEventLike,
  context: SettingsShortcutSurfaceContext,
): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (context.activeSurface !== "settings") {
    return false;
  }
  if (event.key !== "Escape") {
    return false;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }
  if (hasOpenDialogInDocument()) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (isEditableShortcutTarget(target)) {
    return false;
  }
  return true;
}
