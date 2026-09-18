// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-px outline-none transition-colors",
        "data-checked:bg-primary",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-[translate,transform,background-color] duration-150 data-checked:translate-x-4 data-unchecked:translate-x-0 dark:data-unchecked:bg-primary"
      />
    </SwitchPrimitive.Root>
  );
}
