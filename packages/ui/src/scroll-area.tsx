import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { forwardRef, type ComponentProps, type CSSProperties } from "react";

import { cn } from "./cn.js";

type ScrollAreaScrollbarMode = "vertical" | "horizontal" | "both";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof ScrollAreaPrimitive.Root> & {
    scrollbars?: ScrollAreaScrollbarMode;
    viewportClassName?: string;
    viewportStyle?: CSSProperties;
  }
>(function ScrollArea(
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
) {
  const viewportChildClass =
    scrollbars === "horizontal"
      ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max"
      : scrollbars === "both"
        ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max [&>div]:min-h-full"
        : "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:w-full";

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cn("relative min-w-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-radix-scroll-area-viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full min-h-0 min-w-0 rounded-[inherit] [display:block] outline-none",
          viewportChildClass,
          viewportClassName,
        )}
        style={viewportStyle}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars === "vertical" || scrollbars === "both" ? <ScrollBar /> : null}
      {scrollbars === "horizontal" || scrollbars === "both" ? (
        <ScrollBar orientation="horizontal" />
      ) : null}
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  );
});

export const ScrollBar = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>
>(function ScrollBar({ className, orientation = "vertical", ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-[opacity,colors] duration-150",
        orientation === "vertical" && "h-full w-1.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-1.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-foreground/12 dark:bg-foreground/10" />
    </ScrollAreaPrimitive.Scrollbar>
  );
});
