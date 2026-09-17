// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { instantHoverMotionClass } from "./chrome.js";
import { cn } from "./cn.js";

export const toggleVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1 rounded-md font-normal text-sm outline-none select-none",
    "hover:bg-canvas-hover hover:text-sidebar-foreground",
    "data-[state=on]:bg-canvas-hover data-[state=on]:text-sidebar-foreground",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    instantHoverMotionClass,
  ),
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-outline-border bg-background",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2 text-xs",
        lg: "h-9 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}
