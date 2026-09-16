// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Alert Dialog"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/alert-dialog.tsx).
// Modifications by N123999:
// - Collapsed the compound API into a single controlled AlertDialog with busy/confirm props.
// - Desktop overlay chrome, layout-scale portal, and footer action layout.

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DESKTOP_OVERLAY_EDGE } from "@/lib/desktop-chrome";
import { FONT_WEIGHT_NORMAL } from "@/lib/desktop-typography";
import { getUiLayoutPortalContainer } from "@/lib/ui-layout-scale";
import { cn } from "@/lib/utils";

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel: React.ReactNode;
  variant?: "destructive" | "default";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
};

function AlertDialog({
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
      <AlertDialogPrimitive.Portal
        data-slot="alert-dialog-portal"
        container={getUiLayoutPortalContainer()}
      >
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            DESKTOP_OVERLAY_EDGE,
          )}
        >
          <div data-slot="alert-dialog-header" className="flex flex-col gap-2">
            <AlertDialogPrimitive.Title
              data-slot="alert-dialog-title"
              className={cn("font-heading text-base leading-none", FONT_WEIGHT_NORMAL)}
            >
              {title}
            </AlertDialogPrimitive.Title>
            {description != null && description !== "" ? (
              <AlertDialogPrimitive.Description
                data-slot="alert-dialog-description"
                className="text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-2 *:[a]:hover:text-sidebar-foreground/80"
              >
                {description}
              </AlertDialogPrimitive.Description>
            ) : null}
          </div>
          <div
            data-slot="alert-dialog-footer"
            className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border/40 bg-muted/50 p-4 sm:flex-row sm:justify-end"
          >
            <div
              data-slot="alert-dialog-footer-actions"
              className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
            >
              <AlertDialogPrimitive.Cancel asChild>
                <Button type="button" variant="outline" size="sm" disabled={busy}>
                  {cancelLabel}
                </Button>
              </AlertDialogPrimitive.Cancel>
              <Button
                type="button"
                variant={variant === "destructive" ? "destructive" : "default"}
                size="sm"
                disabled={busy}
                onClick={() => {
                  void onConfirm();
                }}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {confirmLabel}
              </Button>
            </div>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export { AlertDialog };
