// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Kbd"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/kbd.tsx).
// Modifications by N123999:
// - Desktop typography token; KbdGroup renders as kbd instead of div.

import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        `pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs ${FONT_WEIGHT_NORMAL} text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-muted in-data-[slot=tooltip-content]:text-popover-foreground [&_svg:not([class*='size-'])]:size-3`,
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
