import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_LIST_SHELL } from "./chrome.js";
import { cn } from "./cn.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export function HoverCard(props: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

export function HoverCardTrigger(props: ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

export function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  const portalContainer = useUiPortalContainer();
  return (
    <HoverCardPrimitive.Portal container={portalContainer}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          DESKTOP_OVERLAY_LIST_SHELL,
          DESKTOP_OVERLAY_EDGE,
          "z-50 bg-popover p-3 text-xs text-popover-foreground",
          radixAnchoredOverlayMotion("hover-card"),
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
