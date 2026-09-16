// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui "Label"
// (https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/label.tsx).
// Modifications by N123999:
// - Project typography token.

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        `flex items-center gap-2 text-sm leading-none ${FONT_WEIGHT_NORMAL} select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50`,
        className,
      )}
      {...props}
    />
  );
}

export { Label };
