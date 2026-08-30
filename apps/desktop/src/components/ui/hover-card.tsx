import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "@/lib/desktop-chrome";
import { getUiLayoutPortalContainer } from "@/lib/ui-layout-scale";
import { radixAnchoredOverlayMotion } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal container={getUiLayoutPortalContainer()}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-xl bg-popover p-3 text-popover-foreground outline-none backdrop-blur-sm",
          DESKTOP_OVERLAY_EDGE,
          DESKTOP_OVERLAY_SHADOW_LG,
          radixAnchoredOverlayMotion("hover-card"),
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
