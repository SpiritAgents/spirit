// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import {
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OUTLINE_BUTTON_FOCUSED,
  DESKTOP_OUTLINE_BUTTON_HOVER,
  instantHoverMotionClass,
} from "./chrome.js";
import { cn } from "./cn.js";

export const toggleVariants = cva(
  cn(
    "inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-clip-padding font-normal text-sm whitespace-nowrap outline-none select-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        default: cn(
          "bg-transparent",
          "hover:bg-canvas-hover hover:text-chrome-emphasis",
          "data-[state=on]:bg-canvas-hover data-[state=on]:text-chrome-emphasis",
          instantHoverMotionClass,
        ),
        outline: cn(
          "bg-background transition-none",
          DESKTOP_CONTENT_TRANSLUCENT_FILL,
          DESKTOP_OUTLINE_BORDER,
          DESKTOP_OUTLINE_BUTTON_HOVER,
          DESKTOP_OUTLINE_BUTTON_FOCUSED,
          "data-[state=on]:border-outline-border-hover data-[state=on]:bg-outline-fill data-[state=on]:text-chrome-emphasis",
        ),
      },
      size: {
        default: "h-8 min-w-8 px-2.5",
        sm: "h-7 min-w-7 px-2.5 text-[0.8rem]",
        lg: "h-9 min-w-9 px-2.5",
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
