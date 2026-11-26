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
import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import {
  animateViewportScrollToLiveTarget,
  computeSendTopCompensationPx,
  findLastActiveUserMessage,
} from "@/lib/conversation-send-scroll";
import { scrollAreaViewport } from "@/lib/scroll-area-viewport";
import type { ConversationMessageSnapshot } from "@/types";

const ANCHOR_SHIFT_EPSILON_PX = 0.25;
const UPWARD_SCROLL_EPSILON_PX = 0.25;
const INTERRUPT_TOUCH_THRESHOLD_PX = 4;

const SCROLL_INTERRUPT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export type SendTopAnchorTarget = {
  messageIndex: number;
  messageId: number;
};

export type SendTopAnchorResolution = {
  targetScrollTop: number;
  renderIndex: number;
  exactDom: boolean;
};

export type SendTopAnchorResolver = (anchor: SendTopAnchorTarget) => SendTopAnchorResolution | null;

export type UseConversationSendTopScrollOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  spacerRef: RefObject<HTMLDivElement | null>;
  messages: readonly ConversationMessageSnapshot[];
  conversationRenderItems: readonly ConversationRenderItem[];
  contentKey: string;
  bedPaddingPx: number;
  isBusy: boolean;
  enabled: boolean;
  onActivateSendTopTurn: () => void;
  onInterruptAnimation?: () => void;
  onStateChange?: () => void;
};

export type UseConversationSendTopScrollResult = {
  /** Monotonically increasing nonce whenever a newly sent user message triggers send-top in an existing session. */
  sendTopTriggerNonce: number;
  /** Register the virtualizer/DOM anchor resolver from ConversationList. */
  registerAnchorResolver: (resolver: SendTopAnchorResolver | null) => void;
  /** Synchronously reconcile bottom compensation height on virtual list totalSize / layout changes. */
  syncSendTopLayout: () => void;
  /** Cancel any running send-top animation and clear temporary bottom compensation. */
  cancelSendTop: () => void;
  /** True while send-top animation is running or non-zero temporary compensation is active. */
  isSendTopBlockingTail: () => boolean;
};

type SendTopTrackerState = {
  contentKey: string;
  enabled: boolean;
  lastActiveUserKey: string | null;
  trigger: { messageIndex: number; messageId: number; nonce: number } | null;
};

type ActiveSendTopRuntime = {
  anchor: SendTopAnchorTarget;
  lastAnchorRenderIndex: number;
  lastAnchorTargetScrollTop: number;
  ceilingScrollTop: number;
  compensationPx: number;
  animating: boolean;
  cancelAnimation: (() => void) | null;
};

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

function measureBaseContentHeight(
  viewport: HTMLElement,
  spacerEl: HTMLElement,
  bedPaddingPx: number,
): number {
  const viewportRect = viewport.getBoundingClientRect();
  const spacerRect = spacerEl.getBoundingClientRect();
  const hasRealLayoutRects = viewportRect.height > 0 || spacerRect.top !== 0;
  const spacerTop = hasRealLayoutRects
    ? spacerRect.top - viewportRect.top + viewport.scrollTop
    : spacerEl.offsetTop;
  return spacerTop + bedPaddingPx;
}

/**
 * When the user sends a new message in an existing conversation, adds temporary bottom compensation,
 * smoothly scrolls the user's bubble to the viewport top safe area, offsets the compensation as the
 * assistant reply grows, and irreversibly shrinks compensation when the user scrolls upward.
 */
