// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { Check } from "@spiritagent/icons/check";

import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { DESKTOP_OUTLINE_BORDER } from "./chrome.js";
import { cn } from "./cn.js";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-background text-primary-foreground outline-none",
        "content-translucent:not-data-checked:bg-content-translucent-fill",
        DESKTOP_OUTLINE_BORDER,
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "data-checked:border-primary data-checked:bg-primary",
        "enabled:hover:not-data-checked:border-outline-border-hover enabled:hover:not-data-checked:bg-outline-fill",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" strokeWidth={1.75} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
