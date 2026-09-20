// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { DESKTOP_OUTLINE_BORDER } from "./chrome.js";
import { cn } from "./cn.js";

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer relative flex aspect-square size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background outline-none",
        "content-translucent:not-data-checked:bg-content-translucent-fill",
        DESKTOP_OUTLINE_BORDER,
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        "enabled:hover:not-data-checked:border-outline-border-hover enabled:hover:not-data-checked:bg-outline-fill",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span className="size-2 rounded-full bg-primary-foreground" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}
