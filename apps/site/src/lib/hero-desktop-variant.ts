"use client";

import { useSyncExternalStore } from "react";

export const HERO_DESIGN_MODE_PROBABILITY = 0.65;

let heroShowsDesignModeWindow: boolean | undefined;

function getSnapshot() {
  heroShowsDesignModeWindow ??= Math.random() < HERO_DESIGN_MODE_PROBABILITY;
  return heroShowsDesignModeWindow;
}

function getServerSnapshot() {
  return false;
}

function subscribe() {
  return () => {};
}

export function useHeroShowsDesignModeWindow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
