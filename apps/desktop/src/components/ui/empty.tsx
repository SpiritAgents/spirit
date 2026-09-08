// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// This file is original in-project work. It is not derived from shadcn/ui's
// "Empty" component (a compound Empty/EmptyHeader/EmptyMedia/EmptyTitle/
// EmptyDescription/EmptyContent family with cva variants and dashed borders);
// EmptyCard is a single outline card wrapping one centered muted text line,
// built solely on the project's own DESKTOP_ITEM_CARD_SURFACE tokens.

import * as React from "react";

import { DESKTOP_ITEM_CARD_SURFACE } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

/** Full-width outline card with a centered muted line, shown when a list has no items. */
export function EmptyCard({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn(DESKTOP_ITEM_CARD_SURFACE, className)} {...props}>
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
