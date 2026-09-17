// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { Button } from "./button.js";
import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "./chrome.js";
import { cn } from "./cn.js";
import { CloseIcon } from "./icons.js";
import { modalContentMotion, modalOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogPortal({
  container,
  ...props
}: ComponentProps<typeof DialogPrimitive.Portal>) {
  const portalContainer = useUiPortalContainer();
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container ?? portalContainer}
      {...props}
    />
  );
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/40", modalOverlayMotion, className)}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  forceMount,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  overlayClassName?: string;
}) {
  return (
    <DialogPortal {...(forceMount === undefined ? {} : { forceMount })}>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        {...(forceMount === undefined ? {} : { forceMount })}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground",
          DESKTOP_OVERLAY_EDGE,
          DESKTOP_OVERLAY_SHADOW_LG,
          modalContentMotion,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground outline-none hover:bg-canvas-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <CloseIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-6", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  layout = "actions",
  inset = false,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<"div"> & {
  layout?: "actions" | "split";
  inset?: boolean;
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex rounded-b-xl border-t border-border/40 bg-muted/50",
        inset ? "mx-0 mb-0 gap-3 px-6 py-4" : "-mx-4 -mb-4 gap-2 p-4",
        layout === "split"
          ? "flex-col sm:flex-row sm:items-center sm:justify-between"
          : "flex-col-reverse sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      ) : null}
    </div>
  );
}

export function DialogFooterActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer-actions"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
