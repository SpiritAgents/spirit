// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

import { DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW } from "./chrome.js";
import { cn } from "./cn.js";

export function Toaster({
  className,
  theme = "system",
  style,
  toastOptions,
  ...props
}: ToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      className={cn("toaster group", className)}
      style={
        {
          fontFamily: "var(--font-sans)",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "color-mix(in oklab, var(--border) 80%, transparent)",
          "--border-radius": "var(--radius)",
          ...style,
        } as CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          toast: cn(DESKTOP_OVERLAY_EDGE, DESKTOP_OVERLAY_SHADOW, toastOptions?.classNames?.toast),
        },
      }}
      {...props}
    />
  );
}
