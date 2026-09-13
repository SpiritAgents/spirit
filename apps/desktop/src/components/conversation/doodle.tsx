// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// This file is original in-project work. It is not derived from shadcn/ui
// (shadcn has no Doodle primitive). Doodle is the welcome line above the
// empty-session composer, built solely on the project's own typography tokens.

import * as React from "react";

import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

/** Centered welcome line above the empty-session composer. */
export function Doodle({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-spirit-surface="doodle" className={cn("mb-6", className)} {...props}>
      <p
        className={cn(
          "text-center text-2xl tracking-tight text-foreground sm:text-3xl",
          FONT_WEIGHT_MEDIUM,
        )}
        data-testid="doodle"
      >
        {children}
      </p>
    </div>
  );
}
