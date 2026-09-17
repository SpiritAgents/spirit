// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Button } from "./button.js";
import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "./chrome.js";
import { cn } from "./cn.js";
import { SpinnerIcon } from "./icons.js";
import { modalContentMotion, modalOverlayMotion } from "./overlay-motion.js";
import { useUiPortalContainer } from "./portal.js";

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  variant?: "destructive" | "default";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "destructive",
  busy = false,
  onConfirm,
}: AlertDialogProps) {
  const portalContainer = useUiPortalContainer();

  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && busy) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogPrimitive.Portal container={portalContainer}>
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          className={cn("fixed inset-0 z-50 bg-black/40", modalOverlayMotion)}
        />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl bg-popover p-4 text-popover-foreground",
            DESKTOP_OVERLAY_EDGE,
            DESKTOP_OVERLAY_SHADOW_LG,
            modalContentMotion,
          )}
        >
          <AlertDialogPrimitive.Title className="text-sm font-medium text-foreground">
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="text-xs text-muted-foreground">
              {description}
            </AlertDialogPrimitive.Description>
          ) : (
            <AlertDialogPrimitive.Description className="sr-only">
              {title}
            </AlertDialogPrimitive.Description>
          )}
          <div className="-mx-4 -mb-4 mt-1 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border/40 bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                type="button"
                size="sm"
                variant={variant === "destructive" ? "destructive" : "default"}
                disabled={busy}
                onClick={() => {
                  void onConfirm();
                }}
              >
                {busy ? <SpinnerIcon className="size-4" /> : null}
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
