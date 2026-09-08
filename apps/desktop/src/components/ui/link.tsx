// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

// The canonical inline text-link style, shared by every link in running text.
// The button/badge "link" variants (underline only on hover) are a separate
// action-style concern and intentionally not covered here.

import * as React from "react";

import { cn } from "@/lib/utils";

/** Inline text link on a default surface. */
export const TEXT_LINK_CLASS =
  "text-foreground underline underline-offset-2 hover:text-sidebar-foreground/80";

/** Inline text link in muted running text. */
export const TEXT_LINK_MUTED_CLASS =
  "text-muted-foreground underline underline-offset-2 hover:text-sidebar-foreground/80";

/** Inline text link inside a popover / tooltip surface. */
export const TEXT_LINK_POPOVER_CLASS =
  "text-popover-foreground underline underline-offset-2 hover:text-popover-foreground/80";

export function TextLink({
  className,
  muted = false,
  ...props
}: React.ComponentProps<"a"> & { muted?: boolean }) {
  return (
    <a className={cn(muted ? TEXT_LINK_MUTED_CLASS : TEXT_LINK_CLASS, className)} {...props} />
  );
}
