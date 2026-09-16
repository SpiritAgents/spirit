// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Toggle"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/toggle.tsx).
// Modifications by N123999:
// - Desktop typography/hover tokens and instant hover motion.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";

import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  cn(
    `group/toggle inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg text-sm ${FONT_WEIGHT_NORMAL} whitespace-nowrap outline-none hover:bg-canvas-hover hover:text-sidebar-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-canvas-hover data-[state=on]:bg-canvas-hover data-[state=on]:text-sidebar-foreground data-[state=on]:hover:bg-canvas-hover dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
    instantHoverMotionClass,
  ),
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-canvas-hover",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
