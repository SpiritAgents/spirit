// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_LIST_SHELL } from "./chrome.js";
import { cn } from "./cn.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const portalContainer = useUiPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          DESKTOP_OVERLAY_LIST_SHELL,
          DESKTOP_OVERLAY_EDGE,
          "z-50 bg-popover p-2 text-xs text-popover-foreground",
          radixAnchoredOverlayMotion("popover"),
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
