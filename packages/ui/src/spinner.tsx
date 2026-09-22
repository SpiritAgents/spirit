// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import { LoaderCircle } from "@spiritagent/icons/loader-circle";

import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Spinner({ className, ...props }: ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      data-slot="spinner"
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn("size-4 animate-spin", className)}
      strokeWidth={1.75}
      {...props}
    />
  );
}
