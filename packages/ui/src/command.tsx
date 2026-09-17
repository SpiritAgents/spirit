// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog.js";
import { ChevronRightIcon } from "./icons.js";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-transparent text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandDialog({
  title,
  description,
  className,
  children,
  onEscapeKeyDown,
  ...props
}: ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  onEscapeKeyDown?: ComponentProps<typeof DialogContent>["onEscapeKeyDown"];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={false}
        {...(onEscapeKeyDown === undefined ? {} : { onEscapeKeyDown })}
      >
        {title ? <DialogTitle className="sr-only">{title}</DialogTitle> : null}
        {description ? (
          <DialogDescription className="sr-only">{description}</DialogDescription>
        ) : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  showBack = false,
  onBack,
  backLabel = "Back",
  ...props
}: ComponentProps<typeof CommandPrimitive.Input> & {
  showBack?: boolean;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border/40 px-2">
      {showBack ? (
        <button
          type="button"
          aria-label={backLabel}
          className="rounded-md p-1 text-muted-foreground hover:bg-canvas-hover hover:text-chrome-emphasis"
          onClick={onBack}
        >
          <ChevronRightIcon className="rotate-180" />
        </button>
      ) : null}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-80 overflow-y-auto p-1", className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("px-2 py-6 text-center text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-popover-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px bg-border/60", className)}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-overlay-hover data-[selected=true]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-[11px] tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}
