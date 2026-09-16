// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Context Menu"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/context-menu.tsx).
// Modifications by N123999:
// - Desktop overlay list tokens, origin-aware motion, and layout-scale portal.

import * as React from "react";
import { Fragment } from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
} from "@/lib/desktop-chrome";
import { radixAnchoredOverlayMotion } from "@/lib/overlay-motion";
import { getUiLayoutPortalContainer } from "@/lib/ui-layout-scale";
import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, CheckIcon } from "lucide-react";

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  );
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuPortal({
  container,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return (
    <ContextMenuPrimitive.Portal
      data-slot="context-menu-portal"
      container={container ?? getUiLayoutPortalContainer()}
      {...props}
    />
  );
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <ContextMenuPrimitive.Portal container={getUiLayoutPortalContainer()}>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          radixAnchoredOverlayMotion("context-menu"),
          "spirit-scroll z-50 max-h-(--radix-context-menu-content-available-height) overflow-x-hidden overflow-y-auto",
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          "p-1",
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
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
        "group/context-menu-item gap-1.5 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        variant === "destructive" &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 data-inset:pl-7 data-open:bg-overlay-hover data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground/80" aria-hidden />
    </ContextMenuPrimitive.SubTrigger>
  );
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        radixAnchoredOverlayMotion("context-menu"),
        "z-50 overflow-hidden",
        DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
        "p-1",
        DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 pr-8 pl-1.5 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        "gap-1.5 pr-8 pl-1.5 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs text-muted-foreground data-inset:pl-7",
        FONT_WEIGHT_NORMAL,
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type ContextMenuSectionItem = {
  /** Items of the same section form one group; separators are inserted automatically between groups. */
  section: string;
  item: React.ReactNode;
};

function ContextMenuSectionItems({ items }: { items: ContextMenuSectionItem[] }) {
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

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSectionItems,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
