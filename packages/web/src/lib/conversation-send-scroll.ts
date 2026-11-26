import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import { prefersReducedMotion } from "@/lib/reduce-motion";
import type { ConversationMessageSnapshot } from "@/types";

const MIN_SEND_TOP_DURATION_MS = 260;
const MAX_SEND_TOP_DURATION_MS = 400;
const BASE_SEND_TOP_DURATION_MS = 240;
const SEND_TOP_DURATION_MS_PER_PX = 0.16;
const COMPENSATION_EPSILON_PX = 0.5;

export type ActiveUserMessageMatch = {
  /** Composite identity combining messageId and messageIndex (messageId alone can collide with assistant-thinking rows). */
  key: string;
  messageIndex: number;
  messageId: number;
  renderIndex: number;
};

/**
 * Returns the latest non-queued user message in the conversation together with its render index,
 * or null when no active user message exists.
 */
export function findLastActiveUserMessage(
  messages: readonly ConversationMessageSnapshot[],
  renderItems: readonly ConversationRenderItem[],
): ActiveUserMessageMatch | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user" || message.queued === true) {
      continue;
    }
    const renderIndex = renderItems.findIndex(
      (item) => item.kind === "message" && item.messageIndex === index,
    );
    if (renderIndex < 0) {
      continue;
    }
    return {
      key: `${message.id}@${index}`,
      messageIndex: index,
      messageId: message.id,
      renderIndex,
    };
  }
  return null;
}

/**
 * Resolves the top inset below the scroll viewport top edge where the pinned user bubble should rest.
 * Clamping to the row's preceding gap avoids showing a few clipped pixels of the previous message
 * when the list shell's top padding (e.g. 28px) exceeds the inter-row gap (24px).
 */
export function resolveSendTopAnchorInsetPx(input: {
  scrollMarginPx: number;
  rowGapBeforePx: number;
}): number {
  const { scrollMarginPx, rowGapBeforePx } = input;
  if (scrollMarginPx > 0 && rowGapBeforePx > 0) {
    return Math.min(scrollMarginPx, rowGapBeforePx);
  }
  if (rowGapBeforePx > 0) {
    return rowGapBeforePx;
  }
  return Math.max(0, scrollMarginPx);
}

/**
 * Computes the target scrollTop so the user bubble rests at the top safe inset of the viewport.
 */
export function computeSendTopTargetScrollTop(input: {
  bubbleTopPx: number;
  scrollMarginPx: number;
  rowGapBeforePx: number;
}): number {
  const insetPx = resolveSendTopAnchorInsetPx({
    scrollMarginPx: input.scrollMarginPx,
    rowGapBeforePx: input.rowGapBeforePx,
  });
  return Math.max(0, input.bubbleTopPx - insetPx);
}

/**
 * Computes the temporary bottom compensation height needed so maxScrollTop can reach ceilingScrollTop.
 * As reply content grows (increasing baseContentHeight) or the user scrolls up (decreasing ceilingScrollTop),
 * the required compensation shrinks monotonically to 0.
 */
export function computeSendTopCompensationPx(input: {
  ceilingScrollTop: number;
  viewportHeight: number;
  baseContentHeight: number;
}): number {
  const { ceilingScrollTop, viewportHeight, baseContentHeight } = input;
  if (ceilingScrollTop <= 0 || viewportHeight <= 0) {
    return 0;
  }
  const raw = ceilingScrollTop + viewportHeight - baseContentHeight;
  if (raw < COMPENSATION_EPSILON_PX) {
    return 0;
  }
  return Math.round(raw * 100) / 100;
}

export function computeSendTopAnimationDurationMs(distancePx: number): number {
  const distance = Math.abs(distancePx);
  if (distance <= 1) {
    return 0;
  }
  return Math.min(
    MAX_SEND_TOP_DURATION_MS,
    Math.max(
      MIN_SEND_TOP_DURATION_MS,
      Math.round(BASE_SEND_TOP_DURATION_MS + distance * SEND_TOP_DURATION_MS_PER_PX),
    ),
  );
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export type AnimateSendTopOptions = {
  viewport: HTMLElement;
  resolveTargetScrollTop: () => number | null;
  onBeforeFrameWrite?: (targetScrollTop: number) => void;
  onFrameScrollTopWritten?: (scrollTop: number) => void;
  onDone?: () => void;
};

/**
 * Smoothly animates viewport.scrollTop toward a live targetScrollTop using an ease-out curve.
 * Re-reads the target each frame so virtual-list measurement updates converge without jumping.
 */
export function animateViewportScrollToLiveTarget({
  viewport,
  resolveTargetScrollTop,
  onBeforeFrameWrite,
  onFrameScrollTopWritten,
  onDone,
}: AnimateSendTopOptions): () => void {
  const initialTarget = resolveTargetScrollTop();
  if (initialTarget === null) {
    onDone?.();
    return () => {};
  }

  const startTop = viewport.scrollTop;
  const durationMs = prefersReducedMotion()
    ? 0
    : computeSendTopAnimationDurationMs(initialTarget - startTop);

  if (durationMs <= 0) {
    onBeforeFrameWrite?.(initialTarget);
    viewport.scrollTop = initialTarget;
    onFrameScrollTopWritten?.(initialTarget);
    onDone?.();
    return () => {};
  }

  let cancelled = false;
  let rafId = 0;
  const startTime = performance.now();

  const step = (now: number) => {
    if (cancelled) {
      return;
    }
    const liveTarget = resolveTargetScrollTop();
    if (liveTarget === null) {
      cancelled = true;
      onDone?.();
      return;
    }
    onBeforeFrameWrite?.(liveTarget);
    const t = Math.min(1, (now - startTime) / durationMs);
    const nextTop = t < 1 ? startTop + (liveTarget - startTop) * easeOutCubic(t) : liveTarget;
    viewport.scrollTop = nextTop;
    onFrameScrollTopWritten?.(nextTop);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
      return;
    }
    onDone?.();
  };

  rafId = requestAnimationFrame(step);
  return () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}
