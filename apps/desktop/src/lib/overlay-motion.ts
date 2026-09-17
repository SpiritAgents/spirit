/** Matches the `duration-100` exit wait of Radix overlays such as Dialog / ContextMenu. */
export const RADIX_OVERLAY_CLOSE_MS = 100;

/** Runs after the exit wait finishes; avoids the last exit frame flashing UI when onOpenChange(false) clears state at the same time. */
export function runAfterRadixOverlayClose(action: () => void): void {
  window.setTimeout(action, RADIX_OVERLAY_CLOSE_MS);
}
