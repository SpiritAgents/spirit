// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS } from "../collapsible-animation.js";

/** Mount immediately on expand; delay unmount after collapse. */
export function useCollapsibleChildMount(
  open: boolean,
  delayMs = COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS,
): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [open, delayMs]);

  return mounted;
}
