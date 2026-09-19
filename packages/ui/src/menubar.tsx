// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Check, ChevronRight } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import {
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_OVERLAY_MENU_SEPARATOR,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
} from "./chrome.js";
import { cn } from "./cn.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export function Menubar({ className, ...props }: ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        "flex h-8 items-center gap-0.5 rounded-lg p-[3px]",
        DESKTOP_OUTLINE_BORDER,
        className,
      )}
      {...props}
    />
  );
}

export function MenubarMenu(props: ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

export function MenubarTrigger({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex cursor-pointer items-center rounded-sm px-1.5 py-[2px] text-sm outline-none select-none",
        "hover:bg-canvas-hover data-open:bg-canvas-hover",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Content>) {
  const portalContainer = useUiPortalContainer();
  return (
    <MenubarPrimitive.Portal container={portalContainer}>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          "z-50 overflow-hidden p-1",
          radixAnchoredOverlayMotion("menubar"),
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}

export function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        inset && "pl-8",
        variant === "destructive" &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarSeparator({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn(DESKTOP_OVERLAY_MENU_SEPARATOR, className)}
      {...props}
    />
  );
}

export function MenubarShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn("ml-auto text-[11px] tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function MenubarCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof MenubarPrimitive.CheckboxItem>) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM, "pr-8", className)}
      {...(checked === undefined ? {} : { checked })}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}

export function MenubarRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenubarPrimitive.RadioItem>) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM, "pr-8", className)}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <span className="size-1.5 rounded-full bg-current" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  );
}

export function MenubarSub(props: ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

export function MenubarSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof MenubarPrimitive.SubTrigger>) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
        "data-open:bg-overlay-hover data-open:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5" />
    </MenubarPrimitive.SubTrigger>
  );
}

export function MenubarSubContent({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.SubContent>) {
  const portalContainer = useUiPortalContainer();
  return (
    <MenubarPrimitive.Portal container={portalContainer}>
      <MenubarPrimitive.SubContent
        data-slot="menubar-sub-content"
        className={cn(
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          "z-50 p-1",
          radixAnchoredOverlayMotion("menubar"),
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}

export function MenubarLabel({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Label>) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      className={cn(
        "px-2 py-1.5 text-[11px] font-normal tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarGroup(props: ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}

export function MenubarRadioGroup(props: ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}
