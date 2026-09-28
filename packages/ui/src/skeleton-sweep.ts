// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT
//
// One viewport-space band is shared by every mounted Skeleton. Restart only after
// the highlight has fully cleared the rightmost target so leftover cannot loop.

const SKELETON_SHIMMER_BAND_RATIO = 0.55;
const SKELETON_SHIMMER_CYCLE_SEC = 1.2;
/** Same curve as the launch logo shimmer: `cubic-bezier(0.45, 0.05, 0.55, 0.95)`. */
const SKELETON_SHIMMER_EASE = [0.45, 0.05, 0.55, 0.95] as const;
const LOCAL_X_VAR = "--skeleton-shimmer-local-x";
const BAND_VAR = "--skeleton-shimmer-band";

function bezier1d(t: number, a: number, b: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * t * a + 3 * rest * t * t * b + t * t * t;
}

function bezier1dDerivative(t: number, a: number, b: number): number {
  const rest = 1 - t;
  return 3 * rest * rest * a + 6 * rest * t * (b - a) + 3 * t * t * (1 - b);
}

function cubicBezierProgress(time: number, x1: number, y1: number, x2: number, y2: number): number {
  if (time <= 0) {
    return 0;
  }
  if (time >= 1) {
    return 1;
  }
  let guess = time;
  for (let i = 0; i < 6; i += 1) {
    const current = bezier1d(guess, x1, x2);
    const slope = bezier1dDerivative(guess, x1, x2);
    if (slope === 0) {
      break;
    }
    guess = Math.min(1, Math.max(0, guess - (current - time) / slope));
  }
  return bezier1d(guess, y1, y2);
}

const targets = new Set<HTMLElement>();

let rafId = 0;
let progress = 0;
let lastTs = 0;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function measureUnion(): { left: number; right: number; width: number } | null {
  let left = Infinity;
  let right = -Infinity;
  for (const el of targets) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  return { left, right, width: right - left };
}

function shimmerBandPx(unionWidth: number): number {
  return unionWidth * SKELETON_SHIMMER_BAND_RATIO;
}

function paint(x: number, bandPx: number): void {
  const band = `${bandPx}px`;
  for (const el of targets) {
    const rect = el.getBoundingClientRect();
    el.style.setProperty(BAND_VAR, band);
    el.style.setProperty(LOCAL_X_VAR, `${x - rect.left}px`);
  }
}

function tick(ts: number): void {
  if (targets.size === 0 || prefersReducedMotion()) {
    rafId = 0;
    lastTs = 0;
    progress = 0;
    return;
  }

  const dt = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  const union = measureUnion();
  if (!union) {
    rafId = globalThis.requestAnimationFrame(tick);
    return;
  }

  progress += dt / SKELETON_SHIMMER_CYCLE_SEC;
  if (progress >= 1) {
    progress = 0;
  }
  const bandPx = shimmerBandPx(union.width);
  const start = union.left - bandPx;
  const end = union.right;
  const eased = cubicBezierProgress(progress, ...SKELETON_SHIMMER_EASE);
  paint(start + (end - start) * eased, bandPx);
  rafId = globalThis.requestAnimationFrame(tick);
}

function ensureLoop(): void {
  if (rafId !== 0 || prefersReducedMotion()) {
    return;
  }
  lastTs = 0;
  rafId = globalThis.requestAnimationFrame(tick);
}

export function registerSkeletonSweepTarget(el: HTMLElement): () => void {
  targets.add(el);
  ensureLoop();
  return () => {
    targets.delete(el);
    el.style.removeProperty(LOCAL_X_VAR);
    el.style.removeProperty(BAND_VAR);
    if (targets.size === 0) {
      globalThis.cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
      progress = 0;
    }
  };
}
