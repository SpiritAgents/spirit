// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Dropdown Menu"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx).
// Modifications by N123999:
// - Slimmer subset plus overlay shadow token.

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { DESKTOP_OVERLAY_SHADOW } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  onOpenAutoFocus?: (event: Event) => void;
  onEntryFocus?: (event: Event) => void;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          "spirit-scroll z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-32 overflow-y-auto overflow-x-hidden",
          "rounded-xl border border-border/80 bg-popover p-1 text-sm text-popover-foreground",
          DESKTOP_OVERLAY_SHADOW,
          "ring-1 ring-white/5 backdrop-blur-sm",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger };
