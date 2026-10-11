import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Switch({
  className,
  size = "default",
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-px outline-none transition-colors",
        "data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px]",
        "data-checked:bg-primary",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {/* Thumb fills the 2px inset (1px border + 1px padding). Checked travel is track width minus track height. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm transition-[translate,transform,background-color] duration-150",
          "group-data-[size=default]/switch:size-[14.4px] group-data-[size=sm]/switch:size-[10px]",
          "group-data-[size=default]/switch:data-checked:translate-x-[13.6px] group-data-[size=sm]/switch:data-checked:translate-x-[10px]",
          "data-unchecked:translate-x-0",
          "dark:data-unchecked:bg-primary",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
