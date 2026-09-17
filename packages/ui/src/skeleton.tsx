// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
