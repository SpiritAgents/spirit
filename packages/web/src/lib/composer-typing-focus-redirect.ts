/**
 * Decision logic for redirecting pane typing focus into the composer.
 *
 * Background: whether an IME (e.g. pinyin) takes over a keystroke is already decided when
 * the key event reaches the app (Chromium performs IME dispatch in the browser process,
 * before the renderer's keydown). So focusing or injecting characters only inside keydown
 * means the first character never reaches the IME candidate window. The correct approach is
 * to move DOM focus into the composer as early as possible (pre-focus on click); the keydown
 * redirect is only a fallback, and it must only focus without intercepting the default
 * behavior, letting the native key pipeline deliver the character into the just-focused
 * contenteditable.
 */

/** Do not redirect when the target is itself editable or activatable: buttons/links/menu items must keep their Enter/Space semantics. */
export const TYPING_FOCUS_REDIRECT_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
  ".xterm",
  ".monaco-editor",
].join(", ");

/** Do not redirect when the target is inside an overlay: keystrokes in dialogs / menus / listboxes belong to the overlay. */
export const TYPING_FOCUS_REDIRECT_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type TargetLike = Pick<HTMLElement, "tagName" | "isContentEditable" | "closest"> | null;

export type TypingFocusRedirectKeyEvent = Pick<
  KeyboardEvent,
  "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "key"
> & {
  target: EventTarget | null;
};

/** The target is an editable element (including the composer itself and the hidden textareas of xterm/monaco). */
export function isTypingFocusRedirectEditableTarget(target: TargetLike): boolean {
  if (!target) {
    return false;
  }
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function isInteractiveOrOverlayTarget(target: TargetLike): boolean {
  if (!target) {
    return false;
  }
  return (
    target.closest(TYPING_FOCUS_REDIRECT_INTERACTIVE_SELECTOR) !== null ||
    target.closest(TYPING_FOCUS_REDIRECT_OVERLAY_SELECTOR) !== null
  );
}

/**
 * keydown fallback: for a printable character without modifier keys whose target is neither
 * editable nor interactive, focus should synchronously move into the focused pane's composer
 * (the caller only focuses, without preventDefault).
 */
export function shouldRedirectKeydownToComposer(event: TypingFocusRedirectKeyEvent): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  if (event.key.length !== 1) {
    return false;
  }
  const target = event.target as TargetLike;
  if (isTypingFocusRedirectEditableTarget(target)) {
    return false;
  }
  if (isInteractiveOrOverlayTarget(target)) {
    return false;
  }
  return true;
}

/**
 * Click pre-focus (the IME main path): when clicking a non-interactive area inside a pane
 * without a dragged selection, DOM focus should be pre-set into that pane's composer so the
 * next keystroke is immediately taken over by the IME.
 * When text is being drag-selected (non-collapsed selection), leave focus untouched so Cmd+C
 * copy keeps working.
 */
export function shouldPrefocusComposerOnPaneClick(
  target: EventTarget | null,
  selectionCollapsed: boolean,
): boolean {
  if (!selectionCollapsed) {
    return false;
  }
  const targetLike = target as TargetLike;
  if (isTypingFocusRedirectEditableTarget(targetLike)) {
    return false;
  }
  if (isInteractiveOrOverlayTarget(targetLike)) {
    return false;
  }
  return true;
}
