// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

/** Matches the `spirit-collapsible-down` duration in app theme CSS. */
export const COLLAPSIBLE_OPEN_ANIMATION_MS = 280;

/** Matches the `spirit-collapsible-up` duration in app theme CSS. */
export const COLLAPSIBLE_CLOSE_ANIMATION_MS = 220;

/** Unmount heavy content only after the collapse animation ends. */
export const COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS = COLLAPSIBLE_CLOSE_ANIMATION_MS + 32;
