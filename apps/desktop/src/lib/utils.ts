// Copyright (c) 2023 shadcn
// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT
//
// Derived from shadcn/ui historical lib/utils.ts `cn()` helper
// (clsx + tailwind-merge). Current v4 registry re-exports `cn` from "cn".
// Modifications by N123999:
// - None material; formatting and project import paths only.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
