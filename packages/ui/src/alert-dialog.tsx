// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Button } from "./button.js";
import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW_LG } from "./chrome.js";
import { cn } from "./cn.js";
import { modalContentMotion, modalOverlayMotion } from "./overlay-motion.js";
import { Spinner } from "./spinner.js";
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
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground outline-none sm:max-w-md",
            DESKTOP_OVERLAY_EDGE,
            DESKTOP_OVERLAY_SHADOW_LG,
            modalContentMotion,
          )}
        >
          <div data-slot="alert-dialog-header" className="flex flex-col gap-2">
            <AlertDialogPrimitive.Title className="font-heading text-base font-normal leading-none">
              {title}
            </AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description className="text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-2 *:[a]:hover:text-chrome-emphasis/80">
                {description}
              </AlertDialogPrimitive.Description>
            ) : (
              <AlertDialogPrimitive.Description className="sr-only">
                {title}
              </AlertDialogPrimitive.Description>
            )}
          </div>
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border/40 bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              type="button"
              size="sm"
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                void onConfirm();
              }}
            >
              {busy ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
