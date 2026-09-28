// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex cursor-pointer items-center gap-2 text-sm font-normal leading-none text-foreground select-none",
        "group-data-disabled:pointer-events-none group-data-disabled:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
