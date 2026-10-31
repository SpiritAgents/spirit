import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";
import {
  isScrollNearBottom,
  scrollAreaAnimateToLiveBottom,
  scrollAreaToBottom,
  scrollAreaViewport,
  scrollDistanceFromBottom,
} from "@/lib/scroll-area-viewport";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export type UseConversationStreamScrollTailOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  messages: readonly ConversationMessageSnapshot[];
  pendingAuxState: PendingAssistantAux | undefined;
  isBusy: boolean;
  scrollBedPaddingPx: number;
  enabled: boolean;
};

export type UseConversationStreamScrollTailResult = {
  /** Re-stick to bottom when forceStick is true; behavior defaults to auto (instant pin during streaming); pass smooth for "back to bottom" clicks. */
  pinScrollToTail: (forceStick?: boolean, behavior?: ScrollBehavior) => void;
  /** The user is still following the tail; false means they scrolled up and "back to bottom" can be shown. */
  followingTail: boolean;
  /** Stop auto-pinning so a programmatic scroll (quote jump) is not pulled back to the tail. */
  releaseTailFollow: () => void;
};

function buildStreamContentSig(
  messages: readonly ConversationMessageSnapshot[],
  pendingAuxState: PendingAssistantAux | undefined,
): string {
  const last = messages[messages.length - 1];
  const auxSig = pendingAuxState
    ? `${pendingAuxState.kind}:${pendingAuxState.statusText.length}:${pendingAuxState.detailText?.length ?? 0}`
    : "";
  return `${messages.length}:${last?.id ?? ""}:${last?.content.length ?? 0}:${last?.pending === true ? 1 : 0}:${auxSig}`;
}

/**
 * While streaming, keep scrolling to the conversation bottom if the user is still near the tail; stop following once the user scrolls up.
 *
 * Returns pinScrollToTail so the virtual list can re-pin synchronously in each commit's layout effect:
 * card height animations trigger multiple layout feedback rounds per frame (row height change → re-measure
 * → re-render totalSize); the browser ResizeObserver has a loop limit and defers over-limit notifications
 * to the next frame, so pinning via the content RO alone lets some frames hit the screen with unpinned
 * offsets (measured 4–17px oscillation, the "card shaking during bottom-anchored expansion").
 */
