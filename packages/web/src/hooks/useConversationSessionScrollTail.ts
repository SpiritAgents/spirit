import { useLayoutEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import { flushSync } from "react-dom";

import type { ScrollArea } from "@/components/ui/scroll-area";
import {
  scrollAreaToBottom,
  scrollAreaViewport,
  scrollDistanceFromBottom,
} from "@/lib/scroll-area-viewport";

export type UseConversationSessionScrollTailOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  /** List content identity (session key + scope key + remount epoch); any change re-pins to the bottom */
  contentKey: string;
  /** Scroll only when session content is visible (not empty, not hidden by a navigation placeholder) */
  enabled: boolean;
  /** Session is streaming: content keeps growing and cannot settle before paint, so pin to the bottom via cross-frame rAF */
  streaming: boolean;
};

// Upper bound on settle frames: when entering a session that is streaming, scrollHeight keeps growing
// and never settles; once the bound is hit, show directly and let the stream tail keep following.
const SETTLE_MAX_FRAMES = 12;

/**
 * Pin to the newest message after switching the composer session (or a list scope / remount epoch change).
 *
 * Under virtualization the first frame scrolls to bottom with estimated heights, then the measured
 * totalSize correction needs another scroll-to-bottom — two visible jumps, the "double jump on entering
 * a session". So until settled (still at bottom the frame after pinning), return listSettling=true and
 * let the caller hide the list (visibility:hidden does not affect layout measurement), then show it at
 * once once settled.
 */
export function useConversationSessionScrollTail({
  scrollAreaRef,
  contentKey,
  enabled,
  streaming,
}: UseConversationSessionScrollTailOptions): { listSettling: boolean } {
  const previousContentKeyRef = useRef<string | null>(null);
  const [settling, setSettling] = useState(enabled);

  useLayoutEffect(() => {
    if (!enabled) {
      // Empty sessions and similar unmount the message list; the next time it becomes visible it must be pinned again
      previousContentKeyRef.current = null;
      setSettling(false);
      return;
    }

    const contentChanged = previousContentKeyRef.current !== contentKey;
    if (!contentChanged) {
      return;
    }

    let canceled = false;
    let rafId = 0;

    const finishSettle = (viewport: HTMLElement) => {
      setSettling(true);
      scrollAreaToBottom(viewport);

      if (!streaming) {
        queueMicrotask(() => {
          if (canceled) {
            return;
          }
          scrollAreaToBottom(viewport);
          previousContentKeyRef.current = contentKey;
          flushSync(() => setSettling(false));
        });
        return;
      }

      let frame = 0;
      const step = () => {
        if (canceled) {
          return;
        }
        frame += 1;
        if (scrollDistanceFromBottom(viewport) <= 1 || frame >= SETTLE_MAX_FRAMES) {
          previousContentKeyRef.current = contentKey;
          setSettling(false);
          return;
        }
        scrollAreaToBottom(viewport);
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    };

    const viewport = scrollAreaViewport(scrollAreaRef.current);
    if (viewport) {
      finishSettle(viewport);
      return () => {
        canceled = true;
        cancelAnimationFrame(rafId);
      };
    }

    // The Radix viewport may mount one frame later than the contentKey change; do not mark the key as handled, poll until available.
    setSettling(true);
    const waitForViewport = () => {
      if (canceled) {
        return;
      }
      const nextViewport = scrollAreaViewport(scrollAreaRef.current);
      if (!nextViewport) {
        rafId = requestAnimationFrame(waitForViewport);
        return;
      }
      finishSettle(nextViewport);
    };
    rafId = requestAnimationFrame(waitForViewport);

    return () => {
      canceled = true;
      cancelAnimationFrame(rafId);
    };
  }, [contentKey, enabled, streaming, scrollAreaRef]);

  return { listSettling: settling };
}
