// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn("size-4 animate-spin", className)}
      {...props}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
