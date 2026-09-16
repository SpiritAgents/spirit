// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Checkbox"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/checkbox.tsx).
// Modifications by N123999:
// - Desktop outline border, hit-area inset, and hover/focus wash.

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { DESKTOP_OUTLINE_BORDER } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        DESKTOP_OUTLINE_BORDER,
        "hover:not-data-checked:border-border hover:not-data-checked:bg-canvas-hover",
        "focus:not-data-checked:border-border focus:not-data-checked:bg-canvas-hover",
        "focus-visible:not-data-checked:border-ring focus-visible:not-data-checked:ring-3 focus-visible:not-data-checked:ring-ring/50",
        "focus-visible:data-checked:ring-3 focus-visible:data-checked:ring-ring/50",
        "transition-none",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
