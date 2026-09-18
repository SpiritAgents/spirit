// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "./cn.js";
import { registerSkeletonSweepTarget } from "./skeleton-sweep.js";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    return registerSkeletonSweepTarget(el);
  }, []);

  return (
    <div
      ref={ref}
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  );
}
