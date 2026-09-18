// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import {
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_SELECT_CONTENT,
  DESKTOP_SELECT_ITEM,
  DESKTOP_SELECT_LABEL,
  DESKTOP_SELECT_SCROLL_AREA,
  DESKTOP_SELECT_TRIGGER,
  stopOverlayScrollPropagation,
} from "./chrome.js";
import { cn } from "./cn.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";
import { ScrollArea } from "./scroll-area.js";

export function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

export function SelectGroup(props: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(DESKTOP_SELECT_TRIGGER, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  const portalContainer = useUiPortalContainer();
  return (
    <SelectPrimitive.Portal container={portalContainer}>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          DESKTOP_SELECT_CONTENT,
          "z-50",
          radixAnchoredOverlayMotion("select"),
          position === "popper" &&
            "min-w-[var(--radix-select-trigger-width)] data-side=bottom:translate-y-1 data-side=top:-translate-y-1",
          className,
        )}
        {...props}
      >
        <ScrollArea
          type="always"
          className={DESKTOP_SELECT_SCROLL_AREA}
          onWheel={stopOverlayScrollPropagation}
          onTouchMove={stopOverlayScrollPropagation}
        >
          <SelectPrimitive.Viewport
            className={cn(
              DESKTOP_OVERLAY_LIST_LIST_PADDING,
              "overflow-visible",
              position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
        </ScrollArea>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(DESKTOP_SELECT_LABEL, className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(DESKTOP_SELECT_ITEM, className)}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
