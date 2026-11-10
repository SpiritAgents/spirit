import { useLayoutEffect, useRef } from "react";

export type UseConversationSessionFocusComposerOptions = {
  composerSessionKey: string;
  focusComposer: () => void;
  /**
   * The conversation surface is the page on screen.
   * False on settings, marketplace, and automations.
   */
  surfaceActive: boolean;
  /**
   * In-page navigation and shell overlays have settled.
   * This does not include surface visibility: a false value must not count as leaving the page.
   */
  ready: boolean;
};

/**
 * Move focus to the focused pane composer after the conversation surface is entered
 * or the composer session changes.
 *
 * Settings keeps the conversation tree mounted, so a return from settings does not
 * change the session key and does not remount the composer. `surfaceLeft` records
 * that visit so the same session still focuses the pane that is current on return.
 */
export function useConversationSessionFocusComposer({
  composerSessionKey,
  focusComposer,
  surfaceActive,
  ready,
}: UseConversationSessionFocusComposerOptions): void {
  const lastFocusedSessionKeyRef = useRef<string | null>(null);
  const surfaceLeftRef = useRef(false);

  useLayoutEffect(() => {
    if (!surfaceActive) {
      surfaceLeftRef.current = true;
      return;
    }

    if (!ready || !composerSessionKey.trim()) {
      return;
    }

    const sessionKey = composerSessionKey;
    const surfaceEntry = surfaceLeftRef.current;
    const sessionChanged = lastFocusedSessionKeyRef.current !== sessionKey;
    if (!surfaceEntry && !sessionChanged) {
      return;
    }

    // Record the visit only once focus is issued. Strict Mode runs this effect
    // twice and cancels the first pass; committing earlier would make the replay
    // treat the visit as already handled and skip the composer.
    let cancelled = false;
    const focus = () => {
      if (cancelled) {
        return;
      }
      lastFocusedSessionKeyRef.current = sessionKey;
      surfaceLeftRef.current = false;
      focusComposer();
    };
    queueMicrotask(focus);
    const frame = requestAnimationFrame(focus);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [composerSessionKey, focusComposer, ready, surfaceActive]);
}
