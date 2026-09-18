// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { Button } from "./button.js";
import { DESKTOP_CONTENT_TRANSLUCENT_FILL, DESKTOP_OUTLINE_BORDER } from "./chrome.js";
import { cn } from "./cn.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn(
        "flex h-8 w-full min-w-0 items-center overflow-hidden rounded-lg bg-background",
        DESKTOP_CONTENT_TRANSLUCENT_FILL,
        DESKTOP_OUTLINE_BORDER,
        "has-[>textarea]:h-auto",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupAddon({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(
        "flex items-center justify-center gap-2 px-2 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupText({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function InputGroupButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="input-group-button"
      variant="ghost"
      size="icon-sm"
      className={cn("rounded-none", className)}
      {...props}
    />
  );
}

export function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-input"
      className={cn("rounded-none border-0 bg-transparent shadow-none", className)}
      {...props}
    />
  );
}

export function InputGroupTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="input-group-textarea"
      className={cn("rounded-none border-0 bg-transparent shadow-none", className)}
      {...props}
    />
  );
}
