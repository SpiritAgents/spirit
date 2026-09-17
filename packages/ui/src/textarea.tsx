// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { DESKTOP_CONTENT_TRANSLUCENT_FILL, DESKTOP_OUTLINE_BORDER } from "./chrome.js";
import { cn } from "./cn.js";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 resize-none rounded-md bg-background px-2.5 py-2 text-sm outline-none",
        DESKTOP_CONTENT_TRANSLUCENT_FILL,
        DESKTOP_OUTLINE_BORDER,
        "placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
