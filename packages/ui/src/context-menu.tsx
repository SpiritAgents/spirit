// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Check, ChevronRight } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { Fragment, type ComponentProps, type ReactNode } from "react";

import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE,
  DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE_FOCUS,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_OVERLAY_MENU_SEPARATOR,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
} from "./chrome.js";
import { cn } from "./cn.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export function ContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

export function ContextMenuTrigger({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  );
}

export function ContextMenuGroup(props: ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

export function ContextMenuPortal({
  container,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  const portalContainer = useUiPortalContainer();
  return (
    <ContextMenuPrimitive.Portal
      data-slot="context-menu-portal"
      container={container ?? portalContainer}
      {...props}
    />
  );
}

export function ContextMenuSub(props: ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

export function ContextMenuRadioGroup(
  props: ComponentProps<typeof ContextMenuPrimitive.RadioGroup>,
) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const portalContainer = useUiPortalContainer();
  return (
    <ContextMenuPrimitive.Portal container={portalContainer}>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          "z-50 p-1",
          radixAnchoredOverlayMotion("context-menu"),
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        inset && "pl-8",
        variant === "destructive" &&
          cn(DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE, DESKTOP_OVERLAY_LIST_ITEM_DESTRUCTIVE_FOCUS),
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 pr-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...(checked === undefined ? {} : { checked })}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 pr-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <span className="size-1.5 rounded-full bg-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-[11px] font-normal tracking-wide text-muted-foreground",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(DESKTOP_OVERLAY_MENU_SEPARATOR, className)}
      {...props}
    />
  );
}

export function ContextMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn("ml-auto text-[11px] tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
        "gap-1.5 data-open:bg-overlay-hover data-open:text-accent-foreground data-open:[&_svg]:text-inherit data-open:[&_[data-slot$='-shortcut']]:text-inherit [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
        DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
        "z-50 p-1",
        radixAnchoredOverlayMotion("context-menu"),
        className,
      )}
      {...props}
    />
  );
}

export type ContextMenuSectionItem = {
  section: string;
  item: ReactNode;
};

export function ContextMenuSectionItems({ items }: { items: ContextMenuSectionItem[] }) {
  let previousSection: string | undefined;
  return items.map((entry, index) => {
    const showSeparator = previousSection !== undefined && entry.section !== previousSection;
    previousSection = entry.section;
    return (
      <Fragment key={`${entry.section}-${index}`}>
        {showSeparator ? <ContextMenuSeparator /> : null}
        {entry.item}
      </Fragment>
    );
  });
}