export function useConversationStreamScrollTail({
  scrollAreaRef,
  messages,
  pendingAuxState,
  isBusy,
  scrollBedPaddingPx,
  enabled,
}: UseConversationStreamScrollTailOptions): UseConversationStreamScrollTailResult {
  const stickToBottomRef = useRef(true);
  /** A smooth "back to bottom" animation is in progress: suppress instant auto pinning from streaming/RO/virtual list. */
  const suppressInstantPinRef = useRef(false);
  const cancelLiveSmoothRef = useRef<(() => void) | null>(null);
  const [followingTail, setFollowingTail] = useState(true);
  const prevBusyRef = useRef(false);
  const prevContentSigRef = useRef("");

  const setStickToBottom = useCallback((next: boolean) => {
    if (stickToBottomRef.current === next) {
      return;
    }
    stickToBottomRef.current = next;
    if (!next) {
      suppressInstantPinRef.current = false;
      cancelLiveSmoothRef.current?.();
      cancelLiveSmoothRef.current = null;
    }
    setFollowingTail(next);
  }, []);

  const scrollToTail = useCallback(
    (forceStick = false, behavior: ScrollBehavior = "auto") => {
      if (forceStick) {
        setStickToBottom(true);
      } else if (!stickToBottomRef.current) {
        return;
      }
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      if (!viewport) {
        return;
      }
      if (behavior === "smooth") {
        suppressInstantPinRef.current = true;
        cancelLiveSmoothRef.current?.();
        cancelLiveSmoothRef.current = scrollAreaAnimateToLiveBottom(viewport, {
          onDone: () => {
            cancelLiveSmoothRef.current = null;
            suppressInstantPinRef.current = false;
            if (stickToBottomRef.current) {
              scrollAreaToBottom(viewport, "auto");
            }
          },
        });
        return;
      }
      if (suppressInstantPinRef.current) {
        return;
      }
      scrollAreaToBottom(viewport, behavior);
    },
    [scrollAreaRef, setStickToBottom],
  );

  useEffect(() => {
    if (!enabled) {
      setStickToBottom(true);
      return;
    }
    const root = scrollAreaRef.current;
    const viewport = scrollAreaViewport(root);
    if (!root || !viewport) {
      return;
    }

    // stick semantics = "the user deliberately left the bottom"; it can only be released by user input,
    // not inferred from scroll events: during streaming, content is frequently added/removed
    // (collapse/final render/clamp), so the scrollTop and distance-from-bottom read when a scroll event
    // arrives are stale signals — twice measured as misjudged user scroll-ups (the distance-delta version
    // and the scrollTop-decrease version); after wrongly turning off follow, the content RO no longer
    // re-pins, the "jump up after streaming ends".
    // Current rules (release is always anchored to user input):
    // - wheel up → release, but only when the viewport can actually scroll; a short
    //   transcript with scrollHeight === clientHeight never leaves the bottom;
    // - pointer down outside the viewport (Radix scrollbar drag) → release;
    // - middle-button down inside the viewport (Windows auto-scroll, subsequent scrolling has no wheel events) → release;
    // - scrollTop decreasing during pointerdown / touchstart inside the viewport (touch drag, text
    //   selection drag) → release. Touch must be tracked via touch events separately: when Chromium
    //   classifies a touch drag as scrolling, it fires pointercancel and stops pointer events, with all
    //   scroll events landing after them, while touchmove/touchend persist during scrolling. On an
    //   upward swipe, scrollTop decreases before the finger lifts, so inertial scrolling after touchend
    //   needs no further check; scrollTop decreases outside a gesture (content collapse/clamp) do not
    //   release, preserving the original design intent.
    // scroll events only restore stick when "scrolling toward the bottom and near the bottom", never
    // release. Restore must carry the direction condition: an upward swipe starting from the bottom is
    // gradual, and the first scroll event often still arrives within the 48px threshold (measured dist=1);
    // without the direction condition, stick just turned off by wheel would be wrongly re-enabled
    // immediately, and a later sidebar open/close triggering the content RO would pin to the bottom
    // ("swiping up a little, then toggling the sidebar jumps to the bottom").
    // Direction is only used to enable, not to disable: the worst misjudgment is missing one enable,
    // which the user's continued downward scroll will fix.
    // A second restore path lives in the ResizeObserver effect below: layout changes (viewport
    // resize, content collapse) re-arm stick only when they put the viewport exactly at the bottom.
    const UNSTICK_DRAG_THRESHOLD_PX = 4;
    let pointerHeld = false;
    let touchActive = false;
    let pointerDragTracking = false;
    let pointerDragStartY = 0;
    let touchDragTracking = false;
    let touchDragStartY = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        if (viewport.scrollHeight - viewport.clientHeight <= 0) {
          return;
        }
        setStickToBottom(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !viewport.contains(event.target)) {
        setStickToBottom(false);
        return;
      }
      if (event.button === 1) {
        setStickToBottom(false);
        return;
      }
      if (event.pointerType !== "touch") {
        pointerDragTracking = true;
        pointerDragStartY = event.clientY;
        pointerHeld = false;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDragTracking || event.pointerType === "touch") {
        return;
      }
      if (event.clientY - pointerDragStartY >= UNSTICK_DRAG_THRESHOLD_PX) {
        pointerHeld = true;
      }
    };
    const onPointerEnd = () => {
      pointerHeld = false;
      pointerDragTracking = false;
    };
    const onTouchStart = (event: TouchEvent) => {
      touchDragTracking = true;
      touchActive = false;
      touchDragStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchDragTracking) {
        return;
      }
      const y = event.touches[0]?.clientY;
      if (y === undefined) {
        return;
      }
      if (touchDragStartY - y >= UNSTICK_DRAG_THRESHOLD_PX) {
        touchActive = true;
      }
    };
    const onTouchEnd = () => {
      touchActive = false;
      touchDragTracking = false;
    };
    let lastScrollTop = viewport.scrollTop;
    const onScroll = () => {
      const top = viewport.scrollTop;
      const movedTowardBottom = top > lastScrollTop;
      const movedTowardTop = top < lastScrollTop;
      lastScrollTop = top;
      if ((pointerHeld || touchActive) && movedTowardTop) {
        setStickToBottom(false);
        return;
      }
      if (
        !stickToBottomRef.current &&
        movedTowardBottom &&
        isScrollNearBottom(viewport, STICK_TO_BOTTOM_THRESHOLD_PX)
      ) {
        setStickToBottom(true);
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: true });
    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    viewport.addEventListener("pointermove", onPointerMove, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    // pointerup / touchend may happen outside the viewport / window (release after dragging), so they must be attached to window
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [enabled, scrollAreaRef, setStickToBottom]);

  useLayoutEffect(() => {
    if (!enabled) {
      prevBusyRef.current = isBusy;
      return;
    }
    const busyStarted = !prevBusyRef.current && isBusy;
    prevBusyRef.current = isBusy;
    if (!busyStarted) {
      return;
    }
    scrollToTail(true);
    requestAnimationFrame(() => scrollToTail(true));
  }, [enabled, isBusy, scrollToTail]);

  const contentSig = buildStreamContentSig(messages, pendingAuxState);

  useLayoutEffect(() => {
    if (!enabled || !isBusy) {
      prevContentSigRef.current = contentSig;
      return;
    }
    if (contentSig === prevContentSigRef.current) {
      return;
    }
    prevContentSigRef.current = contentSig;
    scrollToTail();
    requestAnimationFrame(() => scrollToTail());
  }, [contentSig, enabled, isBusy, scrollToTail]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    scrollToTail();
    requestAnimationFrame(() => scrollToTail());
  }, [enabled, scrollBedPaddingPx, scrollToTail]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    const content = viewport?.firstElementChild;
    if (!viewport || !(content instanceof HTMLElement)) {
      return;
    }

    // Re-evaluate the tail state on every layout change instead of waiting for the next user
    // scroll (viewport resizes fire no scroll events, so without this the button state goes stale):
    // - sticking → re-pin, so shrinking the window keeps the newest messages in view instead of
    //   sitting at a stale scrollTop with the tail cut off and no button;
    // - released → re-arm only when the layout itself put the viewport at the bottom (distance ≤ 1:
    //   non-scrollable content, or scrollTop clamped by a resize/collapse). User scroll-ups always
    //   leave a larger distance and re-release on their next wheel tick anyway, so the "swipe up a
    //   little, then toggle the sidebar jumps to the bottom" race above cannot permanently re-arm.
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        scrollToTail();
        return;
      }
      if (scrollDistanceFromBottom(viewport) <= 1) {
        setStickToBottom(true);
      }
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [enabled, scrollAreaRef, scrollToTail, setStickToBottom]);

  return {
    pinScrollToTail: scrollToTail,
    followingTail,
    releaseTailFollow: () => setStickToBottom(false),
  };
}
