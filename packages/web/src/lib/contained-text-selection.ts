import { useEffect, type RefObject } from "react";

/** Select all text nodes inside `root` without affecting the rest of the page. */
export function selectAllTextInElement(root: HTMLElement): boolean {
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection) {
    return false;
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
    return !selection.isCollapsed;
  } catch {
    return false;
  }
}

export function isModAShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
}

/** Keys that finalize a keyboard-driven selection and may open the action menu. */
export function isSelectionShortcutKeyUp(event: KeyboardEvent): boolean {
  if (isModAShortcut(event)) {
    return true;
  }
  return (
    event.key === "Shift" ||
    event.key.startsWith("Arrow") ||
    event.key === "Home" ||
    event.key === "End" ||
    event.key === "PageUp" ||
    event.key === "PageDown"
  );
}

function isModAReleaseKeyUp(event: KeyboardEvent): boolean {
  return event.key === "Meta" || event.key === "Control" || event.key.toLowerCase() === "a";
}

/** macOS often emits only Meta/Control keyup after Cmd+A; track keydown Mod+A then sync on release. */
export function attachKeyboardSelectionMenuSync(
  scheduleSync: () => void,
  target: EventTarget = document,
): () => void {
  let pendingModA = false;

  const onKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (isModAShortcut(event)) {
      pendingModA = true;
    }
  };

  const onKeyUp = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (pendingModA) {
      if (isModAReleaseKeyUp(event)) {
        pendingModA = false;
        scheduleSync();
      }
      return;
    }
    if (isSelectionShortcutKeyUp(event)) {
      scheduleSync();
    }
  };

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);
  return () => {
    pendingModA = false;
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("keyup", onKeyUp, true);
  };
}

function isFocusInSubtree(root: HTMLElement): boolean {
  const active = document.activeElement;
  return active === root || root.contains(active);
}

/** Scope Cmd/Ctrl+A to `root` and focus it on pointer down. */
export function installContainedSelectAll(root: HTMLElement): () => void {
  if (root.tabIndex < 0) {
    root.tabIndex = -1;
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    root.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isModAShortcut(event) || !isFocusInSubtree(root)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectAllTextInElement(root);
  };

  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("keydown", onKeyDown);
  return () => {
    root.removeEventListener("mousedown", onMouseDown);
    root.removeEventListener("keydown", onKeyDown);
  };
}

export function useContainedSelectAll(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    return installContainedSelectAll(root);
  }, [enabled, rootRef]);
}
