// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { cn } from "./cn.js";

/** Inline text link on a default surface. */
export const TEXT_LINK_CLASS =
  "text-foreground underline underline-offset-2 hover:text-chrome-emphasis/80";

/** Inline text link in muted running text. */
export const TEXT_LINK_MUTED_CLASS =
  "text-muted-foreground underline underline-offset-2 hover:text-chrome-emphasis/80";

/** Inline text link inside a popover / tooltip surface. */
export const TEXT_LINK_POPOVER_CLASS =
  "text-popover-foreground underline underline-offset-2 hover:text-popover-foreground/80";

export function TextLink({
  className,
  muted = false,
  ...props
}: ComponentProps<"a"> & { muted?: boolean }) {
  return (
    <a className={cn(muted ? TEXT_LINK_MUTED_CLASS : TEXT_LINK_CLASS, className)} {...props} />
  );
}
