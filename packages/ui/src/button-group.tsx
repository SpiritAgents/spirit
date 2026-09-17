// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";
import { Separator } from "./separator.js";

export const buttonGroupVariants = cva("inline-flex w-fit items-stretch", {
  variants: {
    orientation: {
      horizontal:
        "flex-row [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none",
      vertical:
        "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

export function ButtonGroup({
  className,
  orientation = "horizontal",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      data-slot="button-group"
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}

export function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn("bg-input self-stretch", className)}
      {...props}
    />
  );
}

export function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="button-group-text"
      className={cn("inline-flex items-center px-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
