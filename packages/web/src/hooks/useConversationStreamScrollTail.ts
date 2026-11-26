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
  scrollAreaAnimateChaseLiveBottom,
  scrollAreaAnimateToLiveBottom,
  scrollAreaToBottom,
  scrollAreaViewport,
  scrollDistanceFromBottom,
} from "@/lib/scroll-area-viewport";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;
/** Keep tail pinning active briefly after streaming ends so final markdown/process-group settlement stays pinned. */
const POST_STREAM_SETTLE_MS = 450;
/** Window after Tab or scroll-up keydown during which an upward scrollTop move releases tail-follow. */
const KEYBOARD_NAV_UNSTICK_WINDOW_MS = 250;
const KEYBOARD_SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

export type UseConversationStreamScrollTailOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  messages: readonly ConversationMessageSnapshot[];
  pendingAuxState: PendingAssistantAux | undefined;
  isBusy: boolean;
  scrollBedPaddingPx: number;
  enabled: boolean;
  /** Session/scope key; changing it resets turn-level auto-stick suppression. */
  contentKey?: string;
  /** Increments on render when a send-to-top turn is triggered so child layout effects do not pre-pin to bottom. */
  sendTopTriggerNonce?: number;
  /** Returns true while send-top animation or temporary bottom compensation is active. */
  isSendTopBlockingTail?: () => boolean;
  /** Called when the user explicitly forces tail-following (e.g. clicking "Scroll to bottom"). */
  onForceStickToBottom?: () => void;
};

