// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Anchored overlay motion is written here so Tailwind can see every origin utility.
// Do not interpolate those class names.

import { cn } from "./cn.js";

export const RADIX_OVERLAY_CLOSE_MS = 100;

export function runAfterRadixOverlayClose(action: () => void): void {
  window.setTimeout(action, RADIX_OVERLAY_CLOSE_MS);
}

export type RadixAnchoredOverlayKind =
  | "popover"
  | "dropdown-menu"
  | "select"
  | "hover-card"
  | "context-menu"
  | "menubar";

const OPEN = "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95";

const CLOSE = "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const SIDE_SLIDE =
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

const ORIGIN_BY_KIND = {
  popover: "origin-(--radix-popover-content-transform-origin)",
  "dropdown-menu": "origin-(--radix-dropdown-menu-content-transform-origin)",
  select: "origin-(--radix-select-content-transform-origin)",
  "hover-card": "origin-(--radix-hover-card-content-transform-origin)",
  "context-menu": "origin-(--radix-context-menu-content-transform-origin)",
  menubar: "origin-(--radix-menubar-content-transform-origin)",
} as const satisfies Record<RadixAnchoredOverlayKind, string>;

export function radixAnchoredOverlayMotion(kind: RadixAnchoredOverlayKind): string {
  // Exit animation keeps the outgoing DismissableLayer mounted. Menubar then
  // focuses the incoming Content, the stale layer treats that as focus-outside,
  // and onMenuClose clears the open value so hover-switch never lands.
  return cn(OPEN, kind === "menubar" ? undefined : CLOSE, SIDE_SLIDE, ORIGIN_BY_KIND[kind]);
}

export const modalOverlayMotion =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0";

export const modalContentMotion =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
