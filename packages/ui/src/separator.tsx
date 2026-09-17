// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        "data-horizontal:h-px data-horizontal:w-full",
        "data-vertical:h-full data-vertical:w-px",
        className,
      )}
      {...props}
    />
  );
}
