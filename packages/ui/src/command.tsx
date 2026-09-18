// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronLeft, Search } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "./button.js";
import { cn } from "./cn.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground",
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
      <DialogHeader className="sr-only">
        {title ? <DialogTitle>{title}</DialogTitle> : null}
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogContent
        className={cn("overflow-hidden rounded-xl p-0", className)}
        showCloseButton={false}
        {...(onEscapeKeyDown === undefined ? {} : { onEscapeKeyDown })}
      >
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
    <div
      data-slot="command-input-wrapper"
      className="-mx-1 -mt-1 flex h-11 items-center gap-2 border-b border-border/60 px-3"
    >
      {showBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-ml-1 size-7 shrink-0 text-muted-foreground"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </Button>
      ) : (
        <Search className="size-4 shrink-0 opacity-50" aria-hidden />
      )}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-11 w-full cursor-text bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
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
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto pt-1 outline-none",
        className,
      )}
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
      className={cn("py-6 text-center text-sm", className)}
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
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-normal **:[[cmdk-group-heading]]:text-muted-foreground",
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
      className={cn("-mx-1 h-px bg-outline-border", className)}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  children,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-overlay-hover data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <Check className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
