// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { createContext, useContext, type ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "./cn.js";
import { toggleVariants } from "./toggle.js";

const ToggleGroupVariantContext = createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

export function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn("flex w-fit items-center rounded-lg", className)}
      {...props}
    >
      <ToggleGroupVariantContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupVariantContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = useContext(ToggleGroupVariantContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({
          variant: variant ?? context.variant,
          size: size ?? context.size,
        }),
        "rounded-none first:rounded-l-lg last:rounded-r-lg focus:z-10",
        className,
      )}
      {...props}
    />
  );
}
