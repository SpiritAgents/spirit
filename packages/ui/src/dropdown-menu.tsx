// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, type ComponentProps, type Ref } from "react";

import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
  DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM_LAYOUT,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM_FOCUS,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
} from "./chrome.js";
import { cn } from "./cn.js";
import { isEventTargetWithinTooltipCompanionOverlays } from "./hooks/tooltip-switch-registry.js";
import { radixAnchoredOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";
import { useOptionalTooltipItemMenuHighlight, useTooltipKeyboardInput } from "./tooltip.js";

function preventDropdownDismissForTooltipCompanion(event: {
  target: EventTarget | null;
  preventDefault(): void;
}): void {
  if (!isEventTargetWithinTooltipCompanionOverlays(event.target)) {
    return;
  }
  event.preventDefault();
}

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export function DropdownMenuPortal(props: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  const portalContainer = useUiPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal
      data-slot="dropdown-menu-portal"
      container={props.container ?? portalContainer}
      {...props}
    />
  );
}

export function DropdownMenuSub(props: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuRadioGroup(
  props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  onPointerDownOutside,
  onInteractOutside,
  onFocusOutside,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  onOpenAutoFocus?: (event: Event) => void;
  onEntryFocus?: (event: Event) => void;
}) {
  const portalContainer = useUiPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          "z-50 overflow-hidden p-1",
          radixAnchoredOverlayMotion("dropdown-menu"),
          className,
        )}
        {...props}
        onPointerDownOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onPointerDownOutside?.(event);
        }}
        onInteractOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onInteractOutside?.(event);
        }}
        onFocusOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onFocusOutside?.(event);
        }}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ref,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
  ref?: Ref<HTMLDivElement>;
}) {
  const tooltipMenuHighlight = useOptionalTooltipItemMenuHighlight();
  const keyboardInput = useTooltipKeyboardInput();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const showFocusHighlight = tooltipMenuHighlight === null || keyboardInput;
  const pointerHighlighted = tooltipMenuHighlight?.pointer === true && !keyboardInput;
  const composedRef = useCallback(
    (element: HTMLDivElement | null) => {
      itemRef.current = element;
      if (typeof ref === "function") {
        ref(element);
        return;
      }
      if (ref) {
        ref.current = element;
      }
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (pointerHighlighted && !props.disabled) {
      itemRef.current?.focus({ preventScroll: true });
    }
  }, [pointerHighlighted, props.disabled]);

  return (
    <DropdownMenuPrimitive.Item
      ref={composedRef}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM_LAYOUT,
        showFocusHighlight && DESKTOP_OVERLAY_LIST_ITEM_FOCUS,
        inset && "pl-8",
        variant === "destructive" && "text-destructive [&_svg]:text-destructive",
        variant === "destructive" &&
          showFocusHighlight &&
          "focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20",
        className,
        tooltipMenuHighlight?.highlighted &&
          (variant === "destructive"
            ? "!bg-destructive/10 dark:!bg-destructive/20"
            : "!bg-overlay-hover text-accent-foreground"),
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM, "pr-8", className)}
      {...(checked === undefined ? {} : { checked })}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM, "pr-8", className)}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="size-1.5 rounded-full bg-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
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

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-outline-border", className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto text-[11px] tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM,
        DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
        "data-open:bg-overlay-hover data-open:text-accent-foreground",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const portalContainer = useUiPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
          "z-50 p-1",
          radixAnchoredOverlayMotion("dropdown-menu"),
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