export function useConversationSendTopScroll({
  scrollAreaRef,
  spacerRef,
  messages,
  conversationRenderItems,
  contentKey,
  bedPaddingPx,
  isBusy,
  enabled,
  onActivateSendTopTurn,
  onInterruptAnimation,
  onStateChange,
}: UseConversationSendTopScrollOptions): UseConversationSendTopScrollResult {
  const lastActiveUser = enabled
    ? findLastActiveUserMessage(messages, conversationRenderItems)
    : null;
  const lastActiveUserKey = lastActiveUser?.key ?? null;
  const lastActiveUserRenderIndex = lastActiveUser?.renderIndex ?? -1;

  const [tracker, setTracker] = useState<SendTopTrackerState>(() => ({
    contentKey,
    enabled,
    lastActiveUserKey,
    trigger: null,
  }));

  if (
    tracker.contentKey !== contentKey ||
    tracker.enabled !== enabled ||
    tracker.lastActiveUserKey !== lastActiveUserKey
  ) {
    const sameActiveSession = tracker.enabled && enabled && tracker.contentKey === contentKey;
    const shouldTrigger =
      sameActiveSession &&
      lastActiveUser !== null &&
      lastActiveUser.key !== tracker.lastActiveUserKey &&
      lastActiveUserRenderIndex > 0;
    const nextTrigger = shouldTrigger
      ? {
          messageIndex: lastActiveUser.messageIndex,
          messageId: lastActiveUser.messageId,
          nonce: (tracker.trigger?.nonce ?? 0) + 1,
        }
      : sameActiveSession
        ? tracker.trigger
        : null;
    setTracker({
      contentKey,
      enabled,
      lastActiveUserKey,
      trigger: nextTrigger,
    });
  }

  const activeRef = useRef<ActiveSendTopRuntime | null>(null);
  const anchorResolverRef = useRef<SendTopAnchorResolver | null>(null);
  const bedPaddingPxRef = useRef(bedPaddingPx);
  const isBusyRef = useRef(isBusy);
  const onActivateSendTopTurnRef = useRef(onActivateSendTopTurn);
  const onInterruptAnimationRef = useRef(onInterruptAnimation);
  const onStateChangeRef = useRef(onStateChange);
  const handledTriggerNonceRef = useRef(0);
  const lastObservedScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    bedPaddingPxRef.current = bedPaddingPx;
    isBusyRef.current = isBusy;
    onActivateSendTopTurnRef.current = onActivateSendTopTurn;
    onInterruptAnimationRef.current = onInterruptAnimation;
    onStateChangeRef.current = onStateChange;
    if (!isBusy) {
      const active = activeRef.current;
      if (active && !active.animating && active.compensationPx <= 0) {
        activeRef.current = null;
        onStateChangeRef.current?.();
      }
    }
  }, [bedPaddingPx, isBusy, onActivateSendTopTurn, onInterruptAnimation, onStateChange]);

  const writeSpacerHeight = useCallback(
    (heightPx: number) => {
      const spacerEl = spacerRef.current;
      if (!spacerEl) {
        return;
      }
      const normalized = heightPx < 0.5 ? 0 : Math.round(heightPx * 100) / 100;
      spacerEl.style.height = normalized > 0 ? `${normalized}px` : "0px";
      spacerEl.dataset.compensationPx = String(Math.round(normalized));
    },
    [spacerRef],
  );

  const resetActiveState = useCallback(
    (options?: { notify?: boolean }) => {
      const current = activeRef.current;
      if (current) {
        current.cancelAnimation?.();
        current.cancelAnimation = null;
        activeRef.current = null;
      }
      writeSpacerHeight(0);
      if (options?.notify !== false && current) {
        onStateChangeRef.current?.();
      }
    },
    [writeSpacerHeight],
  );

  const interruptAnimation = useCallback(() => {
    const active = activeRef.current;
    if (!active || !active.animating) {
      return;
    }
    active.cancelAnimation?.();
    active.cancelAnimation = null;
    active.animating = false;
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    if (viewport) {
      lastObservedScrollTopRef.current = Math.max(0, viewport.scrollTop);
    }
    if (active.compensationPx <= 0) {
      activeRef.current = null;
      writeSpacerHeight(0);
    }
    onInterruptAnimationRef.current?.();
    onStateChangeRef.current?.();
  }, [scrollAreaRef, writeSpacerHeight]);

  const syncSendTopLayout = useCallback(
    (bedPaddingOverride?: number) => {
      const active = activeRef.current;
      if (!active) {
        return;
      }
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      const spacerEl = spacerRef.current;
      if (!viewport || !spacerEl) {
        return;
      }

      const anchor = anchorResolverRef.current?.(active.anchor) ?? null;
      if (anchor) {
        active.lastAnchorRenderIndex = anchor.renderIndex;
        const anchorShift = anchor.targetScrollTop - active.lastAnchorTargetScrollTop;
        if (Math.abs(anchorShift) > ANCHOR_SHIFT_EPSILON_PX) {
          active.lastAnchorTargetScrollTop = anchor.targetScrollTop;
          if (active.animating) {
            active.ceilingScrollTop = anchor.targetScrollTop;
          } else {
            // Rows above the anchor changed height; shift ceiling in lockstep so compensation is not falsely eaten.
            active.ceilingScrollTop = Math.max(0, active.ceilingScrollTop + anchorShift);
          }
        }
      }

      const baseContentHeight = measureBaseContentHeight(
        viewport,
        spacerEl,
        bedPaddingOverride ?? bedPaddingPxRef.current,
      );
      const prevComp = active.compensationPx;
      const nextComp = computeSendTopCompensationPx({
        ceilingScrollTop: active.ceilingScrollTop,
        viewportHeight: viewport.clientHeight,
        baseContentHeight,
      });
      active.compensationPx = nextComp;
      writeSpacerHeight(nextComp);
      if (!active.animating && nextComp > prevComp) {
        // When a collapsible card (e.g. Thinking) animates closed during the turn, the browser can
        // clamp scrollTop down by a few pixels before ResizeObserver fires. Restore scrollTop back
        // up to the prior position (bounded by ceilingScrollTop) in the same frame so the pinned
        // bubble never drifts downward.
        const restoreTop = Math.min(active.ceilingScrollTop, lastObservedScrollTopRef.current);
        if (restoreTop > viewport.scrollTop + 0.25) {
          viewport.scrollTop = restoreTop;
        }
        lastObservedScrollTopRef.current = Math.max(0, viewport.scrollTop);
      }

      if (!active.animating && nextComp === 0) {
        if (!isBusyRef.current) {
          activeRef.current = null;
        }
        onStateChangeRef.current?.();
        return;
      }
      if (prevComp > 0 !== nextComp > 0) {
        onStateChangeRef.current?.();
      }
    },
    [scrollAreaRef, spacerRef, writeSpacerHeight],
  );

  const registerAnchorResolver = useCallback((resolver: SendTopAnchorResolver | null) => {
    anchorResolverRef.current = resolver;
  }, []);

  const isSendTopBlockingTail = useCallback(() => {
    const active = activeRef.current;
    return Boolean(active && (active.animating || active.compensationPx > 0));
  }, []);

  const lastResetScopeRef = useRef<string | null>(null);
  // Reset compensation whenever leaving the session, clearing it, or switching scope/remount epoch.
  useLayoutEffect(() => {
    const scope = enabled ? contentKey : "";
    if (lastResetScopeRef.current === scope) {
      return;
    }
    lastResetScopeRef.current = scope;
    resetActiveState();
    handledTriggerNonceRef.current = 0;
  }, [contentKey, enabled, resetActiveState]);

  // Keep compensation aligned when composer dock height (bedPaddingPx) changes.
  useLayoutEffect(() => {
    syncSendTopLayout(bedPaddingPx);
  }, [bedPaddingPx, syncSendTopLayout]);

  // Trigger compensation + smooth scroll-to-top when a new user message appears in an existing session.
  useLayoutEffect(() => {
    const trigger = tracker.trigger;
    if (!enabled || !trigger || trigger.nonce === handledTriggerNonceRef.current) {
      return;
    }
    handledTriggerNonceRef.current = trigger.nonce;

    const viewport = scrollAreaViewport(scrollAreaRef.current);
    const spacerEl = spacerRef.current;
    if (!viewport || !spacerEl) {
      return;
    }

    const anchorTarget: SendTopAnchorTarget = {
      messageIndex: trigger.messageIndex,
      messageId: trigger.messageId,
    };
    const initialAnchor = anchorResolverRef.current?.(anchorTarget) ?? null;
    if (!initialAnchor) {
      return;
    }

    // Cancel any previous round's animation without resetting the spacer before computing the new one.
    if (activeRef.current) {
      activeRef.current.cancelAnimation?.();
      activeRef.current.cancelAnimation = null;
    }

    onActivateSendTopTurnRef.current();

    const baseContentHeight = measureBaseContentHeight(viewport, spacerEl, bedPaddingPxRef.current);
    const initialCompensation = computeSendTopCompensationPx({
      ceilingScrollTop: initialAnchor.targetScrollTop,
      viewportHeight: viewport.clientHeight,
      baseContentHeight,
    });

    const runtime: ActiveSendTopRuntime = {
      anchor: anchorTarget,
      lastAnchorRenderIndex: initialAnchor.renderIndex,
      lastAnchorTargetScrollTop: initialAnchor.targetScrollTop,
      ceilingScrollTop: initialAnchor.targetScrollTop,
      compensationPx: initialCompensation,
      animating: true,
      cancelAnimation: null,
    };
    activeRef.current = runtime;
    writeSpacerHeight(initialCompensation);
    lastObservedScrollTopRef.current = Math.max(0, viewport.scrollTop);
    onStateChangeRef.current?.();

    const cancel = animateViewportScrollToLiveTarget({
      viewport,
      resolveTargetScrollTop: () => {
        if (activeRef.current !== runtime) {
          return null;
        }
        const liveAnchor = anchorResolverRef.current?.(runtime.anchor);
        if (!liveAnchor) {
          return runtime.lastAnchorTargetScrollTop;
        }
        runtime.lastAnchorRenderIndex = liveAnchor.renderIndex;
        return liveAnchor.targetScrollTop;
      },
      onBeforeFrameWrite: (liveTarget) => {
        if (activeRef.current !== runtime) {
          return;
        }
        runtime.lastAnchorTargetScrollTop = liveTarget;
        runtime.ceilingScrollTop = liveTarget;
        const liveBaseHeight = measureBaseContentHeight(
          viewport,
          spacerEl,
          bedPaddingPxRef.current,
        );
        const nextComp = computeSendTopCompensationPx({
          ceilingScrollTop: runtime.ceilingScrollTop,
          viewportHeight: viewport.clientHeight,
          baseContentHeight: liveBaseHeight,
        });
        runtime.compensationPx = nextComp;
        writeSpacerHeight(nextComp);
      },
      onFrameScrollTopWritten: (writtenTop) => {
        lastObservedScrollTopRef.current = Math.max(0, writtenTop);
      },
      onDone: () => {
        if (activeRef.current !== runtime) {
          return;
        }
        runtime.animating = false;
        runtime.cancelAnimation = null;
        lastObservedScrollTopRef.current = Math.max(0, viewport.scrollTop);
        if (runtime.compensationPx <= 0 && !isBusyRef.current) {
          activeRef.current = null;
          writeSpacerHeight(0);
        }
        onStateChangeRef.current?.();
      },
    });
    if (activeRef.current === runtime && runtime.animating) {
      runtime.cancelAnimation = cancel;
    }
  }, [enabled, scrollAreaRef, spacerRef, tracker.trigger, writeSpacerHeight]);

  // Listen for user scroll input (to interrupt animation immediately) and upward scrolling
  // (to irreversibly shrink temporary bottom compensation without jumping viewport content).
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const root = scrollAreaRef.current;
    const viewport = scrollAreaViewport(root);
    if (!root || !viewport) {
      return;
    }

    lastObservedScrollTopRef.current = Math.max(0, viewport.scrollTop);
    let touchStartY = 0;
    let touchTracking = false;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        interruptAnimation();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !viewport.contains(event.target)) {
        // Radix scrollbar drag / track click.
        interruptAnimation();
        return;
      }
      if (event.button === 1) {
        interruptAnimation();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchTracking = true;
      touchStartY = event.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!touchTracking) {
        return;
      }
      const y = event.touches[0]?.clientY;
      if (y !== undefined && Math.abs(y - touchStartY) >= INTERRUPT_TOUCH_THRESHOLD_PX) {
        interruptAnimation();
      }
    };

    const onTouchEnd = () => {
      touchTracking = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current?.animating) {
        return;
      }
      if (!SCROLL_INTERRUPT_KEYS.has(event.key) || isEditableKeyboardTarget(event.target)) {
        return;
      }
      interruptAnimation();
    };

    const shrinkCompensationTo = (currentTop: number) => {
      const active = activeRef.current;
      if (!active || active.animating) {
        return;
      }
      if (currentTop >= active.ceilingScrollTop - UPWARD_SCROLL_EPSILON_PX) {
        return;
      }
      active.ceilingScrollTop = currentTop;
      if (active.compensationPx <= 0) {
        return;
      }
      const spacerEl = spacerRef.current;
      if (!spacerEl) {
        return;
      }
      const baseContentHeight = measureBaseContentHeight(
        viewport,
        spacerEl,
        bedPaddingPxRef.current,
      );
      const nextComp = computeSendTopCompensationPx({
        ceilingScrollTop: active.ceilingScrollTop,
        viewportHeight: viewport.clientHeight,
        baseContentHeight,
      });
      active.compensationPx = nextComp;
      writeSpacerHeight(nextComp);
      if (nextComp === 0) {
        if (!isBusyRef.current) {
          activeRef.current = null;
        }
        onStateChangeRef.current?.();
      }
    };

    const onFocusIn = () => {
      const active = activeRef.current;
      if (!active) {
        return;
      }
      const currentTop = Math.max(0, viewport.scrollTop);
      if (active.animating) {
        interruptAnimation();
      }
      if (currentTop < active.ceilingScrollTop - UPWARD_SCROLL_EPSILON_PX) {
        onInterruptAnimationRef.current?.();
        shrinkCompensationTo(currentTop);
        lastObservedScrollTopRef.current = currentTop;
      }
    };

    const onScroll = () => {
      const currentTop = Math.max(0, viewport.scrollTop);
      const prevTop = lastObservedScrollTopRef.current;
      lastObservedScrollTopRef.current = currentTop;

      const active = activeRef.current;
      if (!active || active.animating) {
        return;
      }
      const movedUp = currentTop < prevTop - UPWARD_SCROLL_EPSILON_PX;
      if (!movedUp) {
        return;
      }
      shrinkCompensationTo(currentTop);
    };

    const resizeObserver = new ResizeObserver(() => {
      syncSendTopLayout();
    });
    resizeObserver.observe(viewport);

    viewport.addEventListener("focusin", onFocusIn, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown, { passive: true });
    viewport.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("focusin", onFocusIn);
      viewport.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [enabled, interruptAnimation, scrollAreaRef, spacerRef, syncSendTopLayout, writeSpacerHeight]);

  // Clean up any in-flight rAF on unmount.
  useEffect(() => {
    return () => {
      const current = activeRef.current;
      if (current) {
        current.cancelAnimation?.();
        activeRef.current = null;
      }
    };
  }, []);

  return {
    sendTopTriggerNonce: tracker.trigger?.nonce ?? 0,
    registerAnchorResolver,
    syncSendTopLayout,
    cancelSendTop: resetActiveState,
    isSendTopBlockingTail,
  };
}
