// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Scroll Area"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/scroll-area.tsx).
// Modifications by N123999:
// - Viewport table-layout override, scrollbars prop, and hover-type defaults.

import * as React from "react";
import { Corner, Root, Scrollbar, Thumb, Viewport } from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof Scrollbar>,
  React.ComponentPropsWithoutRef<typeof Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none p-px transition-[opacity,colors] duration-150",
      orientation === "vertical" && "h-full w-1.5 border-l border-l-transparent",
      orientation === "horizontal" && "h-1.5 flex-col border-t border-t-transparent",
      className,
    )}
    {...props}
  >
    <Thumb className="relative flex-1 rounded-full bg-foreground/12 dark:bg-foreground/10" />
  </Scrollbar>
));
ScrollBar.displayName = "ScrollBar";

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof Root>,
  React.ComponentPropsWithoutRef<typeof Root> & {
    scrollbars?: "vertical" | "horizontal" | "both";
    /** Applies only to the Viewport (the scrollbar is a sibling node and is unaffected by the mask) */
    viewportClassName?: string;
    viewportStyle?: React.CSSProperties;
  }
>(
  (
    {
      className,
      children,
      type = "hover",
      scrollHideDelay = 500,
      scrollbars = "vertical",
      viewportClassName,
      viewportStyle,
      ...props
    },
    ref,
  ) => {
    const viewportChildClass =
      scrollbars === "horizontal"
        ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max"
        : scrollbars === "both"
          ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max [&>div]:min-h-full"
          : "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:w-full";

    return (
      <Root
        ref={ref}
        type={type}
        scrollHideDelay={scrollHideDelay}
        className={cn("relative min-w-0 overflow-hidden", className)}
        {...props}
      >
        <Viewport
          // Radix's inner default display:table + min-width:100% expands to the "intrinsic content
          // width", breaking truncate/ellipsis inside flex (radix-ui/primitives#926).
          // Override the table formatting context with !block + min-w-0 + width constraints, as
          // recommended in the official issue.
          className={cn(
            "h-full w-full min-h-0 min-w-0 rounded-[inherit] [display:block]",
            viewportChildClass,
            viewportClassName,
          )}
          style={viewportStyle}
        >
          {children}
        </Viewport>
        {scrollbars === "vertical" || scrollbars === "both" ? <ScrollBar /> : null}
        {scrollbars === "horizontal" || scrollbars === "both" ? (
          <ScrollBar orientation="horizontal" />
        ) : null}
        <Corner className="bg-transparent" />
      </Root>
    );
  },
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea, ScrollBar };
