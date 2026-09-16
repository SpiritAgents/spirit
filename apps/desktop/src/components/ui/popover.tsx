// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Popover"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/popover.tsx).
// Modifications by N123999:
// - Desktop overlay chrome, origin-aware motion, and layout-scale portal.

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "@/lib/desktop-chrome";
import { getUiLayoutPortalContainer } from "@/lib/ui-layout-scale";
import { radixAnchoredOverlayMotion } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  ref,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal container={getUiLayoutPortalContainer()}>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 rounded-xl bg-popover p-0 text-popover-foreground outline-none backdrop-blur-sm",
          DESKTOP_OVERLAY_EDGE,
          DESKTOP_OVERLAY_SHADOW_LG,
          radixAnchoredOverlayMotion("popover"),
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
