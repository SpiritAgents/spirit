// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

import { cn } from "./cn.js";

export function Toaster({ className, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      className={cn("toaster", className)}
      toastOptions={{
        classNames: {
          toast:
            "border border-border/80 bg-popover text-popover-foreground shadow-[0_2px_20px_-4px_rgb(0_0_0/0.06)]",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
