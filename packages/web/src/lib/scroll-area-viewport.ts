import type { ComponentRef } from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";
import { prefersReducedMotion } from "@/lib/reduce-motion";

export function scrollAreaViewport(
  root: ComponentRef<typeof ScrollArea> | null,
): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

export function scrollAreaToBottom(viewport: HTMLElement, behavior: ScrollBehavior = "auto"): void {
  const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const useSmooth = behavior === "smooth" && !prefersReducedMotion();
  if (useSmooth) {
    viewport.scrollTo({ top, behavior: "smooth" });
    return;
  }
  viewport.scrollTop = top;
}

/**
 * Eased scroll toward the "current" bottom: re-reads scrollHeight every frame so the target
 * follows streaming height growth, avoiding native scrollTo(smooth) locking onto the height at
 * click time and then jumping at the end.
 */
export function scrollAreaAnimateToLiveBottom(
  viewport: HTMLElement,
  options?: { onDone?: () => void },
): () => void {
  const reducedMotion = prefersReducedMotion();
  if (reducedMotion) {
    const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = top;
    options?.onDone?.();
    return () => {};
  }

  let cancelled = false;
  const startTop = viewport.scrollTop;
  const startTime = performance.now();
  const initialTarget = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const initialDistance = Math.max(0, initialTarget - startTop);
  const durationMs = Math.min(520, Math.max(220, initialDistance * 0.45));
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

  const frame = (now: number) => {
    if (cancelled) {
      return;
    }
    const liveTarget = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const t = Math.min(1, (now - startTime) / durationMs);
    viewport.scrollTop = startTop + (liveTarget - startTop) * easeOutCubic(t);
    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }
    viewport.scrollTop = liveTarget;
    options?.onDone?.();
  };
  requestAnimationFrame(frame);
  return () => {
    cancelled = true;
  };
}

const STREAM_CHASE_TAU_MS = 85;
const STREAM_CHASE_MIN_DT_MS = 8;
const STREAM_CHASE_MAX_DT_MS = 48;
const STREAM_CHASE_SETTLE_EPSILON_PX = 0.5;

/**
 * Continuous exponential ease-out chase toward the live bottom while streaming.
 * Unlike restarting a fixed-duration ease on every token delta, exponential damping maintains
 * smooth velocity across irregular streaming chunks and settles cleanly when output pauses.
 */
export function scrollAreaAnimateChaseLiveBottom(
  viewport: HTMLElement,
  options?: {
    shouldStop?: () => boolean;
    onDone?: () => void;
  },
): () => void {
  const resolveLiveBottom = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);

  if (prefersReducedMotion()) {
    if (!options?.shouldStop?.()) {
      const target = resolveLiveBottom();
      if (target > viewport.scrollTop) {
        viewport.scrollTop = target;
      }
    }
    options?.onDone?.();
    return () => {};
  }

  let cancelled = false;
  let rafId = 0;
  let lastNow = performance.now();

  const finish = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    options?.onDone?.();
  };

  const step = () => {
    if (cancelled) {
      return;
    }
    if (options?.shouldStop?.()) {
      finish();
      return;
    }
    const now = performance.now();
    const dtMs = Math.min(STREAM_CHASE_MAX_DT_MS, Math.max(STREAM_CHASE_MIN_DT_MS, now - lastNow));
    lastNow = now;

    const liveTarget = resolveLiveBottom();
    const currentTop = viewport.scrollTop;
    const remaining = liveTarget - currentTop;
    if (remaining <= STREAM_CHASE_SETTLE_EPSILON_PX) {
      if (remaining > 0) {
        viewport.scrollTop = liveTarget;
      }
      finish();
      return;
    }

    const alpha = 1 - Math.exp(-dtMs / STREAM_CHASE_TAU_MS);
    const stepPx = Math.max(STREAM_CHASE_SETTLE_EPSILON_PX, remaining * alpha);
    viewport.scrollTop = remaining <= 1 ? liveTarget : Math.min(liveTarget, currentTop + stepPx);
    rafId = requestAnimationFrame(step);
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

export function scrollDistanceFromBottom(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

export function isScrollNearBottom(viewport: HTMLElement, thresholdPx = 48): boolean {
  return scrollDistanceFromBottom(viewport) <= thresholdPx;
}

/** Scrolls an element within the ScrollArea viewport while preserving the paddingHost padding (scrollIntoView does not account for it) */
export function scrollIntoViewportWithPadding(
  viewport: HTMLElement,
  item: HTMLElement,
  paddingHost: HTMLElement | null | undefined,
): void {
  const style = paddingHost ? getComputedStyle(paddingHost) : null;
  const paddingTop = style ? Number.parseFloat(style.paddingTop) || 0 : 0;
  const paddingBottom = style ? Number.parseFloat(style.paddingBottom) || 0 : 0;

  const itemRect = item.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  let scrollDelta = 0;

  const overflowBottom = itemRect.bottom - (viewportRect.bottom - paddingBottom);
  if (overflowBottom > 0) {
    scrollDelta += overflowBottom;
  }

  const overflowTop = viewportRect.top + paddingTop - itemRect.top;
  if (overflowTop > 0) {
    scrollDelta -= overflowTop;
  }

  if (scrollDelta === 0) {
    return;
  }

  viewport.scrollTop = Math.max(
    0,
    Math.min(viewport.scrollTop + scrollDelta, viewport.scrollHeight - viewport.clientHeight),
  );
}
