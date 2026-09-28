// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { DESKTOP_CONTENT_TRANSLUCENT_FILL, DESKTOP_OUTLINE_BORDER } from "./chrome.js";
import { cn } from "./cn.js";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg bg-background px-2.5 py-1 text-sm outline-none",
        DESKTOP_CONTENT_TRANSLUCENT_FILL,
        DESKTOP_OUTLINE_BORDER,
        "placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-normal",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
