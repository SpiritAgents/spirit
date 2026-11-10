import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export const REDUCE_MOTION_STORAGE_KEY = "spirit-desktop-reduce-motion" as const;

export const REDUCE_MOTION_CLASS = "spirit-reduce-motion" as const;

export const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)" as const;

export type ReduceMotionPreference = "system" | "on" | "off";

const VALID: readonly ReduceMotionPreference[] = ["system", "on", "off"];

const listeners = new Set<() => void>();

let systemListenerStarted = false;

function isReduceMotionPreference(v: string): v is ReduceMotionPreference {
  return (VALID as readonly string[]).includes(v);
}

export function getStoredReduceMotion(): ReduceMotionPreference {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const raw = localStorage.getItem(REDUCE_MOTION_STORAGE_KEY);
  if (raw && isReduceMotionPreference(raw)) {
    return raw;
  }
  return "system";
}

export function setStoredReduceMotion(pref: ReduceMotionPreference): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, pref);
  flushDesktopRendererStorage();
}

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(REDUCE_MOTION_QUERY).matches;
}

export function resolveReduceMotion(pref: ReduceMotionPreference): boolean {
  if (pref === "on") {
    return true;
  }
  if (pref === "off") {
    return false;
  }
  return systemPrefersReducedMotion();
}

export function subscribePrefersReducedMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyPrefersReducedMotion(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function applyReduceMotionToDocument(pref: ReduceMotionPreference): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(REDUCE_MOTION_CLASS, resolveReduceMotion(pref));
  notifyPrefersReducedMotion();
}

/** Reads the resolved html class — the same source CSS and Tailwind motion-reduce use. */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.classList.contains(REDUCE_MOTION_CLASS);
}

export function startReduceMotionSystemListener(): void {
  if (systemListenerStarted || typeof window === "undefined") {
    return;
  }
  systemListenerStarted = true;
  const mq = window.matchMedia(REDUCE_MOTION_QUERY);
  const onChange = (): void => {
    if (getStoredReduceMotion() === "system") {
      applyReduceMotionToDocument("system");
    }
  };
  mq.addEventListener("change", onChange);
}