export type UseConversationStreamScrollTailResult = {
  /** Re-stick to bottom when forceStick is true; behavior defaults to auto (instant pin during streaming); pass smooth for "back to bottom" clicks. */
  pinScrollToTail: (forceStick?: boolean, behavior?: ScrollBehavior) => void;
  /** The user is still following the tail; false means they scrolled up and "back to bottom" can be shown. */
  followingTail: boolean;
  /** Whether the "Scroll to bottom" button should be shown (suppressed while send-top holds the viewport without overflow below). */
  showScrollToBottom: boolean;
  /** Stop auto-pinning so a programmatic scroll (quote jump) is not pulled back to the tail. */
  releaseTailFollow: () => void;
  /** Prepare tail-follow state for a new send-top turn: keep tail-follow armed so once compensation is consumed, streaming smoothly follows to bottom unless the user scrolled up. */
  enterSendTopTurn: () => void;
  /** Recompute showScrollToBottom after send-top animation or compensation state changes. */
  syncScrollToBottomVisibility: () => void;
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
  contentKey,
  sendTopTriggerNonce = 0,
  isSendTopBlockingTail,
  onForceStickToBottom,
}: UseConversationStreamScrollTailOptions): UseConversationStreamScrollTailResult {
  const stickToBottomRef = useRef(true);
  /** A smooth "back to bottom" animation is in progress: suppress streaming chase/instant pins until it completes. */
  const suppressInstantPinRef = useRef(false);
  const cancelLiveSmoothRef = useRef<(() => void) | null>(null);
  const cancelStreamChaseRef = useRef<(() => void) | null>(null);
  const [followingTail, setFollowingTail] = useState(true);
  const [scrollToBottomAllowed, setScrollToBottomAllowed] = useState(false);
  const isBusyRef = useRef(isBusy);
  const postStreamSettleUntilRef = useRef(0);
  const prevBusyRef = useRef(false);
  const prevContentSigRef = useRef("");
  const prevContentKeyRef = useRef<string | undefined>(contentKey);
  const previousLayoutRef = useRef<{ enabled: boolean; paddingPx: number } | null>(null);
  /** True when the user explicitly scrolled up while send-top compensation/animation was active, preventing ResizeObserver from auto-re-arming stick when compensation later hits 0. */
  const detachedWhileSendTopRef = useRef(false);
  const lastProcessedSendTopNonceRef = useRef(sendTopTriggerNonce);
  const isSendTopBlockingTailRef = useRef(isSendTopBlockingTail);
  const onForceStickToBottomRef = useRef(onForceStickToBottom);
  useLayoutEffect(() => {
    isSendTopBlockingTailRef.current = isSendTopBlockingTail;
    onForceStickToBottomRef.current = onForceStickToBottom;
  }, [isSendTopBlockingTail, onForceStickToBottom]);

  const stopStreamChase = useCallback(() => {
    cancelStreamChaseRef.current?.();
    cancelStreamChaseRef.current = null;
  }, []);

  const isStreamTailPinActive = useCallback(
    () => isBusyRef.current || performance.now() <= postStreamSettleUntilRef.current,
    [],
  );

  const syncScrollToBottomVisibility = useCallback(() => {
    if (stickToBottomRef.current) {
      setScrollToBottomAllowed(false);
      return;
    }
    if (isSendTopBlockingTailRef.current?.()) {
      setScrollToBottomAllowed(false);
      return;
    }
    if (detachedWhileSendTopRef.current) {
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      if (!viewport) {
        setScrollToBottomAllowed(false);
        return;
      }
      setScrollToBottomAllowed(scrollDistanceFromBottom(viewport) > STICK_TO_BOTTOM_THRESHOLD_PX);
      return;
    }
    setScrollToBottomAllowed(true);
  }, [scrollAreaRef]);

  const setStickToBottom = useCallback(
    (next: boolean) => {
      if (!next && isSendTopBlockingTailRef.current?.()) {
        detachedWhileSendTopRef.current = true;
      }
      if (next) {
        detachedWhileSendTopRef.current = false;
      }
      if (stickToBottomRef.current !== next) {
        stickToBottomRef.current = next;
        if (!next) {
          suppressInstantPinRef.current = false;
          cancelLiveSmoothRef.current?.();
          cancelLiveSmoothRef.current = null;
          stopStreamChase();
        }
        setFollowingTail(next);
      }
      syncScrollToBottomVisibility();
    },
    [stopStreamChase, syncScrollToBottomVisibility],
  );

  const enterSendTopTurn = useCallback(() => {
    detachedWhileSendTopRef.current = false;
    postStreamSettleUntilRef.current = 0;
    suppressInstantPinRef.current = false;
    cancelLiveSmoothRef.current?.();
    cancelLiveSmoothRef.current = null;
    stopStreamChase();
    setStickToBottom(true);
  }, [setStickToBottom, stopStreamChase]);

  const pinViewportToBottom = useCallback(
    (behavior: ScrollBehavior | "chase" = "auto") => {
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      if (!viewport) {
        return;
      }
      if (behavior === "smooth") {
        stopStreamChase();
        suppressInstantPinRef.current = true;
        cancelLiveSmoothRef.current?.();
        cancelLiveSmoothRef.current = scrollAreaAnimateToLiveBottom(viewport, {
          onDone: () => {
            cancelLiveSmoothRef.current = null;
            suppressInstantPinRef.current = false;
            if (stickToBottomRef.current && !isSendTopBlockingTailRef.current?.()) {
              scrollAreaToBottom(viewport, "auto");
            }
          },
        });
        return;
      }
      if (suppressInstantPinRef.current) {
        return;
      }
      if (behavior === "chase") {
        if (cancelStreamChaseRef.current) {
          // Existing rAF chase loop already tracks live scrollHeight smoothly.
          return;
        }
        const liveTarget = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (liveTarget - viewport.scrollTop <= 0.5) {
          return;
        }
        cancelStreamChaseRef.current = scrollAreaAnimateChaseLiveBottom(viewport, {
          shouldStop: () =>
            !stickToBottomRef.current || Boolean(isSendTopBlockingTailRef.current?.()),
          onDone: () => {
            cancelStreamChaseRef.current = null;
          },
        });
        return;
      }
      stopStreamChase();
      scrollAreaToBottom(viewport, behavior);
    },
    [scrollAreaRef, stopStreamChase],
  );

  const scrollToTail = useCallback(
    (forceStick = false, behavior?: ScrollBehavior) => {
      if (forceStick) {
        detachedWhileSendTopRef.current = false;
        onForceStickToBottomRef.current?.();
        setStickToBottom(true);
        pinViewportToBottom(behavior ?? "auto");
        return;
      }
      if (
        sendTopTriggerNonce !== lastProcessedSendTopNonceRef.current ||
        isSendTopBlockingTailRef.current?.() ||
        !stickToBottomRef.current ||
        !isStreamTailPinActive()
      ) {
        return;
      }
      pinViewportToBottom(behavior ?? "chase");
    },
    [isStreamTailPinActive, pinViewportToBottom, sendTopTriggerNonce, setStickToBottom],
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
    let lastKeyboardNavAt = -Infinity;
    const onKeyDown = (event: KeyboardEvent) => {
      const isTab = event.key === "Tab";
      const isScrollUpKey =
        !isEditableKeyboardTarget(event.target) &&
        (KEYBOARD_SCROLL_UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey));
      if (!isTab && !isScrollUpKey) {
        return;
      }
      lastKeyboardNavAt = performance.now();
    };
    const onFocusIn = () => {
      if (viewport.scrollHeight - viewport.clientHeight <= 0) {
        return;
      }
      const top = viewport.scrollTop;
      const movedUp = top < lastScrollTop - 0.5;
      const awayFromBottom = !isScrollNearBottom(viewport, STICK_TO_BOTTOM_THRESHOLD_PX);
      if (movedUp || awayFromBottom) {
        lastScrollTop = top;
        setStickToBottom(false);
      }
    };
    const onScroll = () => {
      const top = viewport.scrollTop;
      const movedTowardBottom = top > lastScrollTop;
      const movedTowardTop = top < lastScrollTop;
      const recentKeyboardNav =
        performance.now() - lastKeyboardNavAt <= KEYBOARD_NAV_UNSTICK_WINDOW_MS;
      lastScrollTop = top;
      if ((pointerHeld || touchActive || recentKeyboardNav) && movedTowardTop) {
        setStickToBottom(false);
        return;
      }
      if (
        !stickToBottomRef.current &&
        movedTowardBottom &&
        !isSendTopBlockingTailRef.current?.() &&
        isScrollNearBottom(viewport, STICK_TO_BOTTOM_THRESHOLD_PX)
      ) {
        detachedWhileSendTopRef.current = false;
        setStickToBottom(true);
        return;
      }
      if (!stickToBottomRef.current && detachedWhileSendTopRef.current) {
        syncScrollToBottomVisibility();
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
    window.addEventListener("keydown", onKeyDown, { passive: true });
    viewport.addEventListener("focusin", onFocusIn, { passive: true });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("focusin", onFocusIn);
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
  }, [enabled, scrollAreaRef, setStickToBottom, syncScrollToBottomVisibility]);

  useLayoutEffect(() => {
    if (prevContentKeyRef.current !== contentKey) {
      prevContentKeyRef.current = contentKey;
      detachedWhileSendTopRef.current = false;
      postStreamSettleUntilRef.current = 0;
      stopStreamChase();
      setStickToBottom(true);
    }
    if (!enabled) {
      detachedWhileSendTopRef.current = false;
      stopStreamChase();
      setStickToBottom(true);
    }
  }, [contentKey, enabled, setStickToBottom, stopStreamChase]);

  useLayoutEffect(() => {
    const sendTopTriggeredThisCommit = sendTopTriggerNonce !== lastProcessedSendTopNonceRef.current;
    lastProcessedSendTopNonceRef.current = sendTopTriggerNonce;

    isBusyRef.current = isBusy;
    if (!enabled) {
      prevBusyRef.current = isBusy;
      postStreamSettleUntilRef.current = 0;
      return;
    }
    const busyStarted = !prevBusyRef.current && isBusy;
    const busyEnded = prevBusyRef.current && !isBusy;
    prevBusyRef.current = isBusy;
    if (busyEnded) {
      postStreamSettleUntilRef.current = performance.now() + POST_STREAM_SETTLE_MS;
      return;
    }
    if (!busyStarted) {
      return;
    }
    postStreamSettleUntilRef.current = 0;
    if (sendTopTriggeredThisCommit || isSendTopBlockingTailRef.current?.()) {
      return;
    }
    scrollToTail(true);
    requestAnimationFrame(() => {
      if (isSendTopBlockingTailRef.current?.() || !stickToBottomRef.current) {
        return;
      }
      scrollToTail();
    });
  }, [enabled, isBusy, scrollToTail, sendTopTriggerNonce]);

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
    const previous = previousLayoutRef.current;
    const layoutChanged =
      previous?.enabled !== enabled || previous.paddingPx !== scrollBedPaddingPx;
    previousLayoutRef.current = { enabled, paddingPx: scrollBedPaddingPx };
    if (
      !enabled ||
      !layoutChanged ||
      !stickToBottomRef.current ||
      isSendTopBlockingTailRef.current?.()
    ) {
      return;
    }
    pinViewportToBottom("auto");
    requestAnimationFrame(() => {
      if (stickToBottomRef.current && !isSendTopBlockingTailRef.current?.()) {
        pinViewportToBottom("auto");
      }
    });
  }, [enabled, pinViewportToBottom, scrollBedPaddingPx]);

  useEffect(() => {
    return () => {
      cancelLiveSmoothRef.current?.();
      cancelLiveSmoothRef.current = null;
      stopStreamChase();
    };
  }, [stopStreamChase]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    const content = viewport?.firstElementChild;
    if (!viewport || !(content instanceof HTMLElement)) {
      return;
    }

    let lastViewportWidth = viewport.clientWidth;
    let lastViewportHeight = viewport.clientHeight;

    // Re-evaluate the tail state on layout changes:
    // - viewport resized while sticking → re-pin immediately so shrinking the window keeps the newest messages in view;
    // - content resized during active streaming / post-stream settle while sticking (and not held by send-top compensation) → smoothly chase the growing bottom;
    // - content resized while idle (e.g. user manually expanded/collapsed a thinking, tool, or MCP App card)
    //   → never slam the viewport to the bottom; release tail-follow when expansion pushes content below the fold;
    // - released → re-arm when a layout change puts the viewport back at the bottom (distance ≤ 1), unless detached during send-top compensation.
    const observer = new ResizeObserver(() => {
      const viewportResized =
        viewport.clientWidth !== lastViewportWidth || viewport.clientHeight !== lastViewportHeight;
      lastViewportWidth = viewport.clientWidth;
      lastViewportHeight = viewport.clientHeight;

      if (stickToBottomRef.current) {
        if (isSendTopBlockingTailRef.current?.()) {
          return;
        }
        if (viewportResized) {
          pinViewportToBottom("auto");
          return;
        }
        if (isStreamTailPinActive()) {
          pinViewportToBottom("chase");
          return;
        }
        if (scrollDistanceFromBottom(viewport) > STICK_TO_BOTTOM_THRESHOLD_PX) {
          setStickToBottom(false);
        }
        return;
      }
      if (
        !detachedWhileSendTopRef.current &&
        !isSendTopBlockingTailRef.current?.() &&
        scrollDistanceFromBottom(viewport) <= 1
      ) {
        setStickToBottom(true);
        return;
      }
      if (detachedWhileSendTopRef.current) {
        syncScrollToBottomVisibility();
      }
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [
    enabled,
    isStreamTailPinActive,
    pinViewportToBottom,
    scrollAreaRef,
    setStickToBottom,
    syncScrollToBottomVisibility,
  ]);

  return {
    pinScrollToTail: scrollToTail,
    followingTail,
    showScrollToBottom: !followingTail && scrollToBottomAllowed,
    releaseTailFollow: () => setStickToBottom(false),
    enterSendTopTurn,
    syncScrollToBottomVisibility,
  };
}
