// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT
//
// Original in-project work. EmptyCard is a single outline card wrapping one
// centered muted text line, built on DESKTOP_ITEM_CARD_SURFACE.

import type { ComponentProps } from "react";

import { DESKTOP_ITEM_CARD_SURFACE } from "./chrome.js";
import { cn } from "./cn.js";

/** Full-width outline card with a centered muted line, shown when a list has no items. */
export function EmptyCard({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn(DESKTOP_ITEM_CARD_SURFACE, className)} {...props}>
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
